// Sends a test email to the signed-in user's own address (never to anyone else).
import { adminClient, b64ToBytes, cleanReplyTo, cleanSubject, fromAddress, handle, HttpError, json, requireUser, toHtml, transporter } from "../_shared/common.ts";

Deno.serve(handle(async (req) => {
  const admin = adminClient();
  const { user } = await requireUser(req, admin);
  const b = await req.json().catch(() => ({}));
  const to = String(b.to || "").trim().toLowerCase();
  if (!to || to !== String(user.email || "").toLowerCase()) throw new HttpError(403, "Test emails can only be sent to your own login email.");
  if (b.pdf_base64 && String(b.pdf_base64).length > 8_000_000) throw new HttpError(413, "Attachment is too large");

  const attachments = b.pdf_base64
    ? [{ filename: String(b.filename || "certificate-sample.pdf").replace(/[^\w.\- ]/g, "_"), content: b64ToBytes(b.pdf_base64), contentType: "application/pdf" }]
    : [];
  const tx = transporter();
  try {
    await tx.sendMail({
      from: fromAddress(b.from_name),
      to,
      replyTo: cleanReplyTo(b.reply_to),
      subject: `[TEST] ${cleanSubject(b.subject || "Certificate portal test")}`,
      text: String(b.body || ""),
      html: toHtml(String(b.body || "")),
      attachments,
    });
  } catch (e) {
    // deno-lint-ignore no-explicit-any
    const err = e as any;
    if (err?.code === "EAUTH") throw new HttpError(502, "Google rejected the login. Check SMTP_USER and the App Password (2-Step Verification must be on, and the admin must allow app passwords).");
    throw new HttpError(502, String(err?.response || err?.message || err).slice(0, 250));
  } finally {
    try { tx.close(); } catch { /* ignore close error */ }
  }
  return json({ ok: true });
}));
