import {
  adminClient,
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default handleApi(async (req, res) => {
  const admin = adminClient();
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers['authorization'] || req.headers['Authorization'] || '';
  const xCron = req.headers['x-cron-secret'];
  const isVercelCron = Boolean(req.headers['x-vercel-cron']);

  const isCron =
    isVercelCron ||
    (Boolean(cronSecret) && (xCron === cronSecret || authHeader === `Bearer ${cronSecret}`));

  if (!isCron) {
    await requireUser(req, admin);
  }

  const { data: settings } = await admin.from('app_settings').select('*').eq('id', 1).single();
  if (!settings?.sending_enabled) {
    return sendJson(res, { sent: 0, failed: 0, message: 'Sending is paused in settings' });
  }

  // Recover jobs stuck in "sending" (e.g. from a crashed or timed-out run)
  await admin
    .from('email_jobs')
    .update({ status: 'queued', locked_at: null })
    .eq('status', 'sending')
    .lt('locked_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin
    .from('email_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'sent')
    .gt('sent_at', since);

  const remaining = (settings.daily_cap || 1500) - (count || 0);
  if (remaining <= 0) {
    return sendJson(res, {
      sent: 0,
      failed: 0,
      message: `Daily cap of ${settings.daily_cap} reached. The queue resumes automatically tomorrow.`,
    });
  }

  const batchSize = Math.min(settings.batch_size || 20, remaining);
  const { data: jobs, error } = await admin.rpc('claim_email_jobs', { p_limit: batchSize });
  if (error) throw new Error(error.message);
  if (!jobs || jobs.length === 0) {
    return sendJson(res, { sent: 0, failed: 0, message: 'Nothing to send' });
  }

  const tx = transporter();
  const started = Date.now();
  let sent = 0;
  let failed = 0;
  let note = '';
  let stop = false;
  let stopDelayMs = 0;
  let stopError = null;

  const release = (job, errorMsg, delayMs = 0) =>
    admin
      .from('email_jobs')
      .update({
        status: 'queued',
        attempts: Math.max(0, (job.attempts || 1) - 1),
        locked_at: null,
        last_error: errorMsg ?? null,
        scheduled_at: new Date(Date.now() + delayMs).toISOString(),
      })
      .eq('id', job.id);

  try {
    for (const job of jobs) {
      // Vercel serverless functions have a max execution limit (default 10s or 60s); prevent hard timeout
      if (stop || Date.now() - started > 45_000) {
        await release(job, stopError, stopDelayMs);
        continue;
      }

      try {
        const { data: cert } = await admin
          .from('certificates')
          .select('pdf_path,status,pdf_ready')
          .eq('id', job.certificate_id)
          .single();

        if (!cert || cert.status !== 'issued' || !cert.pdf_ready || !cert.pdf_path) {
          throw Object.assign(new Error('Certificate file is not available'), { permanent: true });
        }

        const { data: file, error: dErr } = await admin.storage.from('certificates').download(cert.pdf_path);
        if (dErr || !file) throw new Error('Could not read the certificate PDF from storage');

        const content = Buffer.from(await file.arrayBuffer());

        await tx.sendMail({
          from: fromAddress(job.from_name),
          to: job.to_email,
          replyTo: cleanReplyTo(job.reply_to),
          subject: cleanSubject(job.subject),
          text: job.body,
          html: toHtml(job.body),
          attachments: [{ filename: job.attachment_name || 'certificate.pdf', content, contentType: 'application/pdf' }],
        });

        await admin
          .from('email_jobs')
          .update({ status: 'sent', sent_at: new Date().toISOString(), last_error: null, locked_at: null })
          .eq('id', job.id);

        sent++;
        await sleep(250);
      } catch (e) {
        const msg = String(e?.response || e?.message || e).slice(0, 300);
        const code = Number(e?.responseCode) || 0;

        if (e?.code === 'EAUTH' || code === 535) {
          stopDelayMs = 15 * 60 * 1000;
          stopError = `Mail login failed. Check SMTP_USER / SMTP_APP_PASSWORD. (${msg})`;
          await release(job, stopError, stopDelayMs);
          note = 'Mail login failed. Check the Google App Password.';
          stop = true;
          continue;
        }

        if (/daily user sending|sending limit|quota|rate limit|too many/i.test(msg) || code === 452 || code === 421) {
          stopDelayMs = 60 * 60 * 1000;
          stopError = msg;
          await release(job, msg, stopDelayMs);
          note = 'Mailbox sending limit reached. Will retry in an hour.';
          stop = true;
          continue;
        }

        const permanent = e?.permanent || e?.code === 'EENVELOPE' || (code >= 500 && code < 600);
        const giveUp = permanent || (job.attempts || 1) >= 3;

        await admin
          .from('email_jobs')
          .update(
            giveUp
              ? { status: permanent && !e?.permanent ? 'bounced' : 'failed', last_error: msg, locked_at: null }
              : {
                  status: 'queued',
                  last_error: msg,
                  locked_at: null,
                  scheduled_at: new Date(Date.now() + (job.attempts || 1) * 5 * 60 * 1000).toISOString(),
                }
          )
          .eq('id', job.id);

        failed++;
      }
    }
  } finally {
    try {
      tx.close();
    } catch {
      /* ignore */
    }
  }

  return sendJson(res, {
    sent,
    failed,
    claimed: jobs.length,
    message: note || `Sent ${sent}, failed ${failed}`,
  });
});
