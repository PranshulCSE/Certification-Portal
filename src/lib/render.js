import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { supabase } from './supabase';
import { assetUrl } from './api';
import { fillTemplate } from './format';

// ---------- image loading ----------
export const imageCache = new Map();

export function cacheAssetImage(path, img) {
  if (!path || !img) return;
  const p = Promise.resolve(img);
  const cleanPath = String(path).replace(/^\/+/, '');
  imageCache.set(cleanPath, p);
  imageCache.set(path, p);
  const url = assetUrl(cleanPath);
  if (url) imageCache.set(url, p);
}

export function loadImage(src) {
  if (!src) return Promise.reject(new Error('Image source is empty'));
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    const isLocal = src.startsWith('blob:') || src.startsWith('data:');
    if (!isLocal) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (!isLocal && img.crossOrigin) {
        const retry = new Image();
        retry.onload = () => resolve(retry);
        retry.onerror = () => reject(new Error(`Image failed to load: ${src.slice(0, 80)}`));
        retry.src = src;
        return;
      }
      reject(new Error(`Image failed to load: ${src.slice(0, 80)}`));
    };
    img.src = src;
  });
  imageCache.set(src, p);
  p.catch(() => imageCache.delete(src));
  return p;
}

export async function loadAssetImage(path) {
  if (!path) return null;
  if (path.startsWith('data:') || path.startsWith('blob:') || path.startsWith('http')) {
    return loadImage(path);
  }
  const cleanPath = String(path).replace(/^\/+/, '');
  if (imageCache.has(cleanPath)) {
    return imageCache.get(cleanPath);
  }
  if (imageCache.has(path)) {
    return imageCache.get(path);
  }
  const publicUrl = assetUrl(cleanPath);
  if (publicUrl && imageCache.has(publicUrl)) {
    return imageCache.get(publicUrl);
  }

  // 1. Try public URL
  if (publicUrl) {
    try {
      const img = await loadImage(publicUrl);
      cacheAssetImage(cleanPath, img);
      return img;
    } catch {
      // Fallback to direct storage download
    }
  }

  // 2. Authenticated storage download fallback
  try {
    const { data: blob, error } = await supabase.storage.from('event-assets').download(cleanPath);
    if (error || !blob) throw error || new Error('Blob is empty');
    const blobUrl = URL.createObjectURL(blob);
    const img = await loadImage(blobUrl);
    cacheAssetImage(cleanPath, img);
    return img;
  } catch (err) {
    console.error(`Failed to load asset image (${cleanPath}):`, err);
    throw err;
  }
}

const bgCache = new Map();
export function defaultBackground(w, h, style = 'gold-double') {
  const key = `${w}x${h}x${style}`;
  if (bgCache.has(key)) return bgCache.get(key);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  const m = Math.round(Math.min(w, h) * 0.03);

  if (style === 'tech-indigo') {
    // Modern indigo border with tech corner notches
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = 4;
    ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    ctx.strokeStyle = '#818cf8';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(m + 12, m + 12, w - 2 * (m + 12), h - 2 * (m + 12));
    // Corner accents
    const cl = Math.round(m * 1.5);
    ctx.fillStyle = '#4f46e5';
    [
      [m, m],
      [w - m - cl, m],
      [m, h - m - 4],
      [w - m - cl, h - m - 4],
    ].forEach(([x, y]) => ctx.fillRect(x, y, cl, 4));
  } else if (style === 'corporate-slate') {
    // Clean corporate border
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 5;
    ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(m + 8, m + 8, w - 2 * (m + 8), h - 2 * (m + 8));
  } else if (style === 'athletic-green') {
    // Athletic forest green border
    ctx.strokeStyle = '#15803d';
    ctx.lineWidth = 6;
    ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 2;
    ctx.strokeRect(m * 1.4, m * 1.4, w - 2.8 * m, h - 2.8 * m);
  } else if (style === 'vintage-diploma') {
    // Warm vintage cream background with ornate diploma frame
    ctx.fillStyle = '#fefdf8';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 5;
    ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(m + 10, m + 10, w - 2 * (m + 10), h - 2 * (m + 10));
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1;
    ctx.strokeRect(m + 18, m + 18, w - 2 * (m + 18), h - 2 * (m + 18));
  } else {
    // Default Gold Double Frame
    ctx.strokeStyle = '#c8a24a';
    ctx.lineWidth = Math.max(6, Math.round(m / 4));
    ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);
    ctx.lineWidth = 2;
    ctx.strokeRect(m * 1.6, m * 1.6, w - 3.2 * m, h - 3.2 * m);
  }

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
        images[p] = await loadAssetImage(p);
      } catch {
        failedPaths.push(p);
      }
    })
  );
  let bg;
  if (tpl.image_path) {
    try {
      bg = await loadAssetImage(tpl.image_path);
    } catch {
      failedPaths.push(tpl.image_path);
      bg = defaultBackground(tpl.width, tpl.height, cfg.bgStyle);
    }
  } else {
    bg = defaultBackground(tpl.width, tpl.height, cfg.bgStyle);
  }
  return { bg, images, failedPaths };
}

