-- Private configuration: activation occurs only after the frontend is published.
create table private.atlas_clock_reminder_targets (
 organization_id uuid not null references public.organizations(id),
 clinic_id uuid not null references public.clinics(id),
 user_id uuid not null references public.profiles(user_id),
 enabled boolean not null default false,
 enabled_at timestamptz not null default now(),
 primary key (clinic_id,user_id)
);
revoke all on private.atlas_clock_reminder_targets from public,anon,authenticated;

create table public.atlas_clock_reminders (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 clinic_id uuid not null references public.clinics(id),
 recipient_user_id uuid not null references public.profiles(user_id),
 event_kind text not null check(event_kind in ('entry','exit')),
 event_at timestamptz not null,
 due_at timestamptz not null,
 shift_start timestamptz not null,
 shift_end timestamptz not null,
 body text not null,
 created_at timestamptz not null default now(),
 acknowledged_at timestamptz,
 cancelled_at timestamptz,
 unique(clinic_id,recipient_user_id,event_kind,event_at),
 check(due_at=event_at-interval '3 minutes'),
 check(shift_start<shift_end)
);
create index atlas_clock_reminders_pending on public.atlas_clock_reminders(recipient_user_id,due_at) where acknowledged_at is null and cancelled_at is null;
alter table public.atlas_clock_reminders enable row level security;
revoke all on public.atlas_clock_reminders from public,anon,authenticated;
grant select on public.atlas_clock_reminders to authenticated;
grant update(acknowledged_at) on public.atlas_clock_reminders to authenticated;
create policy atlas_clock_reminders_read_own on public.atlas_clock_reminders for select to authenticated using (
 recipient_user_id=(select auth.uid()) and private.is_active_clinic_member((select auth.uid()),organization_id,clinic_id)
);
create policy atlas_clock_reminders_ack_own on public.atlas_clock_reminders for update to authenticated using (
 recipient_user_id=(select auth.uid()) and acknowledged_at is null and cancelled_at is null and private.is_active_clinic_member((select auth.uid()),organization_id,clinic_id)
) with check(recipient_user_id=(select auth.uid()) and acknowledged_at is not null and private.is_active_clinic_member((select auth.uid()),organization_id,clinic_id));
create function public.atlas_ack_clock_reminder(p_reminder_id uuid) returns timestamptz
 language plpgsql security invoker set search_path='' as $$
declare result timestamptz;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 update public.atlas_clock_reminders set acknowledged_at=now() where id=p_reminder_id and recipient_user_id=auth.uid() and acknowledged_at is null and cancelled_at is null returning acknowledged_at into result;
 if result is null then select acknowledged_at into result from public.atlas_clock_reminders where id=p_reminder_id and recipient_user_id=auth.uid(); end if;
 if result is null then raise exception 'Recordatorio no disponible para esta cuenta'; end if;
 return result;
end $$;
revoke all on function public.atlas_ack_clock_reminder(uuid) from public,anon;
grant execute on function public.atlas_ack_clock_reminder(uuid) to authenticated;

