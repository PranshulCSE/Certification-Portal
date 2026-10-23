import {
  adminClient,
  b64ToBytes,
  cleanReplyTo,
  cleanSubject,
  fromAddress,
  handleApi,
  HttpError,
  requireUser,
  sendJson,
  toHtml,
  transporter,
} from './_shared.js';

export default handleApi(async (req, res) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');

  const admin = adminClient();
  const { user } = await requireUser(req, admin);
  const b = req.parsedBody || {};
  const to = String(b.to || '').trim().toLowerCase();

  if (!to || to !== String(user.email || '').toLowerCase()) {
    throw new HttpError(403, 'Test emails can only be sent to your own login email.');
  }
  if (b.pdf_base64 && String(b.pdf_base64).length > 8_000_000) {
    throw new HttpError(413, 'Attachment is too large');
  }

  const attachments = b.pdf_base64
    ? [
        {
          filename: String(b.filename || 'certificate-sample.pdf').replace(/[^\w.\- ]/g, '_'),
          content: b64ToBytes(b.pdf_base64),
          contentType: 'application/pdf',
        },
      ]
    : [];

  const tx = transporter();
  try {
    await tx.sendMail({
      from: fromAddress(b.from_name),
      to,
      replyTo: cleanReplyTo(b.reply_to),
      subject: `[TEST] ${cleanSubject(b.subject || 'Certificate portal test')}`,
      text: String(b.body || ''),
      html: toHtml(String(b.body || '')),
      attachments,
    });
  } catch (e) {
    if (e?.code === 'EAUTH') {
      throw new HttpError(
        502,
        'Google rejected the login. Check SMTP_USER and SMTP_APP_PASSWORD (2-Step Verification must be enabled).'
      );
    }
    throw new HttpError(502, String(e?.response || e?.message || e).slice(0, 250));
  } finally {
    try {
      tx.close();
    } catch {
      /* ignore */
    }
  }

  return sendJson(res, { ok: true });
});