// ---------- fonts ----------
export const fontString = (f, size) => `${f?.italic ? 'italic ' : ''}${f?.weight || 400} ${size}px ${f?.family || 'sans-serif'}`;

const loadedFontsCache = new Set();

export async function ensureFonts(config, values) {
  if (!document.fonts?.load) return;
  const jobs = [];
  const cleanSample = (txt) => (fillTemplate(txt, values) || 'Aa').replace(/[\r\n\t]+/g, ' ').trim() || 'Aa';
  (config?.fields || []).forEach((f) => {
    const key = `${fontString(f, f.size || 28)}|${f.text}`;
    if (!loadedFontsCache.has(key)) {
      loadedFontsCache.add(key);
      jobs.push(document.fonts.load(fontString(f, f.size || 28), cleanSample(f.text)).catch(() => {}));
    }
  });
  (config?.signatories || []).forEach((s) => {
    const k1 = `${fontString({ family: s.family, weight: 700 }, s.nameSize || 26)}|${s.name}`;
    if (!loadedFontsCache.has(k1)) {
      loadedFontsCache.add(k1);
      jobs.push(document.fonts.load(fontString({ family: s.family, weight: 700 }, s.nameSize || 26), (s.name || 'Aa').replace(/[\r\n\t]+/g, ' ')).catch(() => {}));
    }
    const k2 = `${fontString({ family: s.family, weight: 400 }, s.titleSize || 20)}|${s.title}`;
    if (!loadedFontsCache.has(k2)) {
      loadedFontsCache.add(k2);
      jobs.push(document.fonts.load(fontString({ family: s.family, weight: 400 }, s.titleSize || 20), (s.title || 'Aa').replace(/[\r\n\t]+/g, ' ')).catch(() => {}));
    }
  });
  if (jobs.length > 0) {
    await Promise.allSettled(jobs);
  }
}

// ---------- dynamic condition evaluation ----------
export function evaluateCondition(cond, values) {
  if (!cond || !cond.field) return true;
  const rawKey = String(cond.field).replace(/^\{\{|\}\}$/g, '').trim().toLowerCase();
  if (!rawKey) return true;

  const matchingKey = Object.keys(values || {}).find((k) => k.toLowerCase() === rawKey);
  const actualVal = matchingKey !== undefined ? values[matchingKey] : '';
  const actualStr = String(actualVal ?? '').trim().toLowerCase();
  const targetStr = String(cond.value ?? '').trim().toLowerCase();

  const actualNum = Number(actualStr);
  const targetNum = Number(targetStr);
  const hasNumbers = !isNaN(actualNum) && !isNaN(targetNum) && actualStr !== '' && targetStr !== '';

  const op = cond.op || '==';
  switch (op) {
    case '==':
    case '=':
      return actualStr === targetStr;
    case '!=':
      return actualStr !== targetStr;
    case '>':
      return hasNumbers ? actualNum > targetNum : actualStr > targetStr;
    case '>=':
      return hasNumbers ? actualNum >= targetNum : actualStr >= targetStr;
    case '<':
      return hasNumbers ? actualNum < targetNum : actualStr < targetStr;
    case '<=':
      return hasNumbers ? actualNum <= targetNum : actualStr <= targetStr;
    case 'contains':
      return actualStr.includes(targetStr);
    case 'not_empty':
      return actualStr.length > 0;
    default:
      return true;
  }
}

