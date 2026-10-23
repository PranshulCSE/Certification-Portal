import { adminClient, handleApi, HttpError, requireUser, sendJson } from './_shared.js';

const MAX_BYTES = 5_000_000; // 5 MB

export default handleApi(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

  await requireUser(req, adminClient());
  const { url } = req.parsedBody || {};

  const m = String(url || '').match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new HttpError(400, 'Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/...)');

  const gid = String(url).match(/[#&?]gid=(\d+)/)?.[1];
  const exportUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;

  const response = await fetch(exportUrl, { redirect: 'follow' });
  const type = response.headers.get('content-type') || '';
  if (!response.ok || !type.includes('csv')) {
    throw new HttpError(400, 'Could not read the sheet. Set sharing to "Anyone with the link can view" and try again.');
  }

  const csv = await response.text();
  if (Buffer.byteLength(csv) > MAX_BYTES) {
    throw new HttpError(413, 'Sheet is too large (limit 5 MB)');
  }

  return sendJson(res, { csv });
});