-- Pure schedule calculation, used by the server and synthetic regression tests.
-- Uses the same company.professionals schedule and availability overrides as the agenda.
create function private.atlas_clock_reminder_events(p_profile jsonb,p_agenda jsonb,p_attendance jsonb,p_day date)
 returns table(event_kind text,event_at timestamptz,shift_start timestamptz,shift_end timestamptz)
 language sql stable security invoker set search_path='' as $$
 with override as (
  select item from jsonb_array_elements(coalesce(p_agenda->'availabilityOverrides','[]'::jsonb)) with ordinality as x(item,ord)
  where item->>'date'=p_day::text and item->>'resource'=p_profile->>'name'
  order by case when item->>'id' ~ '^\d+$' then (item->>'id')::numeric else 0 end desc,ord desc limit 1
 ), spans as (
  select value from jsonb_array_elements(case when exists(select 1 from override) then
   (select case when item->>'kind'='closed' then '[]'::jsonb else jsonb_build_array(jsonb_build_array(item->>'start',item->>'end')) end from override)
   else coalesce(p_profile->'schedule'->extract(dow from p_day)::int::text,'[]'::jsonb) end)
 ), work as (
  select tsrange(p_day+(value->>0)::time,p_day+(value->>1)::time,'[)') as span from spans
  where value->>0 ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and value->>1 ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and value->>0<value->>1
 ), opening as (
  select tsrange(p_day+(value->>0)::time,p_day+(value->>1)::time,'[)') as span
  from jsonb_array_elements(coalesce(p_agenda->'hours'->extract(dow from p_day)::int::text,'[]'::jsonb))
  where value->>0 ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and value->>1 ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and value->>0<value->>1
 ), base as (
  select coalesce(range_agg(w.span*o.span),'{}'::tsmultirange) as spans from work w cross join opening o where w.span&&o.span
 ), blocks as (
  select item from jsonb_array_elements(coalesce(p_agenda->'blocks','[]'::jsonb)) as x(item)
  where coalesce(item->>'source','')<>'conversion_anónimo_aviso'
   and item->>'date'<=p_day::text and coalesce(nullif(item->>'endDate',''),item->>'date')>=p_day::text
   and (coalesce(item->>'repeat','none')<>'weekly' or item->'weekdays' @> jsonb_build_array(extract(dow from p_day)::int))
   and (item->'resources' ? (p_profile->>'name') or item->'resources' ? '*')
   and coalesce(item->>'category','') not in ('meeting','training')
   and (item->>'type'='day' or item->'resources' ? '*' or item->>'category' in ('vacation','absence','sick_leave','holiday'))
 ), excluded as (
  select case when item->>'type'='day' then tsrange(p_day::timestamp,(p_day+1)::timestamp,'[)')
   else tsrange(p_day+(item->>'start')::time,p_day+(item->>'end')::time,'[)') end as span
  from blocks where item->>'type'='day' or (item->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and item->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and item->>'start'<item->>'end')
  union all
  select tsrange(p_day+(item->>'start')::time,p_day+(item->>'end')::time,'[)')
  from jsonb_array_elements(coalesce(p_attendance->'absences','[]'::jsonb)) as x(item)
  where item->>'employee'=p_profile->>'name' and item->>'date'=p_day::text
   and item->>'start' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and item->>'end' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and item->>'start'<item->>'end'
 ), actual as (
  select unnest(base.spans-coalesce((select range_agg(span) from excluded),'{}'::tsmultirange)) as span from base
  where coalesce((p_profile->>'active')::boolean,true) and not exists(select 1 from jsonb_array_elements(coalesce(p_agenda->'holidays','[]'::jsonb)) h where h->>'date'=p_day::text)
 )
 select event.kind,event.at at time zone 'Europe/Madrid',lower(actual.span) at time zone 'Europe/Madrid',upper(actual.span) at time zone 'Europe/Madrid'
 from actual cross join lateral (values ('entry',lower(actual.span)),('exit',upper(actual.span))) as event(kind,at)
 where not isempty(actual.span)
$$;
revoke all on function private.atlas_clock_reminder_events(jsonb,jsonb,jsonb,date) from public,anon,authenticated;