// ---------- drawing helpers ----------
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
  const normalized = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  normalized.split('\n').forEach((para) => {
    if (!para.trim()) {
      out.push('');
      return;
    }
    const rawWords = para.split(/\s+/).filter(Boolean);
    const words = [];
    for (const w of rawWords) {
      if (ctx.measureText(w).width > maxW) {
        words.push(...splitWord(ctx, w, maxW));
      } else {
        words.push(w);
      }
    }
    let line = words[0] || '';
    for (let i = 1; i < words.length; i++) {
      const test = `${line} ${words[i]}`;
      if (ctx.measureText(test).width > maxW) {
        out.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  });
  return out.length ? out : [''];
}

function drawText(ctx, f, values) {
  if (f.hidden) return null;
  if (f.condition && !evaluateCondition(f.condition, values)) return null;

  const rawText = fillTemplate(f.text, values);
  const text = String(rawText ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
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
      const widest = () => Math.max(0, ...lines.map((l) => (l ? ctx.measureText(l).width : 0)));
      while (size > minSize && widest() > maxW) {
        size -= 1;
        ctx.font = fontString(f, size);
      }
    }
  }
  const lh = Number(f.lineHeight) || size * 1.35;
  const totalH = (lines.length - 1) * lh;
  const startY = f.y - totalH / 2;
  lines.forEach((l, i) => {
    if (l) ctx.fillText(l, f.x, startY + i * lh);
  });
  const w = Math.max(60, ...lines.map((l) => (l ? ctx.measureText(l).width : 0)));
  const h = Math.max(lh, lines.length * lh);
  const x0 = f.align === 'left' ? f.x : f.align === 'right' ? f.x - w : f.x - w / 2;
  if (hasSpacing) ctx.letterSpacing = '0px';
  return { ref: `field:${f.id}`, x: x0, y: startY - lh / 2, w, h };
}

