-- ATLAS Alicante · ajuste de celebraciones.
-- La interfaz seguirá mostrando el progreso continuamente, pero solo habrá
-- fiesta visual al alcanzar una meta y reconocimiento privado para cierres
-- superiores a 1.300 € completamente liquidados.

create or replace function public.atlas_objectives_alicante_snapshot(p_organization_id uuid,p_clinic_id uuid,p_period date default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_period date:=coalesce(date_trunc('month',p_period)::date,date_trunc('month',timezone('Europe/Madrid',now()))::date);
 v_values jsonb;v_targets jsonb;v_settings public.objective_settings%rowtype;v_now timestamptz:=now();v_hour timestamptz;
 v_metric record;v_budget record;
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

 -- Se conserva una instantánea para la comparativa, sin generar avisos horarios.
 v_hour:=date_bin(make_interval(mins=>v_settings.hourly_frequency_minutes),v_now,timestamptz '2000-01-01 00:00:00+00');
 insert into public.objective_progress_snapshots(organization_id,clinic_id,period,snapshot_hour,values)
 values(p_organization_id,p_clinic_id,v_period,v_hour,v_values) on conflict(clinic_id,snapshot_hour) do update set values=excluded.values;

 for v_budget in
  with accepted as (
   select b.*,
    coalesce((select sum(case when lower(pay.payment_type)='refund' then -abs(pay.amount) when pay.cancelled_at is not null then 0 else pay.amount end) from public.payments pay where pay.budget_id=b.id and pay.deleted_at is null and pay.status in ('completed','cancelled','refunded')),0) net_paid,
    case when coalesce(b.metadata->>'budget_presenter_user_id','')~*'^[0-9a-f-]{36}$' then (b.metadata->>'budget_presenter_user_id')::uuid end presenter_id
   from public.budgets b
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

-- Retira de la cola las fiestas horarias ya generadas, sin borrar el historial.
update public.objective_notifications
set acknowledged_at=coalesce(acknowledged_at,now())
where kind='hourly_progress' and acknowledged_at is null;
