import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, ImagePlus, PenLine, Plus, QrCode, Save, Trash2, Type, Image as ImageIcon } from 'lucide-react';
import { supabase, verifyUrl } from '../../lib/supabase';
import { audit, uploadAsset } from '../../lib/api';
import { buildValues, BASE_TOKENS, downloadBlob, normKey, uid } from '../../lib/format';
import { defaultConfig, DEFAULT_SIZE, FONTS, SAMPLE_VALUES } from '../../lib/defaults';
import { drawCertificate, ensureFonts, loadTemplateAssets, makeQrImage, prepareBackground, renderPdfBlob, rescaleConfig } from '../../lib/render';
import { Field, Spinner, useToast } from '../../components/ui';

const parseRef = (ref) => { const i = ref.indexOf(':'); return i < 0 ? [ref, null] : [ref.slice(0, i), ref.slice(i + 1)]; };
const LIST = { field: 'fields', image: 'images', sig: 'signatories' };

function getItem(cfg, ref) {
  const [t, id] = parseRef(ref);
  if (t === 'qr') return cfg.qr;
  return (cfg[LIST[t]] || []).find((x) => x.id === id);
}
function patchItem(cfg, ref, patch) {
  const [t, id] = parseRef(ref);
  if (t === 'qr') return { ...cfg, qr: { ...cfg.qr, ...patch } };
  const key = LIST[t];
  return { ...cfg, [key]: cfg[key].map((x) => (x.id === id ? { ...x, ...patch } : x)) };
}
function removeItem(cfg, ref) {
  const [t, id] = parseRef(ref);
  if (t === 'qr') return { ...cfg, qr: { ...cfg.qr, enabled: false } };
  const key = LIST[t];
  return { ...cfg, [key]: cfg[key].filter((x) => x.id !== id) };
}
function normalize(cfg) {
  const base = cfg && Array.isArray(cfg.fields) ? cfg : defaultConfig();
  return { fields: base.fields || [], qr: base.qr || { enabled: true, x: 1580, y: 1040, size: 190 }, images: base.images || [], signatories: base.signatories || [] };
}

function Num({ label, value, onChange, step = 1, min }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="number" className="input" value={value ?? 0} step={step} min={min} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
    </label>
  );
}

