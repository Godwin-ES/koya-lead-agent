-- Worker-down alerts. A worker that has died can't report itself, so this
-- runs inside Supabase instead: every minute, pg_cron calls
-- worker_watchdog(), which posts one Discord message (via pg_net) when a
-- live run has waited in the queue for over 5 minutes, or a running run's
-- heartbeat has been silent for over 3 minutes - most likely no worker is
-- up. Each stuck run is alerted once (ops_alerts), not every minute.
--
-- The webhook URL and app URL are secrets in Supabase Vault, set by
-- scripts/set-alert-secrets.mjs - never in a migration. Until they're set,
-- the watchdog does nothing, so development against this project isn't
-- alerted about runs queued while no local worker is running.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create table if not exists ops_alerts (
  key text primary key,
  sent_at timestamptz not null default now()
);
alter table ops_alerts enable row level security;
-- No policies: only the watchdog (security definer) and the service role touch it.
grant select, insert, update, delete on ops_alerts to service_role;

create or replace function worker_watchdog() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  webhook text;
  app_url text;
  new_queued int := 0;
  new_stale int := 0;
  message text;
begin
  select decrypted_secret into webhook from vault.decrypted_secrets where name = 'discord_alerts_webhook' limit 1;
  if webhook is null or webhook = '' then
    return;
  end if;
  select decrypted_secret into app_url from vault.decrypted_secrets where name = 'app_url' limit 1;

  with stuck as (
    select id, status from runs
     where replay_mode = false
       and ((status = 'queued' and coalesce(queued_at, created_at) < now() - interval '5 minutes')
         or (status = 'running' and heartbeat_at < now() - interval '3 minutes'))
  ), inserted as (
    insert into ops_alerts (key)
    select 'stuck:' || id || ':' || status from stuck
    on conflict (key) do nothing
    returning key
  )
  select count(*) filter (where key like '%:queued'), count(*) filter (where key like '%:running')
    into new_queued, new_stale
    from inserted;

  delete from ops_alerts where sent_at < now() - interval '7 days';

  if new_queued = 0 and new_stale = 0 then
    return;
  end if;

  message := concat_ws(' ',
    case when new_queued > 0 then new_queued || ' run(s) waiting in the queue for over 5 minutes.' end,
    case when new_stale > 0 then new_stale || ' running run(s) with no worker heartbeat for over 3 minutes.' end,
    'The worker is probably down - check it on the host.');

  perform net.http_post(
    url := webhook,
    body := jsonb_build_object(
      'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb),
      'embeds', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'title', '🔴 No worker is picking up runs',
        'description', message,
        'url', case when app_url is not null and app_url <> '' then rtrim(app_url, '/') || '/runs' end,
        'color', 12986408
      )))
    ),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
end;
$$;

revoke execute on function worker_watchdog() from public;

select cron.schedule('koya-worker-watchdog', '* * * * *', $$select public.worker_watchdog()$$);
