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
  Undo2,
  Redo2,
  Magnet,
  Layers as LayersIcon,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Copy,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Hand,
  Award,
  Sparkles,
  LayoutTemplate,
  Sliders,
  ChevronUp,
  SlidersHorizontal,
  Compass,
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
import { PAPER_SIZES, BADGE_VARIANTS, CERTIFICATE_PRESETS } from '../../lib/presets';
import { Field, Spinner, useToast } from '../../components/ui';
import GlobalAssetPickerModal from '../../components/GlobalAssetPickerModal';
import PresetPickerModal from '../../components/PresetPickerModal';

const parseRef = (ref) => {
  const i = ref ? ref.indexOf(':') : -1;
  return i < 0 ? [ref, null] : [ref.slice(0, i), ref.slice(i + 1)];
};

const LIST = { field: 'fields', image: 'images', sig: 'signatories', badge: 'badges' };

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
  let updatedLayers = cfg.layers ? cfg.layers.filter((l) => l !== ref) : undefined;
  if (t === 'qr') return { ...cfg, qr: { ...cfg.qr, enabled: false }, layers: updatedLayers };
  const key = LIST[t];
  if (!key || !cfg[key]) return cfg;
  return { ...cfg, [key]: cfg[key].filter((x) => x.id !== id), layers: updatedLayers };
}

function normalize(cfg) {
  const base = cfg && Array.isArray(cfg.fields) ? cfg : defaultConfig();
  return {
    fields: base.fields || [],
    badges: base.badges || [],
    images: base.images || [],
    signatories: base.signatories || [],
    qr: base.qr || { enabled: true, x: 1580, y: 1040, size: 190 },
    layers: base.layers,
    bgStyle: base.bgStyle || 'gold-double',
  };
}

