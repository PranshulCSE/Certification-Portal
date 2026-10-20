export function formatDate(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d.length === 10 ? `${d}T00:00:00` : d);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateTime(d) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const normKey = (k) =>
  String(k ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// Replaces {{token}} with values[token]; unknown tokens become empty.
export function fillTemplate(str, values) {
  return String(str ?? '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
    const v = values?.[k.toLowerCase()];
    return v == null ? '' : String(v);
  });
}

export function buildValues({ name, extra }, event, { code, issuer, verify_url } = {}) {
  const normalizedExtra = {};
  Object.entries(extra || {}).forEach(([k, v]) => {
    normalizedExtra[normKey(k)] = v;
  });
  return {
    ...normalizedExtra,
    name: name || '',
    event: event?.name || '',
    organizer: event?.organizer || '',
    date: formatDate(event?.event_date),
    issue_date: formatDate(new Date()),
    code: code || '',
    issuer: issuer || '',
    verify_url: verify_url || '',
  };
}

export const BASE_TOKENS = ['name', 'event', 'organizer', 'date', 'issue_date', 'code', 'issuer'];
export const EMAIL_TOKENS = [...BASE_TOKENS, 'verify_url'];

export function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|[\s.'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
}

export function safeFileName(s) {
  return String(s || 'certificate').normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'certificate';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s || '').trim());

export const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs async tasks with limited concurrency.
export async function runPool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(blob);
  });
}
