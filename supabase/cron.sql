-- Run ONCE in the SQL Editor AFTER deploying the process-queue Edge Function.
-- Replace the two placeholders. CRON_SECRET must equal the CRON_SECRET secret you set on the functions.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'process-email-queue',
  '* * * * *',            -- every minute
  $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/process-queue',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-CRON-SECRET'),
    body    := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- To stop the schedule:   select cron.unschedule('process-email-queue');