// ---------- vector badges, ribbons & foil seals ----------
function drawStarburst(ctx, cx, cy, points, innerR, outerR) {
  const step = Math.PI / points;
  ctx.beginPath();
  for (let i = 0; i < 2 * points; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = i * step - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawStar(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.fillStyle = color;
  const step = Math.PI / 5;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = i * step - Math.PI / 2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRibbonTails(ctx, cx, cy, radius, primaryColor, secondaryColor) {
  ctx.save();
  const tailW = radius * 0.45;
  const tailH = radius * 1.05;
  const notch = radius * 0.25;

  ctx.fillStyle = secondaryColor || '#996515';

  // Left tail
  ctx.beginPath();
  ctx.moveTo(cx - radius * 0.5, cy + radius * 0.4);
  ctx.lineTo(cx - radius * 0.8, cy + radius * 0.4 + tailH);
  ctx.lineTo(cx - radius * 0.8 + tailW / 2, cy + radius * 0.4 + tailH - notch);
  ctx.lineTo(cx - radius * 0.8 + tailW, cy + radius * 0.4 + tailH);
  ctx.lineTo(cx - radius * 0.15, cy + radius * 0.4);
  ctx.closePath();
  ctx.fill();

  // Right tail
  ctx.beginPath();
  ctx.moveTo(cx + radius * 0.15, cy + radius * 0.4);
  ctx.lineTo(cx + radius * 0.8 - tailW, cy + radius * 0.4 + tailH);
  ctx.lineTo(cx + radius * 0.8 - tailW / 2, cy + radius * 0.4 + tailH - notch);
  ctx.lineTo(cx + radius * 0.8, cy + radius * 0.4 + tailH);
  ctx.lineTo(cx + radius * 0.5, cy + radius * 0.4);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawLaurelWreath(ctx, cx, cy, radius, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, radius * 0.035);

  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + dir * radius * 0.35, cy, radius * 0.45, radius * 0.65, dir * 0.2, Math.PI * 0.35, Math.PI * 1.65, dir === 1);
    ctx.stroke();

    const numLeaves = 8;
    for (let i = 0; i < numLeaves; i++) {
      const t = 0.35 + (i / numLeaves) * 0.65;
      const angle = Math.PI * t;
      const lx = cx + dir * (radius * 0.35 + Math.cos(angle) * radius * 0.45);
      const ly = cy + Math.sin(angle) * radius * 0.65;
      const leafAngle = angle + (dir === 1 ? -0.4 : 0.4);

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(leafAngle);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 0.11, radius * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Bow at base
  ctx.beginPath();
  ctx.arc(cx - radius * 0.1, cy + radius * 0.58, radius * 0.09, 0, Math.PI * 2);
  ctx.arc(cx + radius * 0.1, cy + radius * 0.58, radius * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFlourishDivider(ctx, cx, cy, width, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;

  const d = Math.max(8, width * 0.025);
  ctx.beginPath();
  ctx.moveTo(cx, cy - d);
  ctx.lineTo(cx + d, cy);
  ctx.lineTo(cx, cy + d);
  ctx.lineTo(cx - d, cy);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx - d * 2, cy, d * 0.25, 0, Math.PI * 2);
  ctx.arc(cx + d * 2, cy, d * 0.25, 0, Math.PI * 2);
  ctx.fill();

  const hw = width / 2;
  const startOffset = d * 3;
  ctx.beginPath();
  ctx.moveTo(cx - startOffset, cy);
  ctx.lineTo(cx - hw, cy);
  ctx.moveTo(cx + startOffset, cy);
  ctx.lineTo(cx + hw, cy);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx - hw, cy - 3, 3, 0, Math.PI * 2);
  ctx.arc(cx + hw, cy - 3, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawCornerFlourish(ctx, cx, cy, size, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;

  const hw = size / 2;
  const hh = (size * 0.7) / 2;
  const pad = 40;

  const corners = [
    { x: cx - hw + pad, y: cy - hh + pad, dx: 1, dy: 1 },
    { x: cx + hw - pad, y: cy - hh + pad, dx: -1, dy: 1 },
    { x: cx - hw + pad, y: cy + hh - pad, dx: 1, dy: -1 },
    { x: cx + hw - pad, y: cy + hh - pad, dx: -1, dy: -1 },
  ];

  corners.forEach(({ x, y, dx, dy }) => {
    const arm = 90;
    ctx.beginPath();
    ctx.moveTo(x, y + dy * arm);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * arm, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x + dx * 12, y + dy * (arm - 20));
    ctx.lineTo(x + dx * 12, y + dy * 12);
    ctx.lineTo(x + dx * (arm - 20), y + dy * 12);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + dx * 6, y + dy * 6, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

function drawRibbonBanner(ctx, cx, cy, width, color, secondaryColor, text) {
  ctx.save();
  const h = Math.round(width * 0.28);
  const hw = width / 2;
  const fold = h * 0.35;

  // Tail folds
  ctx.fillStyle = secondaryColor || '#996515';
  ctx.beginPath();
  ctx.moveTo(cx - hw + fold, cy);
  ctx.lineTo(cx - hw, cy + fold);
  ctx.lineTo(cx - hw + fold, cy + fold);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx + hw - fold, cy);
  ctx.lineTo(cx + hw, cy + fold);
  ctx.lineTo(cx + hw - fold, cy + fold);
  ctx.closePath();
  ctx.fill();

  // Main banner body
  ctx.fillStyle = color || '#c8a24a';
  ctx.beginPath();
  ctx.roundRect(cx - hw + fold * 0.7, cy - h / 2, width - fold * 1.4, h, 6);
  ctx.fill();

  // Text
  if (text) {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${Math.round(h * 0.45)}px 'Cinzel', serif`;
    ctx.fillText(text.toUpperCase(), cx, cy);
  }

  ctx.restore();
}

export function drawBadge(ctx, b, values) {
  if (!b || b.hidden) return null;
  if (b.condition && !evaluateCondition(b.condition, values)) return null;

  const x = Number(b.x) || 0;
  const y = Number(b.y) || 0;
  const size = Number(b.size) || 190;
  const variant = b.variant || 'gold-seal';
  const color = b.color || '#c8a24a';
  const secondaryColor = b.secondaryColor || '#996515';
  const opacity = b.opacity !== undefined ? Math.max(0, Math.min(1, Number(b.opacity))) : 1;

  ctx.save();
  ctx.globalAlpha = opacity;

  let boundW = size;
  let boundH = size;

  if (variant === 'gold-seal' || variant === 'silver-seal' || variant === 'bronze-seal') {
    const r = size / 2;
    // Tail ribbons
    drawRibbonTails(ctx, x, y, r, color, secondaryColor);

    // Outer starburst medallion
    const grad = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.1, x, y, r);
    if (variant === 'silver-seal') {
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.3, '#cbd5e1');
      grad.addColorStop(0.7, '#64748b');
      grad.addColorStop(1, '#334155');
    } else if (variant === 'bronze-seal') {
      grad.addColorStop(0, '#ffedd5');
      grad.addColorStop(0.3, '#fb923c');
      grad.addColorStop(0.7, '#c2410c');
      grad.addColorStop(1, '#7c2d12');
    } else {
      grad.addColorStop(0, '#fffbeb');
      grad.addColorStop(0.3, '#fde047');
      grad.addColorStop(0.65, '#ca8a04');
      grad.addColorStop(1, '#854d0e');
    }

    ctx.fillStyle = grad;
    ctx.strokeStyle = secondaryColor;
    ctx.lineWidth = 2;
    drawStarburst(ctx, x, y, 24, r * 0.88, r);
    ctx.fill();
    ctx.stroke();

    // Inner concentric circle
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    ctx.fillStyle = variant === 'silver-seal' ? '#f8fafc' : variant === 'bronze-seal' ? '#fff7ed' : '#fefce8';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Dotted accent ring
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.64, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Center icon or text
    if (b.text) {
      ctx.fillStyle = secondaryColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const mainSize = Math.max(12, Math.round(r * 0.24));
      ctx.font = `700 ${mainSize}px 'Cinzel', serif`;
      ctx.fillText(String(b.text).slice(0, 16), x, y - (b.subtext ? r * 0.12 : 0));

      if (b.subtext) {
        const subSize = Math.max(10, Math.round(r * 0.16));
        ctx.font = `600 ${subSize}px 'Montserrat', sans-serif`;
        ctx.fillStyle = '#64748b';
        ctx.fillText(String(b.subtext).slice(0, 18), x, y + r * 0.22);
      }
    } else {
      drawStar(ctx, x, y, r * 0.35, color);
    }

    boundH = size * 1.4; // includes ribbon tails
  } else if (variant === 'laurel-wreath') {
    const r = size / 2;
    drawLaurelWreath(ctx, x, y, r, color);

    if (b.text) {
      ctx.fillStyle = secondaryColor || color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${Math.round(r * 0.24)}px 'Cinzel', serif`;
      ctx.fillText(String(b.text).slice(0, 16), x, y);
    } else {
      drawStar(ctx, x, y, r * 0.28, color);
    }
  } else if (variant === 'divider-flourish') {
    boundW = size;
    boundH = Math.max(40, size * 0.12);
    drawFlourishDivider(ctx, x, y, size, color);
  } else if (variant === 'corner-flourish') {
    boundW = size;
    boundH = Math.round(size * 0.7);
    drawCornerFlourish(ctx, x, y, size, color);
  } else if (variant === 'ribbon-banner') {
    boundW = size;
    boundH = Math.round(size * 0.35);
    drawRibbonBanner(ctx, x, y, size, color, secondaryColor, b.text);
  } else if (variant === 'watermark') {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = color || '#cbd5e1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(size * 0.4)}px 'Montserrat', sans-serif`;
    ctx.fillText((b.text || 'VERIFIED CREDENTIAL').toUpperCase(), 0, 0);
    ctx.restore();
    boundW = size * 1.5;
    boundH = size * 0.8;
  }

  ctx.restore();
  return { ref: `badge:${b.id}`, x: x - boundW / 2, y: y - boundH / 2, w: boundW, h: boundH };
}

export function drawCertificate(canvas, tpl, assets, values, qrImage) {
  if (!canvas || !tpl || !assets) return [];
  const W = Number(tpl.width) || 1754;
  const H = Number(tpl.height) || 1240;
  const cfg = tpl.config || {};
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  if (assets.bg) {
    try {
      ctx.drawImage(assets.bg, 0, 0, W, H);
    } catch (e) {
      console.warn('Failed to draw background image:', e);
    }
  }

  const boxes = [];

  // Map elements by ref for unified layer ordering
  const elementMap = new Map();
  (cfg.badges || []).forEach((b) => elementMap.set(`badge:${b.id}`, { type: 'badge', data: b }));
  (cfg.images || []).forEach((im) => elementMap.set(`image:${im.id}`, { type: 'image', data: im }));
  (cfg.fields || []).forEach((f) => elementMap.set(`field:${f.id}`, { type: 'field', data: f }));
  (cfg.signatories || []).forEach((s) => elementMap.set(`sig:${s.id}`, { type: 'sig', data: s }));
  if (cfg.qr?.enabled) elementMap.set('qr', { type: 'qr', data: cfg.qr });

  // Unified drawing order: use cfg.layers if present, or default bottom-to-top order
  let order = Array.isArray(cfg.layers) && cfg.layers.length > 0 ? [...cfg.layers] : null;
  if (!order) {
    order = [
      ...(cfg.badges || []).map((b) => `badge:${b.id}`),
      ...(cfg.images || []).map((i) => `image:${i.id}`),
      ...(cfg.fields || []).map((f) => `field:${f.id}`),
      ...(cfg.signatories || []).map((s) => `sig:${s.id}`),
      ...(cfg.qr?.enabled ? ['qr'] : []),
    ];
  } else {
    // Append any unlisted elements to the end
    elementMap.forEach((_, ref) => {
      if (!order.includes(ref)) order.push(ref);
    });
  }

  order.forEach((ref) => {
    const el = elementMap.get(ref);
    if (!el) return;
    const { type, data } = el;

    if (data.hidden) return;
    if (data.condition && !evaluateCondition(data.condition, values)) return;

    if (type === 'badge') {
      const box = drawBadge(ctx, data, values);
      if (box) boxes.push(box);
    } else if (type === 'field') {
      const box = drawText(ctx, data, values);
      if (box) boxes.push(box);
    } else if (type === 'image') {
      const im = data;
      const img = assets.images && im.path ? assets.images[im.path] : null;
      const w = Number(im.width) || 200;
      if (!img || !img.width || !img.height) {
        boxes.push({ ref: `image:${im.id}`, x: (im.x || 0) - w / 2, y: (im.y || 0) - w / 4, w, h: w / 2 });
        return;
      }
      const h = (w * img.height) / img.width;
      try {
        ctx.drawImage(img, (im.x || 0) - w / 2, (im.y || 0) - h / 2, w, h);
      } catch {
        /* ignore draw error */
      }
      boxes.push({ ref: `image:${im.id}`, x: (im.x || 0) - w / 2, y: (im.y || 0) - h / 2, w, h });
    } else if (type === 'sig') {
      const s = data;
      const color = s.color || '#1f2937';
      const lw = Number(s.lineWidth) || 260;
      const img = s.path && assets.images ? assets.images[s.path] : null;
      let top = (s.y || 0) - 50;
      if (img && img.width && img.height) {
        const w = Number(s.sigWidth) || 220;
        const h = (w * img.height) / img.width;
        try {
          ctx.drawImage(img, (s.x || 0) - w / 2, (s.y || 0) - h - 4, w, h);
        } catch {
          /* ignore draw error */
        }
        top = (s.y || 0) - h - 4;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo((s.x || 0) - lw / 2, s.y || 0);
      ctx.lineTo((s.x || 0) + lw / 2, s.y || 0);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const ns = s.nameSize || 26;
      const ts = s.titleSize || 20;
      ctx.font = fontString({ family: s.family, weight: 700 }, ns);
      ctx.fillText(s.name || '', s.x || 0, (s.y || 0) + 10, lw + 80);
      ctx.font = fontString({ family: s.family, weight: 400 }, ts);
      ctx.fillText(s.title || '', s.x || 0, (s.y || 0) + 10 + ns * 1.25, lw + 80);
      boxes.push({ ref: `sig:${s.id}`, x: (s.x || 0) - lw / 2, y: top, w: lw, h: (s.y || 0) + 10 + ns * 1.25 + ts - top });
    } else if (type === 'qr') {
      const qr = data;
      const size = Number(qr.size) || 180;
      if (qrImage) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect((qr.x || 0) - size / 2 - 8, (qr.y || 0) - size / 2 - 8, size + 16, size + 16);
        try {
          ctx.drawImage(qrImage, (qr.x || 0) - size / 2, (qr.y || 0) - size / 2, size, size);
        } catch {
          /* ignore draw error */
        }
      }
      boxes.push({ ref: 'qr', x: (qr.x || 0) - size / 2, y: (qr.y || 0) - size / 2, w: size, h: size });
    }
  });

  return boxes;
}

// ---------- PDF export ----------
export function canvasToPdfBlob(canvas) {
  if (!canvas) throw new Error('Canvas element is required for PDF export');
  const w = canvas.width;
  const h = canvas.height;
  const landscape = w >= h;
  const pageW = landscape ? 297 : 210; // A4 standard in mm
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
export function rescaleConfig(cfg, oldW, newW, oldH, newH) {
  if (!oldW || oldW === newW) return cfg;
  const kx = newW / oldW;
  const ky = oldH && newH ? newH / oldH : kx;
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
    badges: (cfg.badges || []).map((b) => ({
      ...b,
      x: rx(b.x),
      y: ry(b.y),
      size: rx(b.size || 190),
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
    layers: cfg.layers ? [...cfg.layers] : undefined,
  };
}