create function private.atlas_clock_reminder_candidates(p_now timestamptz)
 returns table(organization_id uuid,clinic_id uuid,recipient_user_id uuid,event_kind text,event_at timestamptz,shift_start timestamptz,shift_end timestamptz,enabled_at timestamptz)
 language sql stable security invoker set search_path='' as $$
 select target.organization_id,target.clinic_id,target.user_id,event.event_kind,event.event_at,event.shift_start,event.shift_end,target.enabled_at
 from private.atlas_clock_reminder_targets target
 join public.profiles account on account.user_id=target.user_id
 join public.clinic_settings company on company.organization_id=target.organization_id and company.clinic_id=target.clinic_id and company.section='company'
 join public.clinic_settings agenda on agenda.organization_id=target.organization_id and agenda.clinic_id=target.clinic_id and agenda.section='agenda'
 left join public.clinic_settings other on other.organization_id=target.organization_id and other.clinic_id=target.clinic_id and other.section='other'
 cross join lateral jsonb_array_elements(coalesce(company.payload->'professionals','[]'::jsonb)) as professional(profile)
 cross join lateral generate_series(-7,1) as days(offset_day)
 cross join lateral private.atlas_clock_reminder_events(profile,agenda.payload,coalesce(other.payload->'attendance','{}'::jsonb),(p_now at time zone 'Europe/Madrid')::date+days.offset_day) event
 where target.enabled and profile->>'name'=account.full_name
  and exists(select 1 from public.memberships m where m.organization_id=target.organization_id and m.clinic_id=target.clinic_id and m.user_id=target.user_id and m.active and m.role='therapist')
  and not exists(select 1 from public.staff_absences a join public.staff_contracts c on c.id=a.contract_id where a.organization_id=target.organization_id and a.clinic_id=target.clinic_id and c.professional_name=account.full_name and a.status='approved' and ((event.shift_start at time zone 'Europe/Madrid')::date between a.start_date and a.end_date))
$$;
revoke all on function private.atlas_clock_reminder_candidates(timestamptz) from public,anon,authenticated;

create function private.atlas_generate_clock_reminders() returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare tick timestamptz:=clock_timestamp();created_count integer;cancelled_count integer;
begin
 if not pg_try_advisory_xact_lock(hashtext('atlas_generate_clock_reminders')) then return jsonb_build_object('skipped',true); end if;
 -- Retain obsolete messages for history; remove their pending notice if the registered shift changes.
 update public.atlas_clock_reminders notice set cancelled_at=tick
 where notice.cancelled_at is null and notice.acknowledged_at is null
  and notice.event_at >= ((tick at time zone 'Europe/Madrid')::date::timestamp at time zone 'Europe/Madrid')
  and not exists(select 1 from private.atlas_clock_reminder_candidates(tick) e where e.clinic_id=notice.clinic_id and e.recipient_user_id=notice.recipient_user_id and e.event_kind=notice.event_kind and e.event_at=notice.event_at);
 get diagnostics cancelled_count=row_count;
 insert into public.atlas_clock_reminders(organization_id,clinic_id,recipient_user_id,event_kind,event_at,due_at,shift_start,shift_end,body)
 select e.organization_id,e.clinic_id,e.recipient_user_id,e.event_kind,e.event_at,e.event_at-interval '3 minutes',e.shift_start,e.shift_end,
  'Recuerda fichar tu '||case e.event_kind when 'entry' then 'entrada' else 'salida' end||' a las '||to_char(e.event_at at time zone 'Europe/Madrid','HH24:MI')||' del '||to_char(e.event_at at time zone 'Europe/Madrid','DD/MM/YYYY')||'. Pulsa OK para confirmar que has leído el aviso. OK no registra el fichaje.'
 from private.atlas_clock_reminder_candidates(tick) e
 where e.event_at-interval '3 minutes'>=e.enabled_at and e.event_at-interval '3 minutes'<=tick and e.event_at-interval '3 minutes'>tick-interval '70 seconds'
 on conflict(clinic_id,recipient_user_id,event_kind,event_at) do nothing;
 get diagnostics created_count=row_count;
 return jsonb_build_object('created',created_count,'cancelled',cancelled_count);
end $$;
revoke all on function private.atlas_generate_clock_reminders() from public,anon,authenticated;

-- Recipients are configured privately, after verifying their existing accounts.
-- No names, account IDs or schedules are stored in this migration.

-- Start disabled; activate only after publishing and verifying the matching frontend.
select cron.schedule('atlas-clock-chat-reminders','* * * * *','select private.atlas_generate_clock_reminders();');
select cron.alter_job((select jobid from cron.job where jobname='atlas-clock-chat-reminders'),active:=false);
notify pgrst,'reload schema';
