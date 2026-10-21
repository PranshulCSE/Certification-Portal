// Email worker. Called every minute by pg_cron (header x-cron-secret) and by the
// "Send next batch" button (signed-in user). Respects the daily cap and per-run batch size.
import { adminClient, cleanReplyTo, cleanSubject, fromAddress, handle, json, requireUser, toHtml, transporter } from "../_shared/common.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(handle(async (req) => {
  const admin = adminClient();
  const cron = Deno.env.get("CRON_SECRET");
  const isCron = !!cron && req.headers.get("x-cron-secret") === cron;
  if (!isCron) await requireUser(req, admin);

  const { data: settings } = await admin.from("app_settings").select("*").eq("id", 1).single();
  if (!settings?.sending_enabled) return json({ sent: 0, failed: 0, message: "Sending is paused in settings" });

  // Recover jobs stuck in "sending" (e.g. a crashed run)
  await admin.from("email_jobs").update({ status: "queued", locked_at: null })
    .eq("status", "sending").lt("locked_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin.from("email_jobs").select("id", { count: "exact", head: true }).eq("status", "sent").gt("sent_at", since);
  const remaining = settings.daily_cap - (count || 0);
  if (remaining <= 0) return json({ sent: 0, failed: 0, message: `Daily cap of ${settings.daily_cap} reached. The queue resumes automatically.` });

  const { data: jobs, error } = await admin.rpc("claim_email_jobs", { p_limit: Math.min(settings.batch_size, remaining) });
  if (error) throw new Error(error.message);
  if (!jobs || jobs.length === 0) return json({ sent: 0, failed: 0, message: "Nothing to send" });

  const tx = transporter();
  const started = Date.now();
  let sent = 0;
  let failed = 0;
  let note = "";
  let stop = false;
  let stopDelayMs = 0;
  let stopError: string | undefined = undefined;

  // deno-lint-ignore no-explicit-any
  const release = (job: any, error?: string, delayMs = 0) =>
    admin.from("email_jobs").update({
      status: "queued", attempts: Math.max(0, job.attempts - 1), locked_at: null,
      last_error: error ?? null, scheduled_at: new Date(Date.now() + delayMs).toISOString(),
    }).eq("id", job.id);

  try {
    for (const job of jobs) {
      if (stop || Date.now() - started > 110_000) {
        await release(job, stopError, stopDelayMs);
        continue;
      }
      try {
        const { data: cert } = await admin.from("certificates").select("pdf_path,status,pdf_ready").eq("id", job.certificate_id).single();
        if (!cert || cert.status !== "issued" || !cert.pdf_ready || !cert.pdf_path) throw Object.assign(new Error("Certificate file is not available"), { permanent: true });
        const { data: file, error: dErr } = await admin.storage.from("certificates").download(cert.pdf_path);
        if (dErr || !file) throw new Error("Could not read the certificate PDF");
        const content = new Uint8Array(await file.arrayBuffer());

        await tx.sendMail({
          from: fromAddress(job.from_name),
          to: job.to_email,
          replyTo: cleanReplyTo(job.reply_to),
          subject: cleanSubject(job.subject),
          text: job.body,
          html: toHtml(job.body),
          attachments: [{ filename: job.attachment_name || "certificate.pdf", content, contentType: "application/pdf" }],
        });
        await admin.from("email_jobs").update({ status: "sent", sent_at: new Date().toISOString(), last_error: null, locked_at: null }).eq("id", job.id);
        sent++;
        await sleep(250);
      } catch (e) {
        // deno-lint-ignore no-explicit-any
        const err = e as any;
        const msg = String(err?.response || err?.message || err).slice(0, 300);
        const code = Number(err?.responseCode) || 0;

        if (err?.code === "EAUTH" || code === 535) {
          // Wrong/expired App Password: pause the whole run, delay all remaining jobs.
          stopDelayMs = 15 * 60 * 1000;
          stopError = `Mail login failed. Check SMTP_USER / SMTP_APP_PASSWORD. (${msg})`;
          await release(job, stopError, stopDelayMs);
          note = "Mail login failed. Check the App Password secret.";
          stop = true;
          continue;
        }
        if (/daily user sending|sending limit|quota|rate limit|too many/i.test(msg) || code === 452 || code === 421) {
          stopDelayMs = 60 * 60 * 1000;
          stopError = msg;
          await release(job, msg, stopDelayMs);
          note = "Mailbox sending limit reached. Will retry in an hour.";
          stop = true;
          continue;
        }
        const permanent = err?.permanent || err?.code === "EENVELOPE" || (code >= 500 && code < 600);
        const giveUp = permanent || job.attempts >= 3;
        await admin.from("email_jobs").update(
          giveUp
            ? { status: permanent && !err?.permanent ? "bounced" : "failed", last_error: msg, locked_at: null }
            : { status: "queued", last_error: msg, locked_at: null, scheduled_at: new Date(Date.now() + job.attempts * 5 * 60 * 1000).toISOString() },
        ).eq("id", job.id);
        failed++;
      }
    }
  } finally {
    try { tx.close(); } catch { /* ignore close error */ }
  }

  return json({ sent, failed, claimed: jobs.length, message: note || `Sent ${sent}, failed ${failed}` });
}));
