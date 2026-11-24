-- ATLAS Alicante · objetivos y celebraciones protegidas.
-- Esta migración es aditiva y no modifica citas, pacientes, cobros ni presupuestos existentes.

begin;

create or replace function public.atlas_objectives_alicante_is_member(p_organization_id uuid,p_clinic_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(
  select 1 from public.memberships m
  where m.user_id=(select auth.uid()) and m.organization_id=p_organization_id and m.active
   and (m.clinic_id is null or m.clinic_id=p_clinic_id)
 )
$$;
revoke all on function public.atlas_objectives_alicante_is_member(uuid,uuid) from public,anon;
grant execute on function public.atlas_objectives_alicante_is_member(uuid,uuid) to authenticated;

create or replace function public.atlas_objectives_alicante_is_management(p_organization_id uuid,p_clinic_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(
  select 1 from public.memberships m
  where m.user_id=(select auth.uid()) and m.organization_id=p_organization_id and m.active
   and (m.clinic_id is null or m.clinic_id=p_clinic_id)
   and (m.role in ('owner','administrator')
    or coalesce((m.permissions->>'management')::boolean,false)
    or coalesce((m.permissions->>'management_access')::boolean,false)
    or lower(coalesce(m.permissions->>'display_role','')) in ('gestión','gestion','dirección','direccion','gerencia'))
 )
$$;
revoke all on function public.atlas_objectives_alicante_is_management(uuid,uuid) from public,anon;
grant execute on function public.atlas_objectives_alicante_is_management(uuid,uuid) to authenticated;

create table if not exists public.objective_settings (
 clinic_id uuid primary key references public.clinics(id),
 organization_id uuid not null references public.organizations(id),
 sound_key text not null default 'caja-wow' check(sound_key in ('caja-wow','none')),
 hourly_frequency_minutes integer not null default 60 check(hourly_frequency_minutes in (60,120,180)),
 opening_hours jsonb not null default '{"1":["08:00","21:00"],"2":["08:00","21:00"],"3":["08:00","21:00"],"4":["08:00","21:00"],"5":["08:00","21:00"],"6":["09:00","14:00"]}'::jsonb,
 started_at timestamptz not null default now(),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
create index if not exists objective_settings_organization_idx on public.objective_settings(organization_id);
create index if not exists objective_settings_updated_by_idx on public.objective_settings(updated_by);
alter table public.objective_settings enable row level security;
drop policy if exists objective_settings_read_members on public.objective_settings;
drop policy if exists objective_settings_insert_management on public.objective_settings;
drop policy if exists objective_settings_update_management on public.objective_settings;
create policy objective_settings_read_members on public.objective_settings for select to authenticated
 using ((select public.atlas_objectives_alicante_is_member(organization_id,clinic_id)));
create policy objective_settings_insert_management on public.objective_settings for insert to authenticated
 with check ((select public.atlas_objectives_alicante_is_management(organization_id,clinic_id)));
create policy objective_settings_update_management on public.objective_settings for update to authenticated
 using ((select public.atlas_objectives_alicante_is_management(organization_id,clinic_id)))
 with check ((select public.atlas_objectives_alicante_is_management(organization_id,clinic_id)));
revoke all on public.objective_settings from anon;
grant select,insert,update on public.objective_settings to authenticated;

create table if not exists public.objective_notifications (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 clinic_id uuid not null references public.clinics(id),
 recipient_user_id uuid not null references auth.users(id),
 kind text not null check(kind in ('hourly_progress','goal_reached','personal_sale')),
 period date not null,
 metric text,
 title text not null,
 body text not null,
 payload jsonb not null default '{}'::jsonb,
 dedupe_key text not null,
 created_at timestamptz not null default now(),
 acknowledged_at timestamptz,
 unique(recipient_user_id,dedupe_key)
);
create index if not exists objective_notifications_recipient_pending_idx on public.objective_notifications(recipient_user_id,created_at) where acknowledged_at is null;
create index if not exists objective_notifications_recipient_idx on public.objective_notifications(recipient_user_id);
create index if not exists objective_notifications_clinic_idx on public.objective_notifications(clinic_id,created_at desc);
alter table public.objective_notifications enable row level security;
drop policy if exists objective_notifications_read_own on public.objective_notifications;
create policy objective_notifications_read_own on public.objective_notifications for select to authenticated
 using (recipient_user_id=(select auth.uid()));
revoke all on public.objective_notifications from anon,authenticated;
grant select on public.objective_notifications to authenticated;

create table if not exists public.objective_progress_snapshots (
 organization_id uuid not null references public.organizations(id),
 clinic_id uuid not null references public.clinics(id),
 period date not null,
 snapshot_hour timestamptz not null,
 values jsonb not null,
 created_at timestamptz not null default now(),
 primary key(clinic_id,snapshot_hour)
);
alter table public.objective_progress_snapshots enable row level security;
drop policy if exists objective_progress_snapshots_deny_direct on public.objective_progress_snapshots;
create policy objective_progress_snapshots_deny_direct on public.objective_progress_snapshots for all to authenticated using (false) with check (false);
revoke all on public.objective_progress_snapshots from anon,authenticated;

create or replace function public.atlas_objectives_alicante_metric(p_text text)
returns text language sql immutable set search_path=public,pg_temp as $$
 select case
  when translate(lower(coalesce(p_text,'')),'áéíóúüñ','aeiouun') like any(array['%brains%','%brain way%']) then 'team_brains_paid_sessions'
  when translate(lower(coalesce(p_text,'')),'áéíóúüñ','aeiouun') like '%bomba%' then 'team_bomba_paid_sessions'
  when translate(lower(coalesce(p_text,'')),'áéíóúüñ','aeiouun') like any(array['%mbst%','%osteospin%']) then 'team_mbst_paid_sessions'
  when translate(lower(coalesce(p_text,'')),'áéíóúüñ','aeiouun') like '%traccion%' then 'team_traction_paid_sessions'
 end
$$;
revoke all on function public.atlas_objectives_alicante_metric(text) from public,anon,authenticated;

create or replace function public.atlas_objectives_alicante_values(p_organization_id uuid,p_clinic_id uuid,p_period date)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with bounds as (
  select (date_trunc('month',p_period::timestamp) at time zone 'Europe/Madrid') from_at,
   (date_trunc('month',p_period::timestamp) at time zone 'Europe/Madrid')+interval '1 month' to_at
 ), payment_events as (
  select p.paid_at event_at,case when lower(p.payment_type)='refund' then -abs(p.amount) else p.amount end amount
  from public.payments p,bounds b
  where p.organization_id=p_organization_id and p.clinic_id=p_clinic_id and p.deleted_at is null
   and p.status in ('completed','cancelled','refunded') and p.paid_at>=b.from_at and p.paid_at<b.to_at
  union all
  select p.cancelled_at,-abs(p.amount)
  from public.payments p,bounds b
  where p.organization_id=p_organization_id and p.clinic_id=p_clinic_id and p.deleted_at is null
   and lower(p.payment_type)<>'refund' and p.cancelled_at>=b.from_at and p.cancelled_at<b.to_at
 ), appointment_metrics as (
  select distinct a.id,public.atlas_objectives_alicante_metric(x.value) metric
  from public.appointments a,bounds b
  cross join lateral jsonb_array_elements_text(
   coalesce(a.services,'[]'::jsonb)||coalesce(a.resources,'[]'::jsonb)||jsonb_build_array(coalesce(a.metadata->>'therapy',''))
  ) x(value)
  where a.organization_id=p_organization_id and a.clinic_id=p_clinic_id and a.deleted_at is null
   and a.status='completed' and a.starts_at>=b.from_at and a.starts_at<b.to_at
 ), counts as (
  select metric,count(*)::numeric value from appointment_metrics where metric is not null group by metric
 )
 select jsonb_build_object(
  'team_net_invoicing',round(coalesce((select sum(amount) from payment_events),0),2),
  'team_traction_paid_sessions',coalesce((select value from counts where metric='team_traction_paid_sessions'),0),
  'team_mbst_paid_sessions',coalesce((select value from counts where metric='team_mbst_paid_sessions'),0),
  'team_bomba_paid_sessions',coalesce((select value from counts where metric='team_bomba_paid_sessions'),0),
  'team_brains_paid_sessions',coalesce((select value from counts where metric='team_brains_paid_sessions'),0)
 )
$$;
revoke all on function public.atlas_objectives_alicante_values(uuid,uuid,date) from public,anon,authenticated;

create or replace function public.atlas_objectives_alicante_targets(p_organization_id uuid,p_clinic_id uuid,p_period date)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((
  select jsonb_build_object(
   'team_net_invoicing',coalesce((g->'team_net_invoicing'->>'target')::numeric,0),
   'team_traction_paid_sessions',coalesce((g->'team_traction_paid_sessions'->>'target')::numeric,0),
   'team_mbst_paid_sessions',coalesce((g->'team_mbst_paid_sessions'->>'target')::numeric,0),
   'team_bomba_paid_sessions',coalesce((g->'team_bomba_paid_sessions'->>'target')::numeric,0),
   'team_brains_paid_sessions',coalesce((g->'team_brains_paid_sessions'->>'target')::numeric,0)
  )
  from public.clinic_settings c
  cross join lateral (select c.payload->'team_goals'->'periods'->to_char(p_period,'YYYY-MM') g) x
  where c.organization_id=p_organization_id and c.clinic_id=p_clinic_id and c.section='other'
 ),'{}'::jsonb)
$$;
revoke all on function public.atlas_objectives_alicante_targets(uuid,uuid,date) from public,anon,authenticated;

create or replace function public.atlas_objectives_alicante_snapshot(p_organization_id uuid,p_clinic_id uuid,p_period date default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_period date:=coalesce(date_trunc('month',p_period)::date,date_trunc('month',timezone('Europe/Madrid',now()))::date);
 v_values jsonb;v_targets jsonb;v_settings public.objective_settings%rowtype;v_now timestamptz:=now();v_hour timestamptz;v_previous jsonb;
 v_metric record;v_budget record;v_summary text;v_day text;v_open text[];
begin
 if not public.atlas_objectives_alicante_is_member(p_organization_id,p_clinic_id) then raise exception 'Acceso no autorizado';end if;
 insert into public.objective_settings(organization_id,clinic_id) values(p_organization_id,p_clinic_id) on conflict(clinic_id) do nothing;
 select * into v_settings from public.objective_settings where clinic_id=p_clinic_id and organization_id=p_organization_id;
 v_values:=public.atlas_objectives_alicante_values(p_organization_id,p_clinic_id,v_period);
 v_targets:=public.atlas_objectives_alicante_targets(p_organization_id,p_clinic_id,v_period);

 for v_metric in select key,value from jsonb_each(v_targets) loop
  if (v_metric.value#>>'{}')::numeric>0 and coalesce((v_values->>v_metric.key)::numeric,0)>=(v_metric.value#>>'{}')::numeric then
   insert into public.objective_notifications(organization_id,clinic_id,recipient_user_id,kind,period,metric,title,body,payload,dedupe_key)
   select p_organization_id,p_clinic_id,m.user_id,'goal_reached',v_period,v_metric.key,'¡Objetivo conseguido!',
    '🎊 ¡Alicante ha alcanzado el objetivo de '||case v_metric.key when 'team_net_invoicing' then 'Facturación' when 'team_traction_paid_sessions' then 'Tracción' when 'team_mbst_paid_sessions' then 'MBST' when 'team_bomba_paid_sessions' then 'Bomba' else 'Brains' end||'! ¡Superfiesta, equipo!',
    jsonb_build_object('values',v_values,'target',v_metric.value),'goal:'||p_clinic_id||':'||v_period||':'||v_metric.key
   from public.memberships m where m.organization_id=p_organization_id and m.active and (m.clinic_id is null or m.clinic_id=p_clinic_id)
   on conflict do nothing;
  end if;
 end loop;

 v_hour:=date_bin(make_interval(mins=>v_settings.hourly_frequency_minutes),v_now,timestamptz '2000-01-01 00:00:00+00');
 select values into v_previous from public.objective_progress_snapshots where clinic_id=p_clinic_id and period=v_period and snapshot_hour<v_hour order by snapshot_hour desc limit 1;
 insert into public.objective_progress_snapshots(organization_id,clinic_id,period,snapshot_hour,values)
 values(p_organization_id,p_clinic_id,v_period,v_hour,v_values) on conflict(clinic_id,snapshot_hour) do update set values=excluded.values;
 v_day:=extract(isodow from timezone('Europe/Madrid',v_now))::integer::text;
 if v_settings.opening_hours?v_day then v_open:=array[v_settings.opening_hours->v_day->>0,v_settings.opening_hours->v_day->>1];end if;
 if false and v_previous is not null and v_open is not null
  and timezone('Europe/Madrid',v_now)::time between v_open[1]::time and v_open[2]::time
  and exists(select 1 from jsonb_each_text(v_values) n left join jsonb_each_text(v_previous) p using(key) where n.value::numeric>coalesce(p.value::numeric,0)) then
  v_summary:='🚀 Avance de Alicante: '||(select string_agg(case n.key when 'team_net_invoicing' then 'Facturación '||round(n.value::numeric)||' €' when 'team_traction_paid_sessions' then 'Tracción '||n.value when 'team_mbst_paid_sessions' then 'MBST '||n.value when 'team_bomba_paid_sessions' then 'Bomba '||n.value else 'Brains '||n.value end,' · ') from jsonb_each_text(v_values) n left join jsonb_each_text(v_previous) p using(key) where n.value::numeric>coalesce(p.value::numeric,0));
  insert into public.objective_notifications(organization_id,clinic_id,recipient_user_id,kind,period,title,body,payload,dedupe_key)
  select p_organization_id,p_clinic_id,m.user_id,'hourly_progress',v_period,'¡Seguimos avanzando!',v_summary,jsonb_build_object('values',v_values),'hour:'||p_clinic_id||':'||v_hour
  from public.memberships m where m.organization_id=p_organization_id and m.active and (m.clinic_id is null or m.clinic_id=p_clinic_id) on conflict do nothing;
 end if;

 for v_budget in
  with accepted as (
   select b.*,p.first_name,p.last_name_1,
    coalesce((select sum(case when lower(pay.payment_type)='refund' then -abs(pay.amount) when pay.cancelled_at is not null then 0 else pay.amount end) from public.payments pay where pay.budget_id=b.id and pay.deleted_at is null and pay.status in ('completed','cancelled','refunded')),0) net_paid,
    case when coalesce(b.metadata->>'budget_presenter_user_id','')~*'^[0-9a-f-]{36}$' then (b.metadata->>'budget_presenter_user_id')::uuid end presenter_id
   from public.budgets b join public.patients p on p.id=b.patient_id
   where b.organization_id=p_organization_id and b.clinic_id=p_clinic_id and b.deleted_at is null and b.status='accepted'
    and b.accepted_at>=v_settings.started_at
  ), attributed as (
   select a.*,vp.user_id valuation_user_id,va.id valuation_appointment_id
   from accepted a
   join public.memberships presenter on presenter.user_id=a.presenter_id and presenter.organization_id=p_organization_id and presenter.active and (presenter.clinic_id is null or presenter.clinic_id=p_clinic_id) and presenter.role in ('reception','assistant')
   join lateral (select (array_agg(candidate.user_id))[1] user_id from (select distinct pr.user_id from public.profiles pr join public.memberships m on m.user_id=pr.user_id and m.organization_id=p_organization_id and m.active and (m.clinic_id is null or m.clinic_id=p_clinic_id) where lower(trim(pr.full_name))=lower(trim(a.metadata->>'valuation_professional'))) candidate having count(*)=1) vp on true
   join lateral (select ap.id from public.appointments ap cross join lateral jsonb_array_elements_text(coalesce(ap.services,'[]'::jsonb)) service where ap.patient_id=a.patient_id and ap.clinic_id=p_clinic_id and ap.deleted_at is null and ap.status='completed' and ap.starts_at<=a.accepted_at and ap.starts_at>=a.accepted_at-interval '14 days' and (translate(lower(service),'áéíóúüñ','aeiouun') like '%valoraci%' or translate(lower(service),'áéíóúüñ','aeiouun') like '%1%consulta%') order by ap.starts_at desc limit 1) va on true
   where a.presenter_id is not null and a.total>1300 and a.net_paid>=a.total
  ) select * from attributed
 loop
  insert into public.objective_notifications(organization_id,clinic_id,recipient_user_id,kind,period,title,body,payload,dedupe_key)
  select p_organization_id,p_clinic_id,recipient,'personal_sale',date_trunc('month',v_budget.accepted_at at time zone 'Europe/Madrid')::date,'¡Tratamiento cerrado!',
   '🎉 ¡Felicidades, '||coalesce((select split_part(full_name,' ',1) from public.profiles where user_id=recipient),'equipo')||'! Has participado en el cierre de un tratamiento superior a 1.300 € completamente liquidado. Gracias por tu trabajo y por seguir sumando a FisioSport. ¡Vamos, equipo!',
   jsonb_build_object('budget_id',v_budget.id,'valuation_appointment_id',v_budget.valuation_appointment_id),'sale:'||v_budget.id
  from (select distinct unnest(array[v_budget.valuation_user_id,v_budget.presenter_id]) recipient) recipients on conflict do nothing;
 end loop;

 return jsonb_build_object('period',v_period,'values',v_values,'targets',v_targets,
  'settings',jsonb_build_object('sound_key',v_settings.sound_key,'hourly_frequency_minutes',v_settings.hourly_frequency_minutes,'opening_hours',v_settings.opening_hours),
  'notifications',(select coalesce(jsonb_agg(n order by n.created_at),'[]'::jsonb) from public.objective_notifications n where n.recipient_user_id=(select auth.uid()) and n.acknowledged_at is null));
end $$;
revoke all on function public.atlas_objectives_alicante_snapshot(uuid,uuid,date) from public,anon;
grant execute on function public.atlas_objectives_alicante_snapshot(uuid,uuid,date) to authenticated;

create or replace function public.atlas_objectives_acknowledge(p_notification_id uuid)
returns timestamptz language plpgsql security definer set search_path=public,pg_temp as $$
declare v_at timestamptz:=now();
begin
 update public.objective_notifications set acknowledged_at=v_at
 where id=p_notification_id and recipient_user_id=(select auth.uid()) and acknowledged_at is null;
 if not found then raise exception 'Aviso no disponible';end if;
 return v_at;
end $$;
revoke all on function public.atlas_objectives_acknowledge(uuid) from public,anon;
grant execute on function public.atlas_objectives_acknowledge(uuid) to authenticated;

create or replace function public.atlas_objectives_alicante_save_settings(p_organization_id uuid,p_clinic_id uuid,p_sound_key text,p_hourly_frequency_minutes integer)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.atlas_objectives_alicante_is_management(p_organization_id,p_clinic_id) then raise exception 'Acceso reservado a Dirección y Gestión';end if;
 if p_sound_key not in ('caja-wow','none') then raise exception 'Sonido no válido';end if;
 if p_hourly_frequency_minutes not in (60,120,180) then raise exception 'Frecuencia no válida';end if;
 insert into public.objective_settings(organization_id,clinic_id,sound_key,hourly_frequency_minutes,updated_by)
 values(p_organization_id,p_clinic_id,p_sound_key,p_hourly_frequency_minutes,(select auth.uid()))
 on conflict(clinic_id) do update set sound_key=excluded.sound_key,hourly_frequency_minutes=excluded.hourly_frequency_minutes,updated_by=(select auth.uid()),updated_at=now();
 return true;
end $$;
revoke all on function public.atlas_objectives_alicante_save_settings(uuid,uuid,text,integer) from public,anon;
grant execute on function public.atlas_objectives_alicante_save_settings(uuid,uuid,text,integer) to authenticated;

commit;