export default function TemplateDesigner({ ctx }) {
  const { event, template, recipients, reload, ownerName } = ctx;
  const toast = useToast();
  const initialTpl = template || { image_path: null, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height, config: defaultConfig() };
  const [tpl, setTpl] = useState(() => ({
    image_path: initialTpl.image_path || null,
    width: initialTpl.width || DEFAULT_SIZE.width,
    height: initialTpl.height || DEFAULT_SIZE.height,
    config: normalize(initialTpl.config),
  }));
  const [selected, setSelected] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [assets, setAssets] = useState(null);
  const [qrImg, setQrImg] = useState(null);
  const [previewIdx, setPreviewIdx] = useState(-1);
  const [uploading, setUploading] = useState('');
  const canvasRef = useRef(null);
  const boxesRef = useRef([]);
  const dragRef = useRef(null);
  const rafRef = useRef(null);
  const drawId = useRef(0);
  const bgInput = useRef(null);
  const logoInput = useRef(null);
  const sigInput = useRef(null);

  const cfg = tpl.config;
  const edit = (fn) => { setTpl((t) => ({ ...t, config: fn(t.config) })); setDirty(true); };
  const patch = (ref, p) => edit((c) => patchItem(c, ref, p));

  // preview values
  const sample = previewIdx >= 0 ? recipients[previewIdx] : null;
  const values = useMemo(
    () => buildValues({ name: sample?.name || SAMPLE_VALUES.name, extra: sample?.extra }, event, { code: SAMPLE_VALUES.code, issuer: ownerName, verify_url: verifyUrl(SAMPLE_VALUES.code) }),
    [sample, event, ownerName]
  );
  const extraTokens = useMemo(() => {
    const s = new Set();
    recipients.slice(0, 200).forEach((r) => Object.keys(r.extra || {}).forEach((k) => s.add(normKey(k))));
    return [...s].filter((k) => !BASE_TOKENS.includes(k));
  }, [recipients]);

  // load assets when the image set / size changes
  const assetKey = [tpl.image_path, tpl.width, tpl.height, ...cfg.images.map((i) => i.path), ...cfg.signatories.map((s) => s.path)].join('|');
  useEffect(() => {
    let alive = true;
    loadTemplateAssets(tpl).then((a) => {
      if (!alive) return;
      setAssets(a);
      if (a?.failedPaths?.length) {
        toast.error(`Warning: ${a.failedPaths.length} image asset(s) failed to load.`);
      }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetKey]);
  useEffect(() => { makeQrImage(verifyUrl(SAMPLE_VALUES.code)).then(setQrImg); }, []);

  // draw
  useEffect(() => {
    if (!assets || !canvasRef.current) return;
    const my = ++drawId.current;
    (async () => {
      await ensureFonts(cfg, values);
      if (my !== drawId.current) return;
      const canvas = canvasRef.current;
      const boxes = drawCertificate(canvas, tpl, assets, values, qrImg);
      boxesRef.current = boxes;
      const ctx2 = canvas.getContext('2d');
      const lw = Math.max(2, tpl.width / 700);
      boxes.forEach((b) => {
        const sel = b.ref === selected;
        ctx2.save();
        ctx2.lineWidth = sel ? lw * 2 : lw;
        ctx2.strokeStyle = sel ? '#d9730d' : 'rgba(100,116,139,.55)';
        if (!sel) ctx2.setLineDash([lw * 5, lw * 4]);
        ctx2.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
        ctx2.restore();
      });
    })();
  }, [tpl, assets, qrImg, values, selected, cfg]);

  // drag
  const toCanvas = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const onDown = (e) => {
    const p = toCanvas(e);
    const hit = [...boxesRef.current].reverse().find((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
    if (!hit) { setSelected(null); return; }
    setSelected(hit.ref);
    const it = getItem(cfg, hit.ref);
    if (!it) return;
    dragRef.current = { ref: hit.ref, sx: p.x, sy: p.y, ox: it.x, oy: it.y };
    canvasRef.current.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toCanvas(e);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      patch(d.ref, { x: Math.round(d.ox + p.x - d.sx), y: Math.round(d.oy + p.y - d.sy) });
    });
  };
  const onUp = (e) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    dragRef.current = null;
    if (e?.pointerId && canvasRef.current?.releasePointerCapture) {
      try { canvasRef.current.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };

  const item = selected ? getItem(cfg, selected) : null;
  const [selType] = selected ? parseRef(selected) : [null];

  // actions
  const addText = () => {
    const id = uid();
    edit((c) => ({ ...c, fields: [...c.fields, { id, type: 'text', text: 'New text', x: tpl.width / 2, y: tpl.height / 2, size: 36, family: FONTS[6].value, weight: 500, italic: false, color: '#1f2937', align: 'center', mode: 'fit', maxWidth: Math.round(tpl.width * 0.7), lineHeight: 0, spacing: 0 }] }));
    setSelected(`field:${id}`);
  };
  const addSignatory = () => {
    const id = uid();
    edit((c) => ({ ...c, signatories: [...c.signatories, { id, name: 'Name', title: 'Designation', path: null, x: Math.round(tpl.width * 0.7), y: Math.round(tpl.height * 0.8), sigWidth: 240, lineWidth: 300, nameSize: 28, titleSize: 22, family: FONTS[6].value, color: '#1f2937' }] }));
    setSelected(`sig:${id}`);
  };
  const checkSize = (file, max = 5) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast.error('Use a PNG, JPG or WebP image.'); return false; }
    if (file.size > max * 1024 * 1024) { toast.error(`Image is larger than ${max} MB.`); return false; }
    return true;
  };
  const addLogo = async (file) => {
    if (!file || !checkSize(file)) return;
    setUploading('logo');
    try {
      const path = await uploadAsset(event.id, file, 'logo');
      const id = uid();
      edit((c) => ({ ...c, images: [...c.images, { id, label: file.name, path, x: Math.round(tpl.width / 2), y: 150, width: 220 }] }));
      setSelected(`image:${id}`);
    } catch (e) { toast.error(e.message); } finally { setUploading(''); }
  };
  const setSignature = async (file) => {
    if (!file || !checkSize(file) || !selected) return;
    setUploading('sig');
    try { patch(selected, { path: await uploadAsset(event.id, file, 'signature') }); } catch (e) { toast.error(e.message); } finally { setUploading(''); }
  };
  const uploadBackground = async (file) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error('Use a PNG, JPG or WebP image.');
    if (file.size > 20 * 1024 * 1024) return toast.error('Template image is larger than 20 MB.');
    setUploading('bg');
    try {
      const { blob, width, height, ext } = await prepareBackground(file);
      const path = await uploadAsset(event.id, new File([blob], `bg.${ext}`, { type: blob.type || file.type }), 'bg');
      setTpl((t) => ({ ...t, image_path: path, width, height, config: rescaleConfig(t.config, t.width, width, t.height, height) }));
      setDirty(true);
      toast.ok(`Template image set (${width}×${height}). Check the text positions.`);
    } catch (e) { toast.error(e.message); } finally { setUploading(''); }
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

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('event_templates').upsert({
      event_id: event.id,
      image_path: tpl.image_path,
      width: tpl.width,
      height: tpl.height,
      config: tpl.config,
      updated_at: new Date().toISOString()
    }, { onConflict: 'event_id' });
    setSaving(false);
    if (error) return toast.error(error.message);
    audit('template.saved', 'event', event.id, { name: event.name });
    setDirty(false);
    toast.ok('Template saved');
  };
  const downloadPreview = async () => {
    try {
      const blob = await renderPdfBlob(tpl, assets, values, verifyUrl(SAMPLE_VALUES.code));
      downloadBlob(blob, 'certificate-preview.pdf');
    } catch (e) { toast.error(e.message); }
  };
  const addToken = (tok) => patch(selected, { text: `${item.text || ''}{{${tok}}}` });

  const fieldLabel = (f) => (f.text || '(empty)').replace(/\s+/g, ' ').slice(0, 30);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => bgInput.current.click()} disabled={uploading === 'bg'}>{uploading === 'bg' ? <Spinner /> : <ImagePlus className="h-4 w-4" />}Upload template image</button>
          {tpl.image_path && <button className="btn btn-ghost btn-sm" onClick={useDefaultBg}>Use plain background</button>}
          <select className="input !w-auto !py-1.5 text-xs" value={previewIdx} onChange={(e) => setPreviewIdx(Number(e.target.value))} aria-label="Preview with participant">
            <option value={-1}>Preview: sample name</option>
            {recipients.slice(0, 200).map((r, i) => <option key={r.id} value={i}>Preview: {r.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={downloadPreview} disabled={!assets}><Download className="h-4 w-4" />Preview PDF</button>
          <div className="ml-auto flex items-center gap-2">
            {dirty && <span className="badge badge-warn">Unsaved changes</span>}
            <button className="btn btn-accent btn-sm" onClick={save} disabled={saving || !dirty}>{saving ? <Spinner /> : <Save className="h-4 w-4" />}Save template</button>
          </div>
        </div>
        <input ref={bgInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { uploadBackground(e.target.files[0]); e.target.value = ''; }} />
        <div className="card overflow-auto bg-slate-200 p-3">
          {!assets ? <div className="flex h-64 items-center justify-center text-slate2"><Spinner className="mr-2" />Loading template…</div> : (
            <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              style={{ maxWidth: '100%', maxHeight: '72vh', width: 'auto', height: 'auto', display: 'block', margin: '0 auto', touchAction: 'none', cursor: 'move' }}
              className="bg-white shadow" aria-label="Certificate preview. Drag items to move them." />
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">{tpl.width}×{tpl.height}px. Drag any dashed box to move it. Changes to the template apply to certificates generated after you save; already generated certificates are not changed. Use {'{{name}}'} where the participant’s name should appear.</p>
      </div>

      <aside className="space-y-4">
        <div className="card p-3">
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button className="btn btn-ghost btn-sm" onClick={addText}><Type className="h-3.5 w-3.5" />Text</button>
            <button className="btn btn-ghost btn-sm" onClick={() => logoInput.current.click()} disabled={uploading === 'logo'}>{uploading === 'logo' ? <Spinner /> : <ImageIcon className="h-3.5 w-3.5" />}Logo / image</button>
            <button className="btn btn-ghost btn-sm" onClick={addSignatory}><PenLine className="h-3.5 w-3.5" />Signatory</button>
            {!cfg.qr.enabled && <button className="btn btn-ghost btn-sm" onClick={() => { edit((c) => ({ ...c, qr: { ...c.qr, enabled: true } })); setSelected('qr'); }}><QrCode className="h-3.5 w-3.5" />QR code</button>}
          </div>
          <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { addLogo(e.target.files[0]); e.target.value = ''; }} />
          <ul className="max-h-48 divide-y divide-line overflow-y-auto text-sm">
            {cfg.fields.map((f) => <li key={f.id}><button className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-mist ${selected === `field:${f.id}` ? 'bg-saffron-50 font-semibold' : ''}`} onClick={() => setSelected(`field:${f.id}`)}><Type className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{fieldLabel(f)}</span></button></li>)}
            {cfg.images.map((i) => <li key={i.id}><button className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-mist ${selected === `image:${i.id}` ? 'bg-saffron-50 font-semibold' : ''}`} onClick={() => setSelected(`image:${i.id}`)}><ImageIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{i.label || 'Image'}</span></button></li>)}
            {cfg.signatories.map((s) => <li key={s.id}><button className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-mist ${selected === `sig:${s.id}` ? 'bg-saffron-50 font-semibold' : ''}`} onClick={() => setSelected(`sig:${s.id}`)}><PenLine className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">Signatory: {s.name}</span></button></li>)}
            {cfg.qr.enabled && <li><button className={`flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-mist ${selected === 'qr' ? 'bg-saffron-50 font-semibold' : ''}`} onClick={() => setSelected('qr')}><QrCode className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span>Verification QR code</span></button></li>}
          </ul>
        </div>

        <div className="card space-y-3 p-4">
          {!item && <p className="text-sm text-slate2">Select an item on the certificate or from the list to edit it.</p>}

          {item && selType === 'field' && (
            <>
              <Field label="Text"><textarea className="input min-h-[72px]" value={item.text} onChange={(e) => patch(selected, { text: e.target.value })} /></Field>
              <div className="flex flex-wrap gap-1">{[...BASE_TOKENS, ...extraTokens].map((t) => <button key={t} type="button" className="chip" onClick={() => addToken(t)}>{`{{${t}}}`}</button>)}</div>
              <Field label="Font"><select className="input" value={item.family} onChange={(e) => patch(selected, { family: e.target.value })}>{FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></Field>
              <div className="grid grid-cols-3 gap-2">
                <Num label="Size" value={item.size} min={8} onChange={(v) => patch(selected, { size: v })} />
                <Field label="Weight"><select className="input" value={item.weight} onChange={(e) => patch(selected, { weight: Number(e.target.value) })}>{[400, 500, 600, 700, 800].map((w) => <option key={w}>{w}</option>)}</select></Field>
                <Field label="Color"><input type="color" className="h-[38px] w-full cursor-pointer rounded-lg border border-line" value={item.color} onChange={(e) => patch(selected, { color: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Align"><select className="input" value={item.align} onChange={(e) => patch(selected, { align: e.target.value })}><option value="center">Center</option><option value="left">Left</option><option value="right">Right</option></select></Field>
                <Field label="Long text"><select className="input" value={item.mode} onChange={(e) => patch(selected, { mode: e.target.value })}><option value="fit">Shrink to fit one line</option><option value="wrap">Wrap onto lines</option></select></Field>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Num label="Max width" value={item.maxWidth} onChange={(v) => patch(selected, { maxWidth: v })} />
                <Num label="Line height" value={item.lineHeight} onChange={(v) => patch(selected, { lineHeight: v })} />
                <Num label="Letter gap" value={item.spacing} onChange={(v) => patch(selected, { spacing: v })} />
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!item.italic} onChange={(e) => patch(selected, { italic: e.target.checked })} />Italic</label>
              <div className="grid grid-cols-2 gap-2"><Num label="X" value={item.x} onChange={(v) => patch(selected, { x: v })} /><Num label="Y" value={item.y} onChange={(v) => patch(selected, { y: v })} /></div>
            </>
          )}

          {item && selType === 'qr' && (
            <>
              <p className="text-sm text-slate2">The QR code opens this certificate’s verify page.</p>
              <div className="grid grid-cols-3 gap-2"><Num label="Size" value={item.size} min={60} onChange={(v) => patch('qr', { size: v })} /><Num label="X" value={item.x} onChange={(v) => patch('qr', { x: v })} /><Num label="Y" value={item.y} onChange={(v) => patch('qr', { y: v })} /></div>
            </>
          )}

          {item && selType === 'image' && (
            <div className="grid grid-cols-3 gap-2"><Num label="Width" value={item.width} min={20} onChange={(v) => patch(selected, { width: v })} /><Num label="X" value={item.x} onChange={(v) => patch(selected, { x: v })} /><Num label="Y" value={item.y} onChange={(v) => patch(selected, { y: v })} /></div>
          )}

          {item && selType === 'sig' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Name"><input className="input" value={item.name} onChange={(e) => patch(selected, { name: e.target.value })} /></Field>
                <Field label="Designation"><input className="input" value={item.title} onChange={(e) => patch(selected, { title: e.target.value })} /></Field>
              </div>
              <div className="flex items-center gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => sigInput.current.click()} disabled={uploading === 'sig'}>{uploading === 'sig' ? <Spinner /> : <ImagePlus className="h-3.5 w-3.5" />}{item.path ? 'Replace signature' : 'Upload signature'}</button>
                {item.path && <button className="btn btn-ghost btn-sm" onClick={() => patch(selected, { path: null })}>Remove</button>}
                <input ref={sigInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { setSignature(e.target.files[0]); e.target.value = ''; }} />
              </div>
              <p className="text-xs text-slate-500">A PNG with a transparent background looks best.</p>
              <Field label="Font"><select className="input" value={item.family} onChange={(e) => patch(selected, { family: e.target.value })}>{FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></Field>
              <div className="grid grid-cols-3 gap-2"><Num label="Name size" value={item.nameSize} onChange={(v) => patch(selected, { nameSize: v })} /><Num label="Title size" value={item.titleSize} onChange={(v) => patch(selected, { titleSize: v })} /><Field label="Color"><input type="color" className="h-[38px] w-full cursor-pointer rounded-lg border border-line" value={item.color} onChange={(e) => patch(selected, { color: e.target.value })} /></Field></div>
              <div className="grid grid-cols-2 gap-2"><Num label="Signature width" value={item.sigWidth} onChange={(v) => patch(selected, { sigWidth: v })} /><Num label="Line width" value={item.lineWidth} onChange={(v) => patch(selected, { lineWidth: v })} /></div>
              <div className="grid grid-cols-2 gap-2"><Num label="X" value={item.x} onChange={(v) => patch(selected, { x: v })} /><Num label="Y (line)" value={item.y} onChange={(v) => patch(selected, { y: v })} /></div>
            </>
          )}

          {item && <button className="btn btn-danger btn-sm" onClick={() => { edit((c) => removeItem(c, selected)); setSelected(null); }}><Trash2 className="h-3.5 w-3.5" />{selType === 'qr' ? 'Remove QR code' : 'Delete item'}</button>}
        </div>
      </aside>
    </div>
  );
}
