import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Check,
  ChevronDown,
  Download,
  ImagePlus,
  PenLine,
  Plus,
  QrCode,
  Save,
  Trash2,
  Type,
  Image as ImageIcon,
  Library,
  Upload,
} from 'lucide-react';
import { supabase, verifyUrl } from '../../lib/supabase';
import { audit, uploadAsset, assetUrl } from '../../lib/api';
import { buildValues, BASE_TOKENS, downloadBlob, normKey, uid } from '../../lib/format';
import { defaultConfig, DEFAULT_SIZE, FONTS, FONT_GROUPS, SAMPLE_VALUES } from '../../lib/defaults';
import {
  drawCertificate,
  ensureFonts,
  loadTemplateAssets,
  makeQrImage,
  prepareBackground,
  renderPdfBlob,
  rescaleConfig,
  cacheAssetImage,
  loadImage,
} from '../../lib/render';
import { Field, Spinner, useToast } from '../../components/ui';
import GlobalAssetPickerModal from '../../components/GlobalAssetPickerModal';

const parseRef = (ref) => {
  const i = ref ? ref.indexOf(':') : -1;
  return i < 0 ? [ref, null] : [ref.slice(0, i), ref.slice(i + 1)];
};
const LIST = { field: 'fields', image: 'images', sig: 'signatories' };

function getItem(cfg, ref) {
  if (!ref || !cfg) return null;
  const [t, id] = parseRef(ref);
  if (t === 'qr') return cfg.qr;
  return (cfg[LIST[t]] || []).find((x) => x.id === id);
}
function patchItem(cfg, ref, patch) {
  if (!ref || !cfg) return cfg;
  const [t, id] = parseRef(ref);
  if (t === 'qr') return { ...cfg, qr: { ...cfg.qr, ...patch } };
  const key = LIST[t];
  if (!key || !cfg[key]) return cfg;
  return { ...cfg, [key]: cfg[key].map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}
function removeItem(cfg, ref) {
  if (!ref || !cfg) return cfg;
  const [t, id] = parseRef(ref);
  if (t === 'qr') return { ...cfg, qr: { ...cfg.qr, enabled: false } };
  const key = LIST[t];
  if (!key || !cfg[key]) return cfg;
  return { ...cfg, [key]: cfg[key].filter((x) => x.id !== id) };
}
function normalize(cfg) {
  const base = cfg && Array.isArray(cfg.fields) ? cfg : defaultConfig();
  return {
    fields: base.fields || [],
    qr: base.qr || { enabled: true, x: 1580, y: 1040, size: 190 },
    images: base.images || [],
    signatories: base.signatories || [],
  };
}

function Num({ label, value, onChange, step = 1, min }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input
        type="number"
        className="input"
        value={value ?? 0}
        step={step}
        min={min}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </label>
  );
}

