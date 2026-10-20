// Fetches a publicly shared Google Sheet as CSV (browsers cannot, due to CORS).
import { adminClient, handle, HttpError, json, requireUser } from "../_shared/common.ts";

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
  const csv = await res.text();
  if (csv.length > 5_000_000) throw new HttpError(413, "Sheet is too large (limit 5 MB)");
  return json({ csv });
}));
