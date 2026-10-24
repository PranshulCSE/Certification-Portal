import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { assetUrl } from './api';
import { fillTemplate } from './format';

// ---------- image loading ----------
const imageCache = new Map();
export function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
  imageCache.set(src, p);
  p.catch(() => imageCache.delete(src));
  return p;
}

const bgCache = new Map();
export function defaultBackground(w, h) {
  const key = `${w}x${h}`;
  if (bgCache.has(key)) return bgCache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const m = Math.round(Math.min(w, h) * 0.03);
  ctx.strokeStyle = '#c8a24a';
  ctx.lineWidth = Math.max(6, Math.round(m / 4));
  ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
  ctx.lineWidth = 2;
  ctx.strokeRect(m * 1.6, m * 1.6, w - 3.2 * m, h - 3.2 * m);
  bgCache.set(key, c);
  return c;
}

export async function makeQrImage(url) {
  const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 600, color: { dark: '#000000', light: '#ffffff' } });
  return loadImage(dataUrl);
}

// Loads background + logo/signature images used by a template.
export async function loadTemplateAssets(tpl) {
  const cfg = tpl.config || {};
  const paths = new Set();
  (cfg.images || []).forEach((i) => i.path && paths.add(i.path));
  (cfg.signatories || []).forEach((s) => s.path && paths.add(s.path));
  const images = {};
  const failedPaths = [];
  await Promise.all(
    [...paths].map(async (p) => {
      try {
        images[p] = await loadImage(assetUrl(p));
      } catch {
        failedPaths.push(p);
      }
    })
  );
  let bg;
  if (tpl.image_path) {
    try {
      bg = await loadImage(assetUrl(tpl.image_path));
    } catch {
      bg = defaultBackground(tpl.width, tpl.height);
    }
  } else {
    bg = defaultBackground(tpl.width, tpl.height);
  }
  return { bg, images, failedPaths };
}

// ---------- fonts ----------
export const fontString = (f, size) => `${f.italic ? 'italic ' : ''}${f.weight || 400} ${size}px ${f.family}`;

const loadedFontsCache = new Set();

export async function ensureFonts(config, values) {
  if (!document.fonts?.load) return;
  const jobs = [];
  (config.fields || []).forEach((f) => {
    const key = `${fontString(f, f.size || 28)}|${f.text}`;
    if (!loadedFontsCache.has(key)) {
      loadedFontsCache.add(key);
      jobs.push(document.fonts.load(fontString(f, f.size || 28), fillTemplate(f.text, values) || 'Aa'));
    }
  });
  (config.signatories || []).forEach((s) => {
    const k1 = `${fontString({ family: s.family, weight: 700 }, s.nameSize || 26)}|${s.name}`;
    if (!loadedFontsCache.has(k1)) {
      loadedFontsCache.add(k1);
      jobs.push(document.fonts.load(fontString({ family: s.family, weight: 700 }, s.nameSize || 26), s.name || 'Aa'));
    }
    const k2 = `${fontString({ family: s.family, weight: 400 }, s.titleSize || 20)}|${s.title}`;
    if (!loadedFontsCache.has(k2)) {
      loadedFontsCache.add(k2);
      jobs.push(document.fonts.load(fontString({ family: s.family, weight: 400 }, s.titleSize || 20), s.title || 'Aa'));
    }
  });
  if (jobs.length > 0) {
    await Promise.allSettled(jobs);
  }
}

