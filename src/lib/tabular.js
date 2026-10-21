import Papa from 'papaparse';
import readXlsxFile from 'read-excel-file';
import { isEmail, normKey } from './format';

export const MAX_ROWS = 5000;

function cleanCell(c) {
  if (c == null) return '';
  if (c instanceof Date && !Number.isNaN(c.getTime())) {
    const y = c.getFullYear();
    const m = String(c.getMonth() + 1).padStart(2, '0');
    const d = String(c.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(c).trim();
}

function toTable(rows) {
  const clean = rows.map((r) => r.map(cleanCell)).filter((r) => r.some((c) => c !== ''));
  if (clean.length < 2) throw new Error('The file needs a header row and at least one data row.');
  const seen = new Map();
  const headers = clean[0].map((h, i) => {
    let name = h || `column_${i + 1}`;
    const n = (seen.get(name) || 0) + 1;
    seen.set(name, n);
    return n > 1 ? `${name}_${n}` : name;
  });
  const body = clean.slice(1, MAX_ROWS + 1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i] ?? ''));
    return obj;
  });
  return { headers, rows: body, truncated: clean.length - 1 > MAX_ROWS };
}

export function parseCsvText(text) {
  const res = Papa.parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  return toTable(res.data);
}

export async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'xlsx') return toTable(await readXlsxFile(file));
  if (['csv', 'tsv', 'txt'].includes(ext)) return parseCsvText(await file.text());
  throw new Error('Upload a .csv or .xlsx file. For an old .xls file, save it as .xlsx first.');
}

const NAME_HINTS = ['name', 'full name', 'fullname', 'participant name', 'participant', 'student name', 'candidate name', 'candidate', 'team leader name', 'recipient'];
const EMAIL_HINTS = ['email', 'e-mail', 'email id', 'email address', 'mail', 'mail id', 'emailid', 'participant email'];

export function autoMap(headers) {
  const norm = headers.map((h) => ({ h, n: normKey(h) }));
  const pick = (hints) => {
    for (const hint of hints) {
      const hit = norm.find((x) => x.n === normKey(hint));
      if (hit) return hit.h;
    }
    for (const hint of hints) {
      const hit = norm.find((x) => x.n.includes(normKey(hint)));
      if (hit) return hit.h;
    }
    return '';
  };
  return { name: pick(NAME_HINTS), email: pick(EMAIL_HINTS) };
}

// existingEmails: Set of lower-cased emails already in the event.
// existingNames: Set of lower-cased names already in the event (checked if email column is omitted).
export function validateRows(rows, map, existingEmails = new Set(), { fixCase = false, existingNames = new Set() } = {}) {
  const seenEmails = new Set();
  const seenNames = new Set();
  return rows.map((row, i) => {
    let name = (row[map.name] || '').replace(/\s+/g, ' ').trim();
    const email = map.email ? (row[map.email] || '').trim().toLowerCase() : '';
    const extra = {};
    Object.entries(row).forEach(([k, v]) => {
      if (k !== map.name && k !== map.email && String(v).trim() !== '') extra[normKey(k)] = String(v).trim();
    });
    if (fixCase && name && (name === name.toUpperCase() || name === name.toLowerCase())) {
      name = name.toLowerCase().replace(/(^|[\s.'-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
    }
    let status = 'ok';
    let note = '';
    const lowerName = name.toLowerCase();
    if (!name) {
      status = 'error';
      note = 'Name is empty';
    } else if (map.email && !email) {
      status = 'error';
      note = 'Email is empty';
    } else if (email && !isEmail(email)) {
      status = 'error';
      note = 'Invalid email';
    } else if (email && existingEmails.has(email)) {
      status = 'duplicate';
      note = 'Already in this event';
    } else if (email && seenEmails.has(email)) {
      status = 'duplicate';
      note = 'Repeated in this file';
    } else if (!map.email && existingNames.has(lowerName)) {
      status = 'duplicate';
      note = 'Already in this event';
    } else if (!map.email && seenNames.has(lowerName)) {
      status = 'duplicate';
      note = 'Repeated in this file';
    }
    if (email) seenEmails.add(email);
    if (name) seenNames.add(lowerName);
    return { index: i + 1, name, email: email || null, extra, status, note };
  });
}

export const SAMPLE_CSV = 'name,email,rank,team\nAarav Sharma,aarav@example.com,1st,Team Alpha\nDiya Verma,diya@example.com,2nd,Team Beta\n';