export default function TemplateDesigner({ ctx }) {
  const { event, template, recipients, reload, ownerName } = ctx;
  const toast = useToast();
  const initialTpl = template || {
    image_path: null,
    width: DEFAULT_SIZE.width,
    height: DEFAULT_SIZE.height,
    config: defaultConfig(),
  };

  const [tpl, setTpl] = useState(() => ({
    image_path: initialTpl.image_path || null,
    width: initialTpl.width || DEFAULT_SIZE.width,
    height: initialTpl.height || DEFAULT_SIZE.height,
    config: normalize(initialTpl.config),
  }));

  const [selected, setSelected] = useState(null);
  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved', 'saving', 'unsaved', 'error'
  const [lastSaved, setLastSaved] = useState(null);
  const [assets, setAssets] = useState(null);
  const [qrImg, setQrImg] = useState(null);
  const [previewIdx, setPreviewIdx] = useState(-1);
  const [uploading, setUploading] = useState('');

  // Global Store Modal state
  const [globalPickerOpen, setGlobalPickerOpen] = useState(false);
  const [globalPickerCat, setGlobalPickerCat] = useState('all');
  const [pickerTarget, setPickerTarget] = useState(null); // 'logo' or sig ID

  // Inline canvas editing state
  const [inlineEditing, setInlineEditing] = useState(null);

  const canvasRef = useRef(null);
  const boxesRef = useRef([]);
  const dragRef = useRef(null);
  const rafRef = useRef(null);
  const drawId = useRef(0);
  const bgInput = useRef(null);
  const logoInput = useRef(null);
  const sigInput = useRef(null);
  const autoSaveTimerRef = useRef(null);
  const isInteractingRef = useRef(false);
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);

  const cfg = tpl.config;
  const edit = (fn) => {
    setTpl((t) => ({ ...t, config: fn(t.config) }));
    setDirty(true);
  };
  const patch = (ref, p) => edit((c) => patchItem(c, ref, p));

  // Preview values
  const sample = previewIdx >= 0 ? recipients[previewIdx] : null;
  const values = useMemo(
    () =>
      buildValues(
        { name: sample?.name || SAMPLE_VALUES.name, extra: sample?.extra },
        event,
        { code: SAMPLE_VALUES.code, issuer: ownerName, verify_url: verifyUrl(SAMPLE_VALUES.code) }
      ),
    [sample, event, ownerName]
  );
  const extraTokens = useMemo(() => {
    const s = new Set();
    recipients.slice(0, 200).forEach((r) => Object.keys(r.extra || {}).forEach((k) => s.add(normKey(k))));
    return [...s].filter((k) => !BASE_TOKENS.includes(k));
  }, [recipients]);

  // Load assets when image set / size changes
  const assetKey = [
    tpl.image_path,
    tpl.width,
    tpl.height,
    ...cfg.images.map((i) => i.path),
    ...cfg.signatories.map((s) => s.path),
  ].join('|');

  useEffect(() => {
    let alive = true;
    loadTemplateAssets(tpl).then((a) => {
      if (!alive) return;
      setAssets(a);
      if (a?.failedPaths?.length) {
        toast.error(`Warning: ${a.failedPaths.length} image asset(s) failed to load.`);
      }
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetKey]);

  useEffect(() => {
    makeQrImage(verifyUrl(SAMPLE_VALUES.code)).then(setQrImg);
  }, []);

  // Save template
  const save = useCallback(
    async (override, isAuto = false) => {
      setSaving(true);
      setSaveStatus('saving');
      const next = override || tpl;
      const payload = {
        event_id: event.id,
        image_path: next.image_path,
        width: next.width,
        height: next.height,
        config: next.config,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('event_templates').upsert(payload, { onConflict: 'event_id' });
      setSaving(false);
      if (error) {
        setSaveStatus('error');
        if (!isAuto) toast.error(error.message);
        return false;
      }
      if (ctx && ctx.template) {
        Object.assign(ctx.template, payload);
      }
      audit('template.saved', 'event', event.id, { name: event.name });
      setDirty(false);
      setSaveStatus('saved');
      setLastSaved(new Date());
      if (!isAuto) toast.ok('Template saved');
      return true;
    },
    [event, tpl, ctx, toast]
  );

  // Debounced Auto-save (triggers 1.5s after user stops typing/dragging)
  useEffect(() => {
    if (!dirty) return;
    setSaveStatus('unsaved');
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      if (!isInteractingRef.current) {
        save(tpl, true);
      }
    }, 1500);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [tpl, dirty, save]);

  // Warn on page unload if changes are pending
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  // Scaling helper for resizing any element
  const scaleItem = useCallback((ref, factor) => {
    if (!ref || !factor || factor === 1 || isNaN(factor)) return;
    const [t] = parseRef(ref);
    setTpl((currentTpl) => {
      const it = getItem(currentTpl.config, ref);
      if (!it) return currentTpl;

      let patchObj = {};
      if (t === 'field') {
        const curSize = it.size || 28;
        const newSize = Math.max(10, Math.min(260, Math.round(curSize * factor)));
        patchObj.size = newSize;
        if (it.maxWidth) {
          patchObj.maxWidth = Math.max(80, Math.min(currentTpl.width, Math.round(it.maxWidth * factor)));
        }
      } else if (t === 'image') {
        const curW = it.width || 200;
        const newW = Math.max(30, Math.min(currentTpl.width, Math.round(curW * factor)));
        patchObj.width = newW;
      } else if (t === 'qr') {
        const curSize = it.size || 180;
        const newSize = Math.max(50, Math.min(600, Math.round(curSize * factor)));
        patchObj.size = newSize;
      } else if (t === 'sig') {
        const curSigW = it.sigWidth || 240;
        const curLineW = it.lineWidth || 300;
        const curNameSize = it.nameSize || 28;
        const curTitleSize = it.titleSize || 22;
        patchObj = {
          sigWidth: Math.max(60, Math.min(800, Math.round(curSigW * factor))),
          lineWidth: Math.max(80, Math.min(1000, Math.round(curLineW * factor))),
          nameSize: Math.max(12, Math.min(80, Math.round(curNameSize * factor))),
          titleSize: Math.max(10, Math.min(60, Math.round(curTitleSize * factor))),
        };
      }
      return { ...currentTpl, config: patchItem(currentTpl.config, ref, patchObj) };
    });
    setDirty(true);
  }, []);

  // Trackpad pinch gesture (wheel event with ctrlKey / metaKey)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // deltaY < 0 is pinch-out (expand), deltaY > 0 is pinch-in (contract)
        const factor = Math.exp(-e.deltaY * 0.007);
        if (selectedRef.current) {
          scaleItem(selectedRef.current, factor);
        }
      }
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [scaleItem]);

  // Draw certificate on canvas
  useEffect(() => {
    if (!assets || !canvasRef.current) return;
    const my = ++drawId.current;
    (async () => {
      try {
        await ensureFonts(cfg, values);
        if (my !== drawId.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const boxes = drawCertificate(canvas, tpl, assets, values, qrImg);
        if (!boxes) return;
        boxesRef.current = boxes;
        const ctx2 = canvas.getContext('2d');
        if (!ctx2) return;
        const lw = Math.max(2, (tpl?.width || DEFAULT_SIZE.width) / 700);

        boxes.forEach((b) => {
          const sel = b.ref === selected;
          ctx2.save();
          ctx2.lineWidth = sel ? lw * 2 : lw;
          ctx2.strokeStyle = sel ? '#d9730d' : 'rgba(100,116,139,.55)';
          if (!sel) ctx2.setLineDash([lw * 5, lw * 4]);
          ctx2.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);

          // Draw corner handles on the selected item for intuitive resize
          if (sel) {
            const hs = Math.max(10, lw * 3.5);
            const corners = [
              { x: b.x - 4, y: b.y - 4 },
              { x: b.x + b.w + 4, y: b.y - 4 },
              { x: b.x - 4, y: b.y + b.h + 4 },
              { x: b.x + b.w + 4, y: b.y + b.h + 4 },
            ];
            ctx2.setLineDash([]);
            corners.forEach((h) => {
              ctx2.fillStyle = '#ffffff';
              ctx2.strokeStyle = '#d9730d';
              ctx2.lineWidth = lw * 1.5;
              ctx2.beginPath();
              ctx2.arc(h.x, h.y, hs / 2, 0, Math.PI * 2);
              ctx2.fill();
              ctx2.stroke();
            });
          }
          ctx2.restore();
        });
      } catch (err) {
        console.error('Error drawing certificate preview:', err);
      }
    })();
  }, [tpl, assets, qrImg, values, selected, cfg]);

  // Coordinate conversion
  const toCanvas = (e) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
    };
  };

  // Pointer interactions (single pointer move/resize & two-finger pinch)
  const onDown = (e) => {
    const p = toCanvas(e);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Multi-touch Pinch Gesture (Touchscreen 2-finger pinch)
    if (pointersRef.current.size === 2) {
      const [p1, p2] = Array.from(pointersRef.current.values());
      pinchRef.current = {
        initialDist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        ref: selected,
      };
      dragRef.current = null;
      isInteractingRef.current = true;
      return;
    }

    // Single Pointer: Check if clicking a corner resize handle of the selected box
    if (selected) {
      const selBox = boxesRef.current.find((b) => b.ref === selected);
      if (selBox) {
        const lw = Math.max(2, (tpl?.width || DEFAULT_SIZE.width) / 700);
        const handleHitRadius = Math.max(16, lw * 5);
        const corners = [
          { id: 'tl', x: selBox.x - 4, y: selBox.y - 4 },
          { id: 'tr', x: selBox.x + selBox.w + 4, y: selBox.y - 4 },
          { id: 'bl', x: selBox.x - 4, y: selBox.y + selBox.h + 4 },
          { id: 'br', x: selBox.x + selBox.w + 4, y: selBox.y + selBox.h + 4 },
        ];
        const hitHandle = corners.find((h) => Math.hypot(p.x - h.x, p.y - h.y) <= handleHitRadius);
        if (hitHandle) {
          isInteractingRef.current = true;
          dragRef.current = {
            mode: 'resize',
            ref: selected,
            handle: hitHandle.id,
            center: { x: selBox.x + selBox.w / 2, y: selBox.y + selBox.h / 2 },
            startDist: Math.hypot(p.x - (selBox.x + selBox.w / 2), p.y - (selBox.y + selBox.h / 2)),
          };
          if (canvasRef.current?.setPointerCapture) canvasRef.current.setPointerCapture(e.pointerId);
          return;
        }
      }
    }

    // Item selection & move hit test
    const hit = [...boxesRef.current].reverse().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (!hit) {
      setSelected(null);
      setInlineEditing(null);
      return;
    }

    setSelected(hit.ref);
    const it = getItem(cfg, hit.ref);
    if (!it) return;

    isInteractingRef.current = true;
    dragRef.current = { mode: 'move', ref: hit.ref, sx: p.x, sy: p.y, ox: it.x, oy: it.y };
    if (canvasRef.current?.setPointerCapture) canvasRef.current.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Handle 2-finger Touch Pinch
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const [p1, p2] = Array.from(pointersRef.current.values());
      const curDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const factor = curDist / (pinchRef.current.initialDist || 1);
      if (factor > 0.4 && factor < 2.5) {
        scaleItem(pinchRef.current.ref || selected, factor);
        pinchRef.current.initialDist = curDist;
      }
      return;
    }

    // Handle Single pointer move or corner handle resize
    const d = dragRef.current;
    if (!d) return;

    const p = toCanvas(e);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (d.mode === 'move') {
        patch(d.ref, { x: Math.round(d.ox + p.x - d.sx), y: Math.round(d.oy + p.y - d.sy) });
      } else if (d.mode === 'resize') {
        const curDist = Math.hypot(p.x - d.center.x, p.y - d.center.y);
        const factor = curDist / (d.startDist || 1);
        if (factor > 0.3 && factor < 3) {
          scaleItem(d.ref, factor);
          d.startDist = curDist;
        }
      }
    });
  };

  const onUp = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (pointersRef.current.size === 0) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      dragRef.current = null;
      isInteractingRef.current = false;
    }
    if (e?.pointerId && canvasRef.current?.releasePointerCapture) {
      try {
        canvasRef.current.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  // Double-click on canvas for inline text editing
  const onDoubleClick = (e) => {
    const p = toCanvas(e);
    const hit = [...boxesRef.current].reverse().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (hit && hit.ref.startsWith('field:')) {
      setSelected(hit.ref);
      setInlineEditing(hit.ref);
    }
  };

  const item = selected ? getItem(cfg, selected) : null;
  const [selType] = selected ? parseRef(selected) : [null];

  // Actions
  const addText = () => {
    const id = uid();
    edit((c) => ({
      ...c,
      fields: [
        ...c.fields,
        {
          id,
          type: 'text',
          text: 'New text',
          x: tpl.width / 2,
          y: tpl.height / 2,
          size: 36,
          family: "'Manrope', 'Noto Sans Devanagari', sans-serif",
          weight: 500,
          italic: false,
          color: '#1f2937',
          align: 'center',
          mode: 'fit',
          maxWidth: Math.round(tpl.width * 0.7),
          lineHeight: 0,
          spacing: 0,
        },
      ],
    }));
    setSelected(`field:${id}`);
  };

  const addSignatory = () => {
    const id = uid();
    edit((c) => ({
      ...c,
      signatories: [
        ...c.signatories,
        {
          id,
          name: 'Authorised Signatory',
          title: 'Organizing Committee',
          path: null,
          x: Math.round(tpl.width * 0.7),
          y: Math.round(tpl.height * 0.8),
          sigWidth: 240,
          lineWidth: 300,
          nameSize: 28,
          titleSize: 22,
          family: "'Manrope', 'Noto Sans Devanagari', sans-serif",
          color: '#1f2937',
        },
      ],
    }));
    setSelected(`sig:${id}`);
  };

  const checkSize = (file, max = 5) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.error('Use a PNG, JPG or WebP image.');
      return false;
    }
    if (file.size > max * 1024 * 1024) {
      toast.error(`Image is larger than ${max} MB.`);
      return false;
    }
    return true;
  };

  const addLogo = async (file) => {
    if (!file || !checkSize(file)) return;
    setUploading('logo');
    try {
      const path = await uploadAsset(event.id, file, 'logo');
      const localUrl = URL.createObjectURL(file);
      try {
        const preloadedImg = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = localUrl;
        });
        cacheAssetImage(path, preloadedImg);
        setAssets((prev) => ({
          bg: prev?.bg || null,
          failedPaths: prev?.failedPaths || [],
          images: { ...(prev?.images || {}), [path]: preloadedImg },
        }));
      } catch (err) {
        console.warn('Failed to load logo image locally:', err);
      }
      const id = uid();
      edit((c) => ({
        ...c,
        images: [...c.images, { id, label: file.name, path, x: Math.round(tpl.width / 2), y: 150, width: 220 }],
      }));
      setSelected(`image:${id}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setUploading('');
    }
  };

  const setSignature = async (file) => {
    if (!file || !checkSize(file) || !selected) return;
    setUploading('sig');
    try {
      const path = await uploadAsset(event.id, file, 'signature');
      const localUrl = URL.createObjectURL(file);
      try {
        const preloadedImg = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = localUrl;
        });
        cacheAssetImage(path, preloadedImg);
        setAssets((prev) => ({
          bg: prev?.bg || null,
          failedPaths: prev?.failedPaths || [],
          images: { ...(prev?.images || {}), [path]: preloadedImg },
        }));
      } catch (err) {
        console.warn('Failed to load signature image locally:', err);
      }
      patch(selected, { path });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setUploading('');
    }
  };

  // Handle asset chosen from Global Store
  const handleSelectGlobalAsset = async (asset) => {
    setGlobalPickerOpen(false);
    if (!asset || !asset.path) return;

    try {
      const url = assetUrl(asset.path);
      const preloadedImg = await loadImage(url);
      cacheAssetImage(asset.path, preloadedImg);
      setAssets((prev) => ({
        bg: prev?.bg || null,
        failedPaths: prev?.failedPaths || [],
        images: { ...(prev?.images || {}), [asset.path]: preloadedImg },
      }));

      if (pickerTarget === 'logo') {
        const id = uid();
        const initialW = Math.min(asset.width || 240, 320);
        edit((c) => ({
          ...c,
          images: [
            ...c.images,
            { id, label: asset.name, path: asset.path, x: Math.round(tpl.width / 2), y: 160, width: initialW },
          ],
        }));
        setSelected(`image:${id}`);
        toast.ok(`Logo "${asset.name}" added from Global Store`);
      } else if (pickerTarget?.startsWith('sig:')) {
        const meta = asset.metadata || {};
        const patchData = { path: asset.path };
        if (meta.signer_name) patchData.name = meta.signer_name;
        if (meta.signer_title) patchData.title = meta.signer_title;
        patch(pickerTarget, patchData);
        toast.ok(`Signature attached to signatory`);
      }
    } catch (err) {
      toast.error(`Could not load global asset: ${err.message}`);
    }
  };

  const uploadBackground = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error('Use a PNG, JPG or WebP image.');
    if (file.size > 20 * 1024 * 1024) return toast.error('Template image is larger than 20 MB.');
    setUploading('bg');
    try {
      const { blob, width, height, ext } = await prepareBackground(file);
      const path = await uploadAsset(event.id, new File([blob], `bg.${ext}`, { type: blob.type || file.type }), 'bg');

      const localUrl = URL.createObjectURL(blob);
      let preloadedImg = null;
      try {
        preloadedImg = await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = localUrl;
        });
        cacheAssetImage(path, preloadedImg);
        setAssets((prev) => ({
          images: prev?.images || {},
          failedPaths: prev?.failedPaths || [],
          bg: preloadedImg,
        }));
      } catch (err) {
        console.warn('Failed to load template background locally:', err);
      }

      const nextTpl = {
        ...tpl,
        image_path: path,
        width,
        height,
        config: rescaleConfig(tpl.config, tpl.width, width, tpl.height, height),
      };
      setTpl(nextTpl);
      setDirty(true);
      await save(nextTpl);
      toast.ok(`Template image set (${width}×${height}). Check the text positions.`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setUploading('');
    }
  };

  const useDefaultBg = () => {
    setTpl((t) => ({
      ...t,
      image_path: null,
      width: DEFAULT_SIZE.width,
      height: DEFAULT_SIZE.height,
      config: rescaleConfig(t.config, t.width, DEFAULT_SIZE.width, t.height, DEFAULT_SIZE.height),
    }));
    setDirty(true);
  };

  const downloadPreview = async () => {
    try {
      const blob = await renderPdfBlob(tpl, assets, values, verifyUrl(SAMPLE_VALUES.code));
      downloadBlob(blob, 'certificate-preview.pdf');
    } catch (e) {
      toast.error(e.message);
    }
  };

  const addToken = (tok) => patch(selected, { text: `${item.text || ''}{{${tok}}}` });

  const fieldLabel = (f) => (f.text || '(empty)').replace(/\s+/g, ' ').slice(0, 30);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        {/* Top Control Bar */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => bgInput.current.click()}
            disabled={uploading === 'bg'}
          >
            {uploading === 'bg' ? <Spinner /> : <ImagePlus className="h-4 w-4" />}
            Upload template image
          </button>
          {tpl.image_path && (
            <button className="btn btn-ghost btn-sm" onClick={useDefaultBg}>
              Use plain background
            </button>
          )}
          <select
            className="input !w-auto !py-1.5 text-xs"
            value={previewIdx}
            onChange={(e) => setPreviewIdx(Number(e.target.value))}
            aria-label="Preview with participant"
          >
            <option value={-1}>Preview: sample name</option>
            {recipients.slice(0, 200).map((r, i) => (
              <option key={r.id} value={i}>
                Preview: {r.name}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={downloadPreview} disabled={!assets}>
            <Download className="h-4 w-4" />
            Preview PDF
          </button>

          {/* Auto-save & Status Area */}
          <div className="ml-auto flex items-center gap-2">
            {saveStatus === 'saving' && (
              <span className="badge badge-info flex items-center gap-1.5 text-xs">
                <Spinner className="h-3 w-3" /> Auto-saving...
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="badge badge-ok flex items-center gap-1 text-xs">
                <Check className="h-3 w-3 text-emerald-600" />
                {lastSaved
                  ? `Saved ${lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Auto-saved'}
              </span>
            )}
            {saveStatus === 'unsaved' && <span className="badge badge-warn text-xs">Unsaved changes</span>}
            {saveStatus === 'error' && <span className="badge badge-bad text-xs">Save failed</span>}

            <button
              className="btn btn-accent btn-sm"
              onClick={() => save()}
              disabled={saving || !dirty}
              title="Save now"
            >
              {saving ? <Spinner /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </div>

        <input
          ref={bgInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            uploadBackground(e.target.files[0]);
            e.target.value = '';
          }}
        />

        {/* Canvas Workspace */}
        <div className="card relative overflow-auto bg-slate-200 p-3">
          {!assets && (
            <div className="flex h-64 items-center justify-center text-slate2">
              <Spinner className="mr-2" />
              Loading template…
            </div>
          )}

          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={onDoubleClick}
            style={{
              maxWidth: '100%',
              maxHeight: '72vh',
              width: 'auto',
              height: 'auto',
              display: assets ? 'block' : 'none',
              margin: '0 auto',
              touchAction: 'none',
              cursor: 'move',
            }}
            className="bg-white shadow"
            aria-label="Certificate preview. Drag items to move them, pinch or drag corners to resize."
          />
        </div>

        {/* Helpful instructions bar */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            {tpl.width}×{tpl.height}px • Drag dashed box to move • <b>Pinch in/out</b> or drag corners to resize • Double-click text to edit
          </span>
          <span className="text-slate-400">All edits are auto-saved</span>
        </div>
      </div>

      {/* Sidebar Controls */}
      <aside className="space-y-4">
        {/* Add Elements Panel */}
        <div className="card p-3">
          <label className="label mb-1.5 text-xs uppercase font-bold tracking-wider text-slate-400">
            Add Element
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button className="btn btn-ghost btn-sm" onClick={addText}>
              <Type className="h-3.5 w-3.5" />
              Text
            </button>

            {/* Logo Buttons: Global Store or Local Upload */}
            <div className="inline-flex rounded-lg border border-line bg-white shadow-xs">
              <button
                className="btn btn-ghost btn-sm rounded-r-none border-r border-line"
                onClick={() => {
                  setPickerTarget('logo');
                  setGlobalPickerCat('logo');
                  setGlobalPickerOpen(true);
                }}
                title="Pick logo from Global Store (shared library)"
              >
                <Library className="h-3.5 w-3.5 text-amber-600" />
                Logo (Store)
              </button>
              <button
                className="btn btn-ghost btn-sm rounded-l-none px-2"
                onClick={() => logoInput.current.click()}
                disabled={uploading === 'logo'}
                title="Upload custom logo file"
              >
                {uploading === 'logo' ? <Spinner /> : <Upload className="h-3.5 w-3.5" />}
              </button>
            </div>

            <button className="btn btn-ghost btn-sm" onClick={addSignatory}>
              <PenLine className="h-3.5 w-3.5" />
              Signatory
            </button>

            {!cfg.qr.enabled && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  edit((c) => ({ ...c, qr: { ...c.qr, enabled: true } }));
                  setSelected('qr');
                }}
              >
                <QrCode className="h-3.5 w-3.5" />
                QR code
              </button>
            )}
          </div>

          <input
            ref={logoInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              addLogo(e.target.files[0]);
              e.target.value = '';
            }}
          />

          {/* Elements List */}
          <ul className="max-h-48 divide-y divide-line overflow-y-auto text-sm">
            {cfg.fields.map((f) => (
              <li key={f.id}>
                <button
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-mist ${
                    selected === `field:${f.id}` ? 'bg-saffron-50 font-semibold' : ''
                  }`}
                  onClick={() => setSelected(`field:${f.id}`)}
                >
                  <Type className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{fieldLabel(f)}</span>
                </button>
              </li>
            ))}
            {cfg.images.map((i) => (
              <li key={i.id}>
                <button
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-mist ${
                    selected === `image:${i.id}` ? 'bg-saffron-50 font-semibold' : ''
                  }`}
                  onClick={() => setSelected(`image:${i.id}`)}
                >
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{i.label || 'Image'}</span>
                </button>
              </li>
            ))}
            {cfg.signatories.map((s) => (
              <li key={s.id}>
                <button
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-mist ${
                    selected === `sig:${s.id}` ? 'bg-saffron-50 font-semibold' : ''
                  }`}
                  onClick={() => setSelected(`sig:${s.id}`)}
                >
                  <PenLine className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">Signatory: {s.name}</span>
                </button>
              </li>
            ))}
            {cfg.qr.enabled && (
              <li>
                <button
                  className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-mist ${
                    selected === 'qr' ? 'bg-saffron-50 font-semibold' : ''
                  }`}
                  onClick={() => setSelected('qr')}
                >
                  <QrCode className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span>Verification QR code</span>
                </button>
              </li>
            )}
          </ul>
        </div>

        {/* Selected Item Properties Panel */}
        <div className="card space-y-3 p-4">
          {!item && <p className="text-sm text-slate2">Select an item on the certificate or from the list to edit it.</p>}

          {/* Text Field Edit */}
          {item && selType === 'field' && (
            <>
              <div>
                <Field label="Text">
                  <textarea
                    rows={3}
                    className="input min-h-[72px]"
                    value={item.text}
                    placeholder="Enter certificate text... Press Enter for a new line"
                    onChange={(e) => patch(selected, { text: e.target.value })}
                  />
                </Field>
                <p className="mt-1 text-xs text-slate-500">
                  💡 Tip: Press <kbd className="rounded border bg-slate-100 px-1 py-0.5 font-mono text-[11px]">Enter</kbd> to move text to the next line.
                </p>
              </div>

              <div className="flex flex-wrap gap-1">
                {[...BASE_TOKENS, ...extraTokens].map((t) => (
                  <button key={t} type="button" className="chip" onClick={() => addToken(t)}>
                    {`{{${t}}}`}
                  </button>
                ))}
              </div>

              {/* Categorized Font Dropdown */}
              <Field label="Font">
                <select
                  className="input"
                  value={item.family}
                  onChange={(e) => patch(selected, { family: e.target.value })}
                >
                  {FONT_GROUPS.map((group) => (
                    <optgroup key={group.category} label={group.category}>
                      {group.fonts.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-3 gap-2">
                <Num label="Size (px)" value={item.size} min={8} onChange={(v) => patch(selected, { size: v })} />
                <Field label="Weight">
                  <select
                    className="input"
                    value={item.weight}
                    onChange={(e) => patch(selected, { weight: Number(e.target.value) })}
                  >
                    {[300, 400, 500, 600, 700, 800].map((w) => (
                      <option key={w}>{w}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Color">
                  <input
                    type="color"
                    className="h-[38px] w-full cursor-pointer rounded-lg border border-line"
                    value={item.color}
                    onChange={(e) => patch(selected, { color: e.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Align">
                  <select
                    className="input"
                    value={item.align}
                    onChange={(e) => patch(selected, { align: e.target.value })}
                  >
                    <option value="center">Center</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </Field>
                <Field label="Long text">
                  <select
                    className="input"
                    value={item.mode}
                    onChange={(e) => patch(selected, { mode: e.target.value })}
                  >
                    <option value="fit">Shrink to fit width</option>
                    <option value="wrap">Wrap onto lines</option>
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Num label="Max width" value={item.maxWidth} onChange={(v) => patch(selected, { maxWidth: v })} />
                <Num label="Line height" value={item.lineHeight} onChange={(v) => patch(selected, { lineHeight: v })} />
                <Num label="Letter gap" value={item.spacing} onChange={(v) => patch(selected, { spacing: v })} />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!item.italic}
                  onChange={(e) => patch(selected, { italic: e.target.checked })}
                />
                Italic
              </label>

              <div className="grid grid-cols-2 gap-2">
                <Num label="X" value={item.x} onChange={(v) => patch(selected, { x: v })} />
                <Num label="Y" value={item.y} onChange={(v) => patch(selected, { y: v })} />
              </div>
            </>
          )}

          {/* QR Code Edit */}
          {item && selType === 'qr' && (
            <>
              <p className="text-sm text-slate2">The QR code opens this certificate’s verify page.</p>
              <div className="grid grid-cols-3 gap-2">
                <Num label="Size" value={item.size} min={50} onChange={(v) => patch('qr', { size: v })} />
                <Num label="X" value={item.x} onChange={(v) => patch('qr', { x: v })} />
                <Num label="Y" value={item.y} onChange={(v) => patch('qr', { y: v })} />
              </div>
            </>
          )}

          {/* Image Edit */}
          {item && selType === 'image' && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Num label="Width (px)" value={item.width} min={20} onChange={(v) => patch(selected, { width: v })} />
                <Num label="X" value={item.x} onChange={(v) => patch(selected, { x: v })} />
                <Num label="Y" value={item.y} onChange={(v) => patch(selected, { y: v })} />
              </div>
              <p className="text-xs text-slate-500">
                💡 Tip: Pinch in/out on touch/trackpad or drag corners to resize.
              </p>
            </div>
          )}

          {/* Signatory Edit */}
          {item && selType === 'sig' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Name">
                  <input
                    className="input"
                    value={item.name}
                    onChange={(e) => patch(selected, { name: e.target.value })}
                  />
                </Field>
                <Field label="Designation">
                  <input
                    className="input"
                    value={item.title}
                    onChange={(e) => patch(selected, { title: e.target.value })}
                  />
                </Field>
              </div>

              {/* Signature Asset Picker: Global Store or Local File */}
              <div>
                <label className="label">Signature Image</label>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setPickerTarget(selected);
                      setGlobalPickerCat('signature');
                      setGlobalPickerOpen(true);
                    }}
                    title="Choose official signature from Global Store"
                  >
                    <Library className="h-3.5 w-3.5 text-amber-600" />
                    Pick from Global Store
                  </button>

                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => sigInput.current.click()}
                    disabled={uploading === 'sig'}
                  >
                    {uploading === 'sig' ? <Spinner /> : <ImagePlus className="h-3.5 w-3.5" />}
                    Upload new
                  </button>

                  {item.path && (
                    <button className="btn btn-ghost btn-sm text-rose-600" onClick={() => patch(selected, { path: null })}>
                      Remove
                    </button>
                  )}
                  <input
                    ref={sigInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      setSignature(e.target.files[0]);
                      e.target.value = '';
                    }}
                  />
                </div>
                {item.path && (
                  <p className="mt-1 text-[11px] text-slate-500 truncate" title={item.path}>
                    Current: {item.path}
                  </p>
                )}
              </div>

              <Field label="Font">
                <select
                  className="input"
                  value={item.family}
                  onChange={(e) => patch(selected, { family: e.target.value })}
                >
                  {FONT_GROUPS.map((group) => (
                    <optgroup key={group.category} label={group.category}>
                      {group.fonts.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-3 gap-2">
                <Num label="Name size" value={item.nameSize} onChange={(v) => patch(selected, { nameSize: v })} />
                <Num label="Title size" value={item.titleSize} onChange={(v) => patch(selected, { titleSize: v })} />
                <Field label="Color">
                  <input
                    type="color"
                    className="h-[38px] w-full cursor-pointer rounded-lg border border-line"
                    value={item.color}
                    onChange={(e) => patch(selected, { color: e.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Num label="Signature width" value={item.sigWidth} onChange={(v) => patch(selected, { sigWidth: v })} />
                <Num label="Line width" value={item.lineWidth} onChange={(v) => patch(selected, { lineWidth: v })} />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Num label="X" value={item.x} onChange={(v) => patch(selected, { x: v })} />
                <Num label="Y (line)" value={item.y} onChange={(v) => patch(selected, { y: v })} />
              </div>
            </>
          )}

          {item && (
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                edit((c) => removeItem(c, selected));
                setSelected(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {selType === 'qr' ? 'Remove QR code' : 'Delete item'}
            </button>
          )}
        </div>
      </aside>

      {/* Global Asset Picker Modal */}
      <GlobalAssetPickerModal
        open={globalPickerOpen}
        onClose={() => setGlobalPickerOpen(false)}
        initialCategory={globalPickerCat}
        title={pickerTarget === 'logo' ? 'Choose Logo from Global Store' : 'Choose Signature from Global Store'}
        onSelect={handleSelectGlobalAsset}
      />
    </div>
  );
}