// ---------- drawing ----------
function splitWord(ctx, word, maxW) {
  const chunks = [];
  let cur = '';
  for (const ch of word) {
    const test = cur + ch;
    if (cur && ctx.measureText(test).width > maxW) {
      chunks.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  String(text).split('\n').forEach((para) => {
    const rawWords = para.split(/\s+/).filter(Boolean);
    if (!rawWords.length) {
      out.push('');
      return;
    }
    const words = [];
    for (const w of rawWords) {
      if (ctx.measureText(w).width > maxW) {
        words.push(...splitWord(ctx, w, maxW));
      } else {
        words.push(w);
      }
    }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = `${line} ${words[i]}`;
      if (ctx.measureText(test).width > maxW) {
        out.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    out.push(line);
  });
  return out;
}

function drawText(ctx, f, values) {
  const text = fillTemplate(f.text, values);
  const hasSpacing = 'letterSpacing' in ctx;
  ctx.textBaseline = 'middle';
  ctx.textAlign = f.align || 'center';
  ctx.fillStyle = f.color || '#111827';
  if (hasSpacing) ctx.letterSpacing = `${f.spacing || 0}px`;

  let size = f.size || 28;
  ctx.font = fontString(f, size);
  const maxW = Number(f.maxWidth) || 0;
  let lines;
  if (f.mode === 'wrap' && maxW) {
    lines = wrapLines(ctx, text, maxW);
  } else {
    lines = text.split('\n');
    if (maxW) {
      const minSize = f.minSize || Math.max(12, (f.size || 28) * 0.5);
      const widest = () => Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
      while (size > minSize && widest() > maxW) {
        size -= 1;
        ctx.font = fontString(f, size);
      }
    }
  }
  const lh = Number(f.lineHeight) || size * 1.3;
  // Center multiple lines vertically on f.y
  const totalH = (lines.length - 1) * lh;
  const startY = f.y - totalH / 2;
  lines.forEach((l, i) => ctx.fillText(l, f.x, startY + i * lh));
  const w = Math.max(60, ...lines.map((l) => ctx.measureText(l).width));
  const h = Math.max(lh, lines.length * lh);
  const x0 = f.align === 'left' ? f.x : f.align === 'right' ? f.x - w : f.x - w / 2;
  if (hasSpacing) ctx.letterSpacing = '0px';
  return { ref: `field:${f.id}`, x: x0, y: startY - lh / 2, w, h };
}

export function drawCertificate(canvas, tpl, assets, values, qrImage) {
  const { width: W, height: H } = tpl;
  const cfg = tpl.config || {};
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (assets.bg) ctx.drawImage(assets.bg, 0, 0, W, H);
  const boxes = [];

  (cfg.images || []).forEach((im) => {
    const img = assets.images[im.path];
    const w = im.width || 200;
    if (!img) {
      boxes.push({ ref: `image:${im.id}`, x: im.x - w / 2, y: im.y - w / 4, w, h: w / 2 });
      return;
    }
    const h = (w * img.height) / img.width;
    ctx.drawImage(img, im.x - w / 2, im.y - h / 2, w, h);
    boxes.push({ ref: `image:${im.id}`, x: im.x - w / 2, y: im.y - h / 2, w, h });
  });

  (cfg.fields || []).forEach((f) => boxes.push(drawText(ctx, f, values)));

  (cfg.signatories || []).forEach((s) => {
    const color = s.color || '#1f2937';
    const lw = s.lineWidth || 260;
    const img = s.path ? assets.images[s.path] : null;
    let top = s.y - 50;
    if (img) {
      const w = s.sigWidth || 220;
      const h = (w * img.height) / img.width;
      ctx.drawImage(img, s.x - w / 2, s.y - h - 4, w, h);
      top = s.y - h - 4;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x - lw / 2, s.y);
    ctx.lineTo(s.x + lw / 2, s.y);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const ns = s.nameSize || 26;
    const ts = s.titleSize || 20;
    ctx.font = fontString({ family: s.family, weight: 700 }, ns);
    ctx.fillText(s.name || '', s.x, s.y + 10, lw + 80);
    ctx.font = fontString({ family: s.family, weight: 400 }, ts);
    ctx.fillText(s.title || '', s.x, s.y + 10 + ns * 1.25, lw + 80);
    boxes.push({ ref: `sig:${s.id}`, x: s.x - lw / 2, y: top, w: lw, h: s.y + 10 + ns * 1.25 + ts - top });
  });

  const qr = cfg.qr;
  if (qr?.enabled) {
    const size = qr.size || 180;
    if (qrImage) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(qr.x - size / 2 - 8, qr.y - size / 2 - 8, size + 16, size + 16);
      ctx.drawImage(qrImage, qr.x - size / 2, qr.y - size / 2, size, size);
    }
    boxes.push({ ref: 'qr', x: qr.x - size / 2, y: qr.y - size / 2, w: size, h: size });
  }
  return boxes;
}

// ---------- PDF ----------
export function canvasToPdfBlob(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const landscape = w >= h;
  const pageW = landscape ? 297 : 210; // A4 width in mm
  const pageH = (pageW * h) / w;
  const pdf = new jsPDF({ orientation: landscape ? 'l' : 'p', unit: 'mm', format: [pageW, pageH], compress: true });
  pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
  return pdf.output('blob');
}

export async function renderPdfBlob(tpl, assets, values, verifyUrl) {
  await ensureFonts(tpl.config || {}, values);
  const qr = tpl.config?.qr?.enabled ? await makeQrImage(verifyUrl) : null;
  const canvas = document.createElement('canvas');
  drawCertificate(canvas, tpl, assets, values, qr);
  return canvasToPdfBlob(canvas);
}

// Downscale oversized template backgrounds so rendering stays fast.
export async function prepareBackground(file, maxEdge = 2600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Could not read this image'));
      i.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);
    if (scale === 1 && /^image\/(png|jpeg|webp)$/.test(file.type)) return { blob: file, width, height, ext: file.type.split('/')[1].replace('jpeg', 'jpg') };
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.93));
    return { blob, width, height, ext: 'jpg' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Scales every position/size when the template canvas size changes.
// Uses horizontal and vertical ratios independently to avoid aspect ratio distortion.
export function rescaleConfig(cfg, oldW, newW, oldH, newH) {
  if (!oldW || oldW === newW) return cfg;
  const kx = newW / oldW;
  const ky = (oldH && newH) ? newH / oldH : kx;
  const rx = (n) => Math.round(n * kx);
  const ry = (n) => Math.round(n * ky);
  return {
    ...cfg,
    fields: (cfg.fields || []).map((f) => ({
      ...f,
      x: rx(f.x),
      y: ry(f.y),
      size: rx(f.size),
      maxWidth: rx(f.maxWidth || 0),
      lineHeight: f.lineHeight ? ry(f.lineHeight) : 0,
      spacing: rx(f.spacing || 0),
    })),
    qr: cfg.qr ? { ...cfg.qr, x: rx(cfg.qr.x), y: ry(cfg.qr.y), size: rx(cfg.qr.size) } : cfg.qr,
    images: (cfg.images || []).map((i) => ({ ...i, x: rx(i.x), y: ry(i.y), width: rx(i.width) })),
    signatories: (cfg.signatories || []).map((s) => ({
      ...s,
      x: rx(s.x),
      y: ry(s.y),
      sigWidth: rx(s.sigWidth),
      lineWidth: rx(s.lineWidth),
      nameSize: rx(s.nameSize),
      titleSize: rx(s.titleSize),
    })),
  };
}