function Num({ label, value, onChange, step = 1, min, max }) {
  return (
    <label className="block">
      <span className="label text-[11px]">{label}</span>
      <input
        type="number"
        className="input !py-1 text-xs"
        value={value ?? 0}
        step={step}
        min={min}
        max={max}
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

  // Undo / Redo History Stack
  const [past, setPast] = useState([]);
  const [future, setFuture] = useState([]);

  const recordHistory = useCallback((currentTpl = tpl) => {
    setPast((p) => [...p.slice(-40), JSON.parse(JSON.stringify(currentTpl))]);
    setFuture([]);
  }, [tpl]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, p.length - 1));
    setFuture((f) => [JSON.parse(JSON.stringify(tpl)), ...f.slice(0, 40)]);
    setTpl(prev);
    setDirty(true);
    toast.ok('Undone');
  }, [past, tpl, toast]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, JSON.parse(JSON.stringify(tpl))]);
    setTpl(next);
    setDirty(true);
    toast.ok('Redone');
  }, [future, tpl, toast]);

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

  // Sidebar Tab: 'properties' or 'layers'
  const [sidebarTab, setSidebarTab] = useState('properties');

  // Magnetic Snapping & Alignment Guides
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const activeGuidesRef = useRef([]);

  // Zoom & Pan state
  const [zoomLevel, setZoomLevel] = useState('fit'); // 'fit', 0.5, 0.75, 1, 1.5, 2
  const [isPanMode, setIsPanMode] = useState(false);
  const [isSpacePanning, setIsSpacePanning] = useState(false);
  const workspaceRef = useRef(null);
  const panStartRef = useRef(null);

  // Modals state
  const [presetModalOpen, setPresetModalOpen] = useState(false);
  const [badgeMenuOpen, setBadgeMenuOpen] = useState(false);
  const [globalPickerOpen, setGlobalPickerOpen] = useState(false);
  const [globalPickerCat, setGlobalPickerCat] = useState('all');
  const [pickerTarget, setPickerTarget] = useState(null); // 'logo' or sig ID

  // Sizing menu dropdown
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);

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

  const edit = useCallback((fn, shouldRecord = false) => {
    if (shouldRecord) recordHistory();
    setTpl((t) => ({ ...t, config: fn(t.config) }));
    setDirty(true);
  }, [recordHistory]);

  const patch = useCallback((ref, p, shouldRecord = false) => {
    edit((c) => patchItem(c, ref, p), shouldRecord);
  }, [edit]);

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
    cfg.bgStyle,
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
      } else if (t === 'badge') {
        const curSize = it.size || 190;
        patchObj.size = Math.max(40, Math.min(1600, Math.round(curSize * factor)));
      } else if (t === 'image') {
        const curW = it.width || 200;
        patchObj.width = Math.max(30, Math.min(currentTpl.width, Math.round(curW * factor)));
      } else if (t === 'qr') {
        const curSize = it.size || 180;
        patchObj.size = Math.max(50, Math.min(600, Math.round(curSize * factor)));
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
        const factor = Math.exp(-e.deltaY * 0.007);
        if (selectedRef.current) {
          scaleItem(selectedRef.current, factor);
        }
      }
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [scaleItem]);

  // Draw certificate on canvas with magnetic guides and bounds
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

        // Draw magnetic alignment snap lines if active
        if (activeGuidesRef.current && activeGuidesRef.current.length > 0) {
          activeGuidesRef.current.forEach((g) => {
            ctx2.save();
            ctx2.strokeStyle = '#06b6d4';
            ctx2.lineWidth = lw * 1.5;
            ctx2.setLineDash([lw * 4, lw * 3]);
            ctx2.beginPath();
            if (g.type === 'v') {
              ctx2.moveTo(g.x, 0);
              ctx2.lineTo(g.x, tpl.height);
            } else if (g.type === 'h') {
              ctx2.moveTo(0, g.y);
              ctx2.lineTo(tpl.width, g.y);
            }
            ctx2.stroke();
            ctx2.restore();
          });
        }

        // Draw selection bounding boxes and resize corner handles
        boxes.forEach((b) => {
          const sel = b.ref === selected;
          const it = getItem(cfg, b.ref);
          if (it?.hidden) return;

          ctx2.save();
          ctx2.lineWidth = sel ? lw * 2.2 : lw;
          ctx2.strokeStyle = sel ? '#d9730d' : 'rgba(100,116,139,.45)';
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

  // Pointer interactions
  const onDown = (e) => {
    // Pan mode handling
    if (isPanMode || isSpacePanning || e.button === 1) {
      const container = workspaceRef.current;
      if (container) {
        panStartRef.current = {
          scrollLeft: container.scrollLeft,
          scrollTop: container.scrollTop,
          clientX: e.clientX,
          clientY: e.clientY,
        };
        if (canvasRef.current?.setPointerCapture) canvasRef.current.setPointerCapture(e.pointerId);
      }
      return;
    }

    const p = toCanvas(e);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Multi-touch Pinch Gesture
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
      const it = getItem(cfg, selected);
      if (selBox && !it?.locked) {
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
          recordHistory();
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
    const hit = [...boxesRef.current].reverse().find((b) => {
      const it = getItem(cfg, b.ref);
      return !it?.hidden && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    });

    if (!hit) {
      setSelected(null);
      return;
    }

    setSelected(hit.ref);
    const it = getItem(cfg, hit.ref);
    if (!it || it.locked) return;

    recordHistory();
    isInteractingRef.current = true;
    dragRef.current = { mode: 'move', ref: hit.ref, sx: p.x, sy: p.y, ox: it.x, oy: it.y };
    if (canvasRef.current?.setPointerCapture) canvasRef.current.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    // Pan viewport handling
    if (panStartRef.current && workspaceRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      workspaceRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      workspaceRef.current.scrollTop = panStartRef.current.scrollTop - dy;
      return;
    }

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

    // Handle Single pointer move with magnetic snapping
    const d = dragRef.current;
    if (!d) return;

    const p = toCanvas(e);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (d.mode === 'move') {
        let newX = Math.round(d.ox + p.x - d.sx);
        let newY = Math.round(d.oy + p.y - d.sy);

        const guides = [];
        if (snappingEnabled) {
          const SNAP_THRESHOLD = 14;
          const W = tpl.width;
          const H = tpl.height;
          const m = Math.round(Math.min(W, H) * 0.04);

          const xTargets = [
            { x: Math.round(W / 2), label: 'Center' },
            { x: m, label: 'Margin' },
            { x: W - m, label: 'Margin' },
          ];
          const yTargets = [
            { y: Math.round(H / 2), label: 'Center' },
            { y: m, label: 'Margin' },
            { y: H - m, label: 'Margin' },
          ];

          boxesRef.current.forEach((b) => {
            if (b.ref === d.ref) return;
            xTargets.push({ x: Math.round(b.x + b.w / 2), label: 'Align' });
            yTargets.push({ y: Math.round(b.y + b.h / 2), label: 'Align' });
          });

          for (const t of xTargets) {
            if (Math.abs(newX - t.x) <= SNAP_THRESHOLD) {
              newX = t.x;
              guides.push({ type: 'v', x: t.x });
              break;
            }
          }
          for (const t of yTargets) {
            if (Math.abs(newY - t.y) <= SNAP_THRESHOLD) {
              newY = t.y;
              guides.push({ type: 'h', y: t.y });
              break;
            }
          }
        }

        activeGuidesRef.current = guides;
        patch(d.ref, { x: newX, y: newY });
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
    if (panStartRef.current) {
      panStartRef.current = null;
    }
    activeGuidesRef.current = [];
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

  // Keyboard Shortcuts (Undo, Redo, Duplicate, Delete, Nudge)
  useEffect(() => {
    const onKeyDown = (e) => {
      const isEditingText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable;

      if (e.key === 'Escape') {
        setSelected(null);
        setBadgeMenuOpen(false);
        setSizeMenuOpen(false);
        return;
      }

      if (e.code === 'Space' && !isEditingText && !e.repeat) {
        setIsSpacePanning(true);
      }

      if (isEditingText) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlKey = isMac ? e.metaKey : e.ctrlKey;

      if (ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      if ((ctrlKey && e.key.toLowerCase() === 'y') || (ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        redo();
        return;
      }

      if (ctrlKey && e.key.toLowerCase() === 'd' && selectedRef.current) {
        e.preventDefault();
        duplicateItem(selectedRef.current);
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
        e.preventDefault();
        const currentSel = selectedRef.current;
        recordHistory();
        edit((c) => removeItem(c, currentSel));
        setSelected(null);
        toast.ok('Item deleted');
        return;
      }

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && selectedRef.current) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const it = getItem(cfg, selectedRef.current);
        if (!it || it.locked) return;
        let dx = 0;
        let dy = 0;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        patch(selectedRef.current, { x: (it.x || 0) + dx, y: (it.y || 0) + dy });
      }
    };

    const onKeyUp = (e) => {
      if (e.code === 'Space') {
        setIsSpacePanning(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [undo, redo, cfg, patch, edit, recordHistory]);

  const item = selected ? getItem(cfg, selected) : null;
  const [selType] = selected ? parseRef(selected) : [null];

  // Actions: Add Elements
  const addText = () => {
    recordHistory();
    const id = uid();
    const newRef = `field:${id}`;
    edit((c) => ({
      ...c,
      fields: [
        ...c.fields,
        {
          id,
          type: 'text',
          text: 'New text',
          x: Math.round(tpl.width / 2),
          y: Math.round(tpl.height / 2),
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
      layers: c.layers ? [...c.layers, newRef] : undefined,
    }));
    setSelected(newRef);
    setSidebarTab('properties');
  };

  const addBadge = (variant = 'gold-seal') => {
    recordHistory();
    const id = uid();
    const newRef = `badge:${id}`;
    const isWreath = variant === 'laurel-wreath';
    const isDivider = variant === 'divider-flourish';
    const isRibbon = variant === 'ribbon-banner';
    const isCorner = variant === 'corner-flourish';

    edit((c) => ({
      ...c,
      badges: [
        ...(c.badges || []),
        {
          id,
          type: 'badge',
          variant,
          x: Math.round(tpl.width / 2),
          y: isCorner ? Math.round(tpl.height / 2) : Math.round(tpl.height * 0.75),
          size: isCorner ? Math.round(tpl.width * 0.9) : isDivider ? 500 : isRibbon ? 280 : 190,
          color: variant === 'silver-seal' ? '#94a3b8' : variant === 'bronze-seal' ? '#ea580c' : '#c8a24a',
          secondaryColor: variant === 'silver-seal' ? '#475569' : variant === 'bronze-seal' ? '#9a3412' : '#996515',
          text: isWreath ? 'HONOR' : isRibbon ? 'OFFICIAL' : 'EXCELLENCE',
          subtext: variant === 'gold-seal' ? 'MERIT' : '',
          opacity: 1,
        },
      ],
      layers: c.layers ? [newRef, ...c.layers] : undefined, // badges usually look good behind text
    }));
    setSelected(newRef);
    setBadgeMenuOpen(false);
    setSidebarTab('properties');
  };

  const addSignatory = () => {
    recordHistory();
    const id = uid();
    const newRef = `sig:${id}`;
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
      layers: c.layers ? [...c.layers, newRef] : undefined,
    }));
    setSelected(newRef);
    setSidebarTab('properties');
  };

  const duplicateItem = (ref) => {
    if (!ref) return;
    const it = getItem(cfg, ref);
    if (!it) return;
    const [t] = parseRef(ref);
    if (t === 'qr') return;
    recordHistory();
    const newId = uid();
    const copy = {
      ...it,
      id: newId,
      x: Math.min(tpl.width - 40, (it.x || 0) + 30),
      y: Math.min(tpl.height - 40, (it.y || 0) + 30),
      label: it.label ? `${it.label} (Copy)` : undefined,
    };
    const newRef = `${t}:${newId}`;

    edit((c) => {
      const key = LIST[t];
      const updatedList = [...(c[key] || []), copy];
      let updatedLayers = c.layers ? [...c.layers] : null;
      if (updatedLayers) {
        const idx = updatedLayers.indexOf(ref);
        if (idx >= 0) updatedLayers.splice(idx + 1, 0, newRef);
        else updatedLayers.push(newRef);
      }
      return { ...c, [key]: updatedList, ...(updatedLayers ? { layers: updatedLayers } : {}) };
    });
    setSelected(newRef);
    toast.ok('Item duplicated');
  };

  // Layer Reordering (Z-Index)
  const allLayerRefs = useMemo(() => {
    let list = Array.isArray(cfg.layers) && cfg.layers.length > 0 ? [...cfg.layers] : null;
    if (!list) {
      list = [
        ...(cfg.badges || []).map((b) => `badge:${b.id}`),
        ...(cfg.images || []).map((i) => `image:${i.id}`),
        ...(cfg.fields || []).map((f) => `field:${f.id}`),
        ...(cfg.signatories || []).map((s) => `sig:${s.id}`),
        ...(cfg.qr?.enabled ? ['qr'] : []),
      ];
    }
    return list;
  }, [cfg]);

  const moveLayer = (ref, direction) => {
    const list = [...allLayerRefs];
    const idx = list.indexOf(ref);
    if (idx < 0) return;
    recordHistory();

    if (direction === 'up' && idx < list.length - 1) {
      const temp = list[idx];
      list[idx] = list[idx + 1];
      list[idx + 1] = temp;
    } else if (direction === 'down' && idx > 0) {
      const temp = list[idx];
      list[idx] = list[idx - 1];
      list[idx - 1] = temp;
    } else if (direction === 'top') {
      list.splice(idx, 1);
      list.push(ref);
    } else if (direction === 'bottom') {
      list.splice(idx, 1);
      list.unshift(ref);
    }

    edit((c) => ({ ...c, layers: list }));
  };

  // Preset Template Application
  const applyPreset = (preset) => {
    recordHistory();
    const nextTpl = {
      ...tpl,
      image_path: null,
      width: preset.width,
      height: preset.height,
      config: JSON.parse(JSON.stringify(preset.config)),
    };
    setTpl(nextTpl);
    setDirty(true);
    setSelected(null);
    toast.ok(`Applied "${preset.title}" preset`);
  };

  // Dimensions & Orientation Change
  const applyPaperSize = (paper) => {
    if (paper.width === tpl.width && paper.height === tpl.height) return;
    recordHistory();
    const nextConfig = rescaleConfig(tpl.config, tpl.width, paper.width, tpl.height, paper.height);
    const nextTpl = {
      ...tpl,
      width: paper.width,
      height: paper.height,
      config: nextConfig,
    };
    setTpl(nextTpl);
    setDirty(true);
    setSizeMenuOpen(false);
    toast.ok(`Changed canvas size to ${paper.name} (${paper.width}×${paper.height})`);
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
      recordHistory();
      const id = uid();
      const newRef = `image:${id}`;
      edit((c) => ({
        ...c,
        images: [...c.images, { id, label: file.name, path, x: Math.round(tpl.width / 2), y: 150, width: 220 }],
        layers: c.layers ? [...c.layers, newRef] : undefined,
      }));
      setSelected(newRef);
      setSidebarTab('properties');
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
      recordHistory();
      patch(selected, { path });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setUploading('');
    }
  };

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

      recordHistory();
      if (pickerTarget === 'logo') {
        const id = uid();
        const initialW = Math.min(asset.width || 240, 320);
        const newRef = `image:${id}`;
        edit((c) => ({
          ...c,
          images: [
            ...c.images,
            { id, label: asset.name, path: asset.path, x: Math.round(tpl.width / 2), y: 160, width: initialW },
          ],
          layers: c.layers ? [...c.layers, newRef] : undefined,
        }));
        setSelected(newRef);
        setSidebarTab('properties');
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

      recordHistory();
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
      toast.ok(`Template image set (${width}×${height}). Check positions.`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setUploading('');
    }
  };

  const useDefaultBg = () => {
    recordHistory();
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

  const addToken = (tok) => patch(selected, { text: `${item.text || ''}{{${tok}}}` }, true);

  const getElementLabel = (ref) => {
    const it = getItem(cfg, ref);
    if (!it) return ref;
    const [t] = parseRef(ref);
    if (it.label) return it.label;
    if (t === 'qr') return 'Verification QR Code';
    if (t === 'field') return (it.text || '(empty text)').replace(/\s+/g, ' ').slice(0, 24);
    if (t === 'sig') return `Signature: ${it.name || 'Signatory'}`;
    if (t === 'badge') {
      const found = BADGE_VARIANTS.find((b) => b.id === it.variant);
      return found?.name || 'Badge';
    }
    if (t === 'image') return it.label || 'Logo / Graphic';
    return ref;
  };

  // Zoom canvas dimensions calculation
  const getCanvasStyle = () => {
    if (zoomLevel === 'fit') {
      return {
        maxWidth: '100%',
        maxHeight: '72vh',
        width: 'auto',
        height: 'auto',
        display: assets ? 'block' : 'none',
        margin: '0 auto',
        touchAction: 'none',
        cursor: isPanMode || isSpacePanning ? 'grab' : 'default',
      };
    }
    const factor = Number(zoomLevel);
    // Base scale reference: 100% renders at ~850px width for A4
    const baseWidth = Math.min(1000, tpl.width * 0.55);
    const cssW = Math.round(baseWidth * factor);
    const cssH = Math.round((cssW * tpl.height) / tpl.width);
    return {
      width: `${cssW}px`,
      height: `${cssH}px`,
      maxWidth: 'none',
      maxHeight: 'none',
      display: assets ? 'block' : 'none',
      margin: '0 auto',
      touchAction: 'none',
      cursor: isPanMode || isSpacePanning ? 'grab' : 'default',
    };
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        {/* Top Control Bar: Actions, Presets, Undo/Redo, Zoom */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-white p-2 shadow-xs">
          {/* Left: Presets, Size, Background */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Presets Modal Trigger */}
            <button
              className="btn btn-accent btn-sm shadow-xs"
              onClick={() => setPresetModalOpen(true)}
              title="Browse ready-to-use certificate designs"
            >
              <LayoutTemplate className="h-4 w-4" />
              Templates
            </button>

            {/* Sizing & Orientation Dropdown */}
            <div className="relative">
              <button
                className="btn btn-ghost btn-sm text-xs font-semibold"
                onClick={() => setSizeMenuOpen(!sizeMenuOpen)}
                title="Change canvas dimensions & orientation"
              >
                <Compass className="h-3.5 w-3.5 text-slate-500" />
                {tpl.width > tpl.height ? 'Landscape' : tpl.width < tpl.height ? 'Portrait' : 'Square'} ({tpl.width}×{tpl.height})
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>

              {sizeMenuOpen && (
                <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-xl border border-line bg-white p-1.5 shadow-xl">
                  <div className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Orientation & Dimensions
                  </div>
                  {PAPER_SIZES.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => applyPaperSize(p)}
                      className={`flex w-full items-start justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition hover:bg-mist ${
                        tpl.width === p.width && tpl.height === p.height ? 'bg-saffron-50 font-bold text-saffron-800' : 'text-slate-700'
                      }`}
                    >
                      <div>
                        <p className="font-semibold">{p.name}</p>
                        <p className="text-[10px] text-slate-400">{p.width} × {p.height} px • {p.description}</p>
                      </div>
                      {tpl.width === p.width && tpl.height === p.height && <Check className="h-4 w-4 text-saffron-600 shrink-0 mt-0.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Background Upload */}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => bgInput.current.click()}
              disabled={uploading === 'bg'}
              title="Upload custom certificate background"
            >
              {uploading === 'bg' ? <Spinner /> : <ImagePlus className="h-3.5 w-3.5" />}
              Background
            </button>
            {tpl.image_path && (
              <button className="btn btn-ghost btn-sm text-xs" onClick={useDefaultBg}>
                Plain BG
              </button>
            )}

            {/* Snapping Toggle */}
            <button
              className={`btn btn-sm ${snappingEnabled ? 'btn-ghost text-cyan-700 bg-cyan-50 border border-cyan-200' : 'btn-ghost text-slate-400'}`}
              onClick={() => setSnappingEnabled(!snappingEnabled)}
              title={snappingEnabled ? 'Magnetic snapping enabled' : 'Snapping disabled'}
            >
              <Magnet className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Snap</span>
            </button>
          </div>

          {/* Center / Right: Undo/Redo, Zoom, Auto-save */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Undo / Redo */}
            <div className="flex items-center rounded-lg border border-line bg-slate-50 p-0.5">
              <button
                className="rounded-md p-1.5 text-slate-700 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent"
                onClick={undo}
                disabled={past.length === 0}
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="h-3.5 w-3.5" />
              </button>
              <button
                className="rounded-md p-1.5 text-slate-700 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent"
                onClick={redo}
                disabled={future.length === 0}
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center rounded-lg border border-line bg-slate-50 p-0.5">
              <button
                className="rounded-md p-1.5 text-slate-700 hover:bg-white"
                onClick={() => {
                  const levels = [0.5, 0.75, 1, 1.5, 2];
                  const cur = zoomLevel === 'fit' ? 1 : Number(zoomLevel);
                  const prev = [...levels].reverse().find((l) => l < cur);
                  if (prev) setZoomLevel(prev);
                }}
                title="Zoom Out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                className={`rounded-md px-1.5 py-1 text-xs font-semibold ${zoomLevel === 'fit' ? 'bg-white shadow-xs text-ink' : 'text-slate-600'}`}
                onClick={() => setZoomLevel('fit')}
                title="Fit to Screen"
              >
                {zoomLevel === 'fit' ? 'Fit' : `${Math.round(Number(zoomLevel) * 100)}%`}
              </button>
              <button
                className="rounded-md p-1.5 text-slate-700 hover:bg-white"
                onClick={() => {
                  const levels = [0.5, 0.75, 1, 1.5, 2];
                  const cur = zoomLevel === 'fit' ? 1 : Number(zoomLevel);
                  const next = levels.find((l) => l > cur);
                  if (next) setZoomLevel(next);
                }}
                title="Zoom In"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                className={`rounded-md p-1.5 ${isPanMode ? 'bg-amber-100 text-amber-800' : 'text-slate-700 hover:bg-white'}`}
                onClick={() => setIsPanMode(!isPanMode)}
                title="Pan Canvas tool (or hold Spacebar)"
              >
                <Hand className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Preview Participant */}
            <select
              className="input !w-auto !py-1 text-xs"
              value={previewIdx}
              onChange={(e) => setPreviewIdx(Number(e.target.value))}
              aria-label="Preview with participant"
            >
              <option value={-1}>Preview: Sample Recipient</option>
              {recipients.slice(0, 200).map((r, i) => (
                <option key={r.id} value={i}>
                  Preview: {r.name}
                </option>
              ))}
            </select>

            <button className="btn btn-ghost btn-sm" onClick={downloadPreview} disabled={!assets} title="Export test PDF">
              <Download className="h-3.5 w-3.5" />
            </button>

            {/* Save Status & Manual Save */}
            <button
              className="btn btn-primary btn-sm ml-1"
              onClick={() => save()}
              disabled={saving || !dirty}
              title="Save template"
            >
              {saving ? <Spinner /> : <Save className="h-3.5 w-3.5" />}
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

        {/* Canvas Workspace Viewport */}
        <div
          ref={workspaceRef}
          className="card relative max-h-[76vh] overflow-auto rounded-2xl bg-slate-200/90 p-4 shadow-inner"
        >
          {!assets && (
            <div className="flex h-72 items-center justify-center text-slate-500">
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
            style={getCanvasStyle()}
            className="rounded-lg bg-white shadow-lg ring-1 ring-black/5"
            aria-label="Certificate preview canvas"
          />
        </div>

        {/* Canvas Status & Keyboard Shortcuts Helper */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            {tpl.width}×{tpl.height}px • Drag to move • Pinch/Corner handles to resize • <kbd className="rounded border bg-white px-1 font-mono text-[10px]">Ctrl+Z</kbd> Undo • <kbd className="rounded border bg-white px-1 font-mono text-[10px]">Ctrl+D</kbd> Duplicate • <kbd className="rounded border bg-white px-1 font-mono text-[10px]">Space+Drag</kbd> Pan
          </span>
          <div className="flex items-center gap-1.5">
            {saveStatus === 'saved' && (
              <span className="badge badge-ok flex items-center gap-1 text-[11px]">
                <Check className="h-3 w-3 text-emerald-600" />
                {lastSaved ? `Saved ${lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Saved'}
              </span>
            )}
            {saveStatus === 'unsaved' && <span className="badge badge-warn text-[11px]">Unsaved</span>}
            {saveStatus === 'saving' && <span className="badge badge-info text-[11px]">Saving…</span>}
          </div>
        </div>
      </div>

      {/* Right Sidebar: Switchable between [Properties] and [Layers] */}
      <aside className="space-y-4">
        {/* Sidebar Nav Tabs */}
        <div className="flex rounded-xl border border-line bg-slate-100 p-1">
          <button
            onClick={() => setSidebarTab('properties')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-bold transition ${
              sidebarTab === 'properties' ? 'bg-white shadow-xs text-ink' : 'text-slate-500 hover:text-ink'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Properties
          </button>
          <button
            onClick={() => setSidebarTab('layers')}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-1.5 text-xs font-bold transition ${
              sidebarTab === 'layers' ? 'bg-white shadow-xs text-ink' : 'text-slate-500 hover:text-ink'
            }`}
          >
            <LayersIcon className="h-3.5 w-3.5" />
            Layers ({allLayerRefs.length})
          </button>
        </div>

        {/* Add Elements Panel */}
        <div className="card p-3">
          <label className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Add Elements
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button className="btn btn-ghost btn-sm" onClick={addText}>
              <Type className="h-3.5 w-3.5 text-sky-600" />
              Text
            </button>

            {/* Badges / Foil Seals Dropdown */}
            <div className="relative">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setBadgeMenuOpen(!badgeMenuOpen)}
                title="Add vector badge, foil seal, or ornament"
              >
                <Award className="h-3.5 w-3.5 text-amber-600" />
                Badge / Seal
                <ChevronDown className="h-3 w-3 text-slate-400" />
              </button>

              {badgeMenuOpen && (
                <div className="absolute left-0 top-full z-40 mt-1 w-60 rounded-xl border border-line bg-white p-1.5 shadow-xl">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Vector Seals & Accents
                  </div>
                  {BADGE_VARIANTS.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => addBadge(b.id)}
                      className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-mist"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold">{b.name}</p>
                        <p className="text-[10px] text-slate-400 line-clamp-1">{b.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Logo Buttons: Global Store or Local Upload */}
            <div className="inline-flex rounded-lg border border-line bg-white shadow-xs">
              <button
                className="btn btn-ghost btn-sm rounded-r-none border-r border-line text-xs"
                onClick={() => {
                  setPickerTarget('logo');
                  setGlobalPickerCat('logo');
                  setGlobalPickerOpen(true);
                }}
                title="Pick logo from Global Store"
              >
                <Library className="h-3.5 w-3.5 text-amber-600" />
                Logo
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
              <PenLine className="h-3.5 w-3.5 text-emerald-600" />
              Signature
            </button>

            {!cfg.qr?.enabled && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  recordHistory();
                  edit((c) => ({
                    ...c,
                    qr: { ...c.qr, enabled: true },
                    layers: c.layers ? [...c.layers, 'qr'] : undefined,
                  }));
                  setSelected('qr');
                }}
              >
                <QrCode className="h-3.5 w-3.5 text-purple-600" />
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
        </div>

        {/* TAB 1: PROPERTIES INSPECTOR */}
        {sidebarTab === 'properties' && (
          <div className="card space-y-4 p-4">
            {!item && (
              <div className="py-6 text-center text-slate2">
                <Sliders className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                <p className="text-sm font-semibold">No Element Selected</p>
                <p className="mt-1 text-xs text-slate-400">Click any element on canvas or select from the Layers tab to inspect.</p>
              </div>
            )}

            {/* Quick Actions Header for Selected Element */}
            {item && (
              <div className="flex items-center justify-between border-b border-line pb-2.5">
                <span className="truncate text-xs font-bold text-slate-700">
                  {getElementLabel(selected)}
                </span>
                <div className="flex items-center gap-1">
                  {/* Lock Toggle */}
                  <button
                    className={`rounded-md p-1.5 transition ${item.locked ? 'bg-amber-50 text-amber-700' : 'text-slate-400 hover:bg-slate-100'}`}
                    onClick={() => patch(selected, { locked: !item.locked }, true)}
                    title={item.locked ? 'Unlock element' : 'Lock element (prevent moving)'}
                  >
                    {item.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
                  </button>

                  {/* Hide Toggle */}
                  <button
                    className={`rounded-md p-1.5 transition ${item.hidden ? 'bg-rose-50 text-rose-700' : 'text-slate-400 hover:bg-slate-100'}`}
                    onClick={() => patch(selected, { hidden: !item.hidden }, true)}
                    title={item.hidden ? 'Show element' : 'Hide element'}
                  >
                    {item.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>

                  {/* Duplicate */}
                  {selType !== 'qr' && (
                    <button
                      className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      onClick={() => duplicateItem(selected)}
                      title="Duplicate (Ctrl+D)"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {/* Delete */}
                  <button
                    className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    onClick={() => {
                      recordHistory();
                      edit((c) => removeItem(c, selected));
                      setSelected(null);
                      toast.ok('Item deleted');
                    }}
                    title="Delete element"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* 1. TEXT FIELD PROPERTIES */}
            {item && selType === 'field' && (
              <>
                <Field label="Text Content">
                  <textarea
                    rows={3}
                    className="input min-h-[72px]"
                    value={item.text}
                    placeholder="Enter certificate text..."
                    onChange={(e) => patch(selected, { text: e.target.value })}
                  />
                </Field>

                <div>
                  <span className="label text-[11px]">Insert Token</span>
                  <div className="flex flex-wrap gap-1">
                    {[...BASE_TOKENS, ...extraTokens].map((t) => (
                      <button key={t} type="button" className="chip text-[10px]" onClick={() => addToken(t)}>
                        {`{{${t}}}`}
                      </button>
                    ))}
                  </div>
                </div>

                <Field label="Typography Font">
                  <select
                    className="input text-xs"
                    value={item.family}
                    onChange={(e) => patch(selected, { family: e.target.value }, true)}
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
                  <Num label="Size (px)" value={item.size} min={8} max={260} onChange={(v) => patch(selected, { size: v })} />
                  <Field label="Weight">
                    <select
                      className="input !py-1 text-xs"
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
                      className="h-[34px] w-full cursor-pointer rounded-lg border border-line"
                      value={item.color}
                      onChange={(e) => patch(selected, { color: e.target.value })}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Align">
                    <select
                      className="input !py-1 text-xs"
                      value={item.align}
                      onChange={(e) => patch(selected, { align: e.target.value })}
                    >
                      <option value="center">Center</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                    </select>
                  </Field>
                  <Field label="Text Wrapping">
                    <select
                      className="input !py-1 text-xs"
                      value={item.mode}
                      onChange={(e) => patch(selected, { mode: e.target.value })}
                    >
                      <option value="fit">Shrink to fit width</option>
                      <option value="wrap">Wrap onto multiple lines</option>
                    </select>
                  </Field>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <Num label="Max width" value={item.maxWidth} onChange={(v) => patch(selected, { maxWidth: v })} />
                  <Num label="Line height" value={item.lineHeight} onChange={(v) => patch(selected, { lineHeight: v })} />
                  <Num label="Letter gap" value={item.spacing} onChange={(v) => patch(selected, { spacing: v })} />
                </div>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={!!item.italic}
                    onChange={(e) => patch(selected, { italic: e.target.checked })}
                  />
                  Italic font styling
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <Num label="X coordinate" value={item.x} onChange={(v) => patch(selected, { x: v })} />
                  <Num label="Y coordinate" value={item.y} onChange={(v) => patch(selected, { y: v })} />
                </div>
              </>
            )}

            {/* 2. BADGE & FOIL SEAL PROPERTIES */}
            {item && selType === 'badge' && (
              <>
                <Field label="Badge / Seal Style">
                  <select
                    className="input text-xs"
                    value={item.variant}
                    onChange={(e) => patch(selected, { variant: e.target.value }, true)}
                  >
                    {BADGE_VARIANTS.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Primary Color">
                    <input
                      type="color"
                      className="h-[34px] w-full cursor-pointer rounded-lg border border-line"
                      value={item.color || '#c8a24a'}
                      onChange={(e) => patch(selected, { color: e.target.value })}
                    />
                  </Field>
                  <Field label="Accent Color">
                    <input
                      type="color"
                      className="h-[34px] w-full cursor-pointer rounded-lg border border-line"
                      value={item.secondaryColor || '#996515'}
                      onChange={(e) => patch(selected, { secondaryColor: e.target.value })}
                    />
                  </Field>
                </div>

                {item.variant !== 'divider-flourish' && item.variant !== 'corner-flourish' && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Center / Banner Text">
                      <input
                        className="input !py-1 text-xs"
                        value={item.text || ''}
                        placeholder="e.g. WINNER"
                        onChange={(e) => patch(selected, { text: e.target.value })}
                      />
                    </Field>
                    <Field label="Subtext / Tag">
                      <input
                        className="input !py-1 text-xs"
                        value={item.subtext || ''}
                        placeholder="e.g. 1ST PLACE"
                        onChange={(e) => patch(selected, { subtext: e.target.value })}
                      />
                    </Field>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Num label="Dimension (size)" value={item.size} min={40} max={1600} onChange={(v) => patch(selected, { size: v })} />
                  <label className="block">
                    <span className="label text-[11px]">Opacity ({Math.round((item.opacity ?? 1) * 100)}%)</span>
                    <input
                      type="range"
                      min="0.05"
                      max="1"
                      step="0.05"
                      className="w-full mt-2"
                      value={item.opacity ?? 1}
                      onChange={(e) => patch(selected, { opacity: Number(e.target.value) })}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Num label="Center X" value={item.x} onChange={(v) => patch(selected, { x: v })} />
                  <Num label="Center Y" value={item.y} onChange={(v) => patch(selected, { y: v })} />
                </div>
              </>
            )}

            {/* 3. QR CODE PROPERTIES */}
            {item && selType === 'qr' && (
              <>
                <p className="text-xs text-slate-500">The verification QR code directs scanners to this certificate’s verification page.</p>
                <div className="grid grid-cols-3 gap-2">
                  <Num label="Size" value={item.size} min={50} max={600} onChange={(v) => patch('qr', { size: v })} />
                  <Num label="Center X" value={item.x} onChange={(v) => patch('qr', { x: v })} />
                  <Num label="Center Y" value={item.y} onChange={(v) => patch('qr', { y: v })} />
                </div>
              </>
            )}

            {/* 4. IMAGE PROPERTIES */}
            {item && selType === 'image' && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <Num label="Width (px)" value={item.width} min={20} onChange={(v) => patch(selected, { width: v })} />
                  <Num label="Center X" value={item.x} onChange={(v) => patch(selected, { x: v })} />
                  <Num label="Center Y" value={item.y} onChange={(v) => patch(selected, { y: v })} />
                </div>
              </>
            )}

            {/* 5. SIGNATORY PROPERTIES */}
            {item && selType === 'sig' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Signer Full Name">
                    <input
                      className="input !py-1 text-xs"
                      value={item.name}
                      onChange={(e) => patch(selected, { name: e.target.value })}
                    />
                  </Field>
                  <Field label="Designation / Title">
                    <input
                      className="input !py-1 text-xs"
                      value={item.title}
                      onChange={(e) => patch(selected, { title: e.target.value })}
                    />
                  </Field>
                </div>

                <div>
                  <label className="label text-[11px]">Signature Artwork</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      className="btn btn-ghost btn-sm text-xs"
                      onClick={() => {
                        setPickerTarget(selected);
                        setGlobalPickerCat('signature');
                        setGlobalPickerOpen(true);
                      }}
                      title="Choose authorized signature from Global Store"
                    >
                      <Library className="h-3.5 w-3.5 text-amber-600" />
                      Global Store
                    </button>
                    <button
                      className="btn btn-ghost btn-sm text-xs"
                      onClick={() => sigInput.current.click()}
                      disabled={uploading === 'sig'}
                    >
                      {uploading === 'sig' ? <Spinner /> : <ImagePlus className="h-3.5 w-3.5" />}
                      Upload File
                    </button>
                    {item.path && (
                      <button className="btn btn-ghost btn-sm text-xs text-rose-600" onClick={() => patch(selected, { path: null }, true)}>
                        Clear
                      </button>
                    )}
                  </div>
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

                <div className="grid grid-cols-3 gap-2">
                  <Num label="Name size" value={item.nameSize} onChange={(v) => patch(selected, { nameSize: v })} />
                  <Num label="Title size" value={item.titleSize} onChange={(v) => patch(selected, { titleSize: v })} />
                  <Field label="Ink Color">
                    <input
                      type="color"
                      className="h-[34px] w-full cursor-pointer rounded-lg border border-line"
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
                  <Num label="Y (baseline)" value={item.y} onChange={(v) => patch(selected, { y: v })} />
                </div>
              </>
            )}

            {/* DYNAMIC CONDITIONAL LOGIC BUILDER */}
            {item && (selType === 'field' || selType === 'badge') && (
              <div className="mt-3 rounded-xl border border-line bg-slate-50/70 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">Dynamic Conditional Display</span>
                  <input
                    type="checkbox"
                    checked={!!item.condition}
                    onChange={(e) =>
                      patch(
                        selected,
                        { condition: e.target.checked ? { field: 'rank', op: '==', value: '1' } : null },
                        true
                      )
                    }
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Only show this {selType} for participants meeting specific criteria (e.g. Winner, Honors, Speaker).
                </p>

                {item.condition && (
                  <div className="mt-3 space-y-2 border-t border-line/60 pt-2 text-xs">
                    <div className="grid grid-cols-3 gap-1.5">
                      <div className="col-span-1">
                        <span className="label text-[10px]">Column / Variable</span>
                        <input
                          className="input !py-1 text-xs"
                          placeholder="e.g. rank"
                          value={item.condition.field || ''}
                          onChange={(e) =>
                            patch(selected, { condition: { ...item.condition, field: e.target.value } })
                          }
                        />
                      </div>
                      <div className="col-span-1">
                        <span className="label text-[10px]">Condition</span>
                        <select
                          className="input !py-1 text-xs"
                          value={item.condition.op || '=='}
                          onChange={(e) =>
                            patch(selected, { condition: { ...item.condition, op: e.target.value } })
                          }
                        >
                          <option value="==">equals (==)</option>
                          <option value="!=">not equal (!=)</option>
                          <option value=">">&gt; greater than</option>
                          <option value=">=">&gt;= greater / equal</option>
                          <option value="<">&lt; less than</option>
                          <option value="<=">&lt;= less / equal</option>
                          <option value="contains">contains text</option>
                        </select>
                      </div>
                      <div className="col-span-1">
                        <span className="label text-[10px]">Expected Value</span>
                        <input
                          className="input !py-1 text-xs"
                          placeholder="e.g. 1 or Winner"
                          value={item.condition.value || ''}
                          onChange={(e) =>
                            patch(selected, { condition: { ...item.condition, value: e.target.value } })
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 2: UNIFIED LAYERS MANAGER */}
        {sidebarTab === 'layers' && (
          <div className="card space-y-3 p-4">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <span className="text-xs font-bold text-slate-700">Layer Stack (Top to Bottom)</span>
              <span className="text-[11px] text-slate-400">Order determines visual overlap</span>
            </div>

            <ul className="max-h-[64vh] divide-y divide-line overflow-y-auto pr-1">
              {[...allLayerRefs].reverse().map((ref) => {
                const it = getItem(cfg, ref);
                if (!it) return null;
                const [t] = parseRef(ref);
                const isSelected = selected === ref;

                return (
                  <li
                    key={ref}
                    className={`group flex items-center justify-between rounded-lg p-2 transition ${
                      isSelected ? 'bg-saffron-50 font-semibold ring-1 ring-saffron-300' : 'hover:bg-slate-50'
                    }`}
                  >
                    <button
                      onClick={() => {
                        setSelected(ref);
                        setSidebarTab('properties');
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      {t === 'field' && <Type className="h-3.5 w-3.5 shrink-0 text-sky-600" />}
                      {t === 'badge' && <Award className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
                      {t === 'sig' && <PenLine className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                      {t === 'image' && <ImageIcon className="h-3.5 w-3.5 shrink-0 text-purple-600" />}
                      {t === 'qr' && <QrCode className="h-3.5 w-3.5 shrink-0 text-slate-600" />}
                      <span className="truncate text-xs">{getElementLabel(ref)}</span>
                    </button>

                    {/* Layer Controls: Lock, Hide, Reorder */}
                    <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                      <button
                        onClick={() => patch(ref, { locked: !it.locked }, true)}
                        className={`rounded p-1 ${it.locked ? 'text-amber-700 bg-amber-50' : 'text-slate-400 hover:text-slate-600'}`}
                        title={it.locked ? 'Unlock' : 'Lock'}
                      >
                        {it.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={() => patch(ref, { hidden: !it.hidden }, true)}
                        className={`rounded p-1 ${it.hidden ? 'text-rose-600 bg-rose-50' : 'text-slate-400 hover:text-slate-600'}`}
                        title={it.hidden ? 'Show' : 'Hide'}
                      >
                        {it.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                      <button
                        onClick={() => moveLayer(ref, 'up')}
                        className="rounded p-1 text-slate-400 hover:text-slate-700"
                        title="Bring Forward"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => moveLayer(ref, 'down')}
                        className="rounded p-1 text-slate-400 hover:text-slate-700"
                        title="Send Backward"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </aside>

      {/* Preset Picker Modal */}
      <PresetPickerModal
        open={presetModalOpen}
        onClose={() => setPresetModalOpen(false)}
        onSelectPreset={applyPreset}
      />

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
