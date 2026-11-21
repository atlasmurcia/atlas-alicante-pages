-- ATLAS Alicante · resumen agregado y envío automático a ATLAS Murcia.
-- El cuerpo contiene exclusivamente facturación, cuatro contadores y sus metas.

create or replace function public.atlas_team_goals_sync_payload(p_period date default null)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_period date:=coalesce(date_trunc('month',p_period)::date,date_trunc('month',timezone('Europe/Madrid',now()))::date);
  v_from timestamptz;
  v_to timestamptz;
  v_org uuid;
  v_clinic uuid;
  v_targets jsonb:='{}'::jsonb;
  v_revenue numeric:=0;
  v_traction numeric:=0;
  v_mbst numeric:=0;
  v_bomba numeric:=0;
  v_brains numeric:=0;
begin
  v_from=(v_period::timestamp at time zone 'Europe/Madrid');
  v_to=v_from+interval '1 month';

  select c.organization_id,c.id into v_org,v_clinic
  from public.clinics c
  where lower(c.name) like '%alicante%'
  order by c.created_at limit 1;
  if v_clinic is null then raise exception 'No se encontró la clínica de Alicante';end if;

  select coalesce(s.payload->'team_goals'->'periods'->to_char(v_period,'YYYY-MM'),'{}'::jsonb)
  into v_targets
  from public.clinic_settings s
  where s.organization_id=v_org and s.clinic_id=v_clinic and s.section='other'
  limit 1;

  with payment_events as (
    select p.paid_at event_at,case when p.payment_type='refund' then -abs(p.amount) else p.amount end signed_amount
    from public.payments p
    where p.organization_id=v_org and p.clinic_id=v_clinic and p.deleted_at is null
      and p.status in ('completed','cancelled','refunded')
    union all
    select p.cancelled_at,-abs(p.amount)
    from public.payments p
    where p.organization_id=v_org and p.clinic_id=v_clinic and p.deleted_at is null
      and p.payment_type<>'refund' and p.cancelled_at is not null
  )
  select coalesce(sum(signed_amount),0) into v_revenue
  from payment_events where event_at>=v_from and event_at<v_to;

  with completed as (
    select lower(coalesce(a.services::text,'')||' '||coalesce(a.resources::text,'')||' '||coalesce(a.metadata->>'therapy','')) haystack
    from public.appointments a
    where a.organization_id=v_org and a.clinic_id=v_clinic and a.deleted_at is null
      and a.status='completed' and a.starts_at>=v_from and a.starts_at<v_to
  )
  select
    count(*) filter(where haystack like '%tracci%'),
    count(*) filter(where haystack like '%mbst%' or haystack like '%osteospin%'),
    count(*) filter(where haystack like '%bomba%'),
    count(*) filter(where haystack like '%brains%' or haystack like '%brain way%')
  into v_traction,v_mbst,v_bomba,v_brains
  from completed;

  return jsonb_build_object(
    'p_source_clinic','Alicante',
    'p_period',v_period,
    'p_generated_at',now(),
    'p_revenue',round(v_revenue,2),
    'p_mbst_sessions',coalesce(v_mbst,0),
    'p_bomba_sessions',coalesce(v_bomba,0),
    'p_robot_traction_sessions',coalesce(v_traction,0),
    'p_brains_sessions',coalesce(v_brains,0),
    'p_revenue_target',coalesce((v_targets->'team_net_invoicing'->>'target')::numeric,0),
    'p_mbst_target',coalesce((v_targets->'team_mbst_paid_sessions'->>'target')::numeric,0),
    'p_bomba_target',coalesce((v_targets->'team_bomba_paid_sessions'->>'target')::numeric,0),
    'p_robot_traction_target',coalesce((v_targets->'team_traction_paid_sessions'->>'target')::numeric,0),
    'p_brains_target',coalesce((v_targets->'team_brains_paid_sessions'->>'target')::numeric,0)
  );
end
$$;

revoke all on function public.atlas_team_goals_sync_payload(date) from public,anon,authenticated;

create or replace function public.atlas_team_goals_sync_to_murcia()
returns bigint
language plpgsql
security definer
set search_path=public,vault,net,pg_temp
as $$
declare
  v_token text;
  v_url text;
  v_key text;
  v_body jsonb;
  v_request_id bigint;
begin
  select decrypted_secret into v_token from vault.decrypted_secrets where name='atlas_murcia_objectives_sync_token';
  select decrypted_secret into v_url from vault.decrypted_secrets where name='atlas_murcia_objectives_sync_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name='atlas_murcia_publishable_key';
  if v_token is null or v_url is null or v_key is null then raise exception 'Falta la configuración segura de sincronización';end if;

  v_body:=public.atlas_team_goals_sync_payload(null)||jsonb_build_object('p_sync_token',v_token);
  select net.http_post(
    url=>v_url,
    headers=>jsonb_build_object('Content-Type','application/json','apikey',v_key,'Authorization','Bearer '||v_key),
    body=>v_body,
    timeout_milliseconds=>10000
  ) into v_request_id;
  return v_request_id;
end
$$;

revoke all on function public.atlas_team_goals_sync_to_murcia() from public,anon,authenticated;
grant execute on function public.atlas_team_goals_sync_to_murcia() to service_role;

do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname='atlas-objectives-sync-murcia' limit 1;
  if v_job is not null then perform cron.unschedule(v_job);end if;
  perform cron.schedule('atlas-objectives-sync-murcia','*/15 * * * *','select public.atlas_team_goals_sync_to_murcia();');
end
$$;

