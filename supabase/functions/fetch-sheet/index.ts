// Fetches a publicly shared Google Sheet as CSV (browsers cannot, due to CORS).
import { adminClient, handle, HttpError, json, requireUser } from "../_shared/common.ts";

const MAX_BYTES = 5_000_000; // 5 MB limit

Deno.serve(handle(async (req) => {
  await requireUser(req, adminClient());
  const { url } = await req.json().catch(() => ({ url: "" }));
  const m = String(url || "").match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!m) throw new HttpError(400, "Paste a Google Sheets link (https://docs.google.com/spreadsheets/d/...)");
  const gid = String(url).match(/[#&?]gid=(\d+)/)?.[1];
  const exportUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ""}`;

  const res = await fetch(exportUrl, { redirect: "follow" });
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !type.includes("csv")) {
    throw new HttpError(400, "Could not read the sheet. Set sharing to “Anyone with the link can view” and try again.");
  }

  const cl = Number(res.headers.get("content-length")) || 0;
  if (cl > MAX_BYTES) throw new HttpError(413, "Sheet is too large (limit 5 MB)");

  if (!res.body) return json({ csv: "" });
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > MAX_BYTES) {
          await reader.cancel();
          throw new HttpError(413, "Sheet is too large (limit 5 MB)");
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, "Failed to read the sheet stream");
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  const csv = new TextDecoder().decode(merged);
  return json({ csv });
}));
