-- ATLAS Alicante · receptor seguro del resumen mensual agregado de Murcia.

create schema if not exists atlas_private;
revoke all on schema atlas_private from public,anon,authenticated;

create table if not exists atlas_private.objective_sync_sources (
  source_clinic text primary key check(source_clinic in ('Murcia','Barcelona')),
  token_hash text not null,
  active boolean not null default true,
  last_received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on atlas_private.objective_sync_sources from public,anon,authenticated;

create or replace function public.atlas_team_goals_receive_external_snapshot(
  p_sync_token text,p_source_clinic text,p_period date,p_generated_at timestamptz,
  p_revenue numeric,p_mbst_sessions numeric,p_bomba_sessions numeric,
  p_robot_traction_sessions numeric,p_brains_sessions numeric,
  p_revenue_target numeric,p_mbst_target numeric,p_bomba_target numeric,
  p_robot_traction_target numeric,p_brains_target numeric
) returns boolean
language plpgsql security definer
set search_path=public,atlas_private,extensions,pg_temp
as $$
declare
  v_source atlas_private.objective_sync_sources%rowtype;
  v_period date:=date_trunc('month',p_period)::date;
  v_comparison jsonb;
begin
  if p_sync_token is null or length(p_sync_token)<32 then raise exception 'Autenticación de sincronización no válida';end if;
  select * into v_source from atlas_private.objective_sync_sources where source_clinic=p_source_clinic and active=true;
  if not found or extensions.crypt(p_sync_token,v_source.token_hash)<>v_source.token_hash then raise exception 'Autenticación de sincronización no válida';end if;
  if p_source_clinic<>'Murcia' then raise exception 'Clínica externa no admitida';end if;
  if p_generated_at is null or p_generated_at>now()+interval '5 minutes' or p_generated_at<now()-interval '2 hours' then raise exception 'Fecha de generación no válida';end if;
  if v_period<>date_trunc('month',timezone('Europe/Madrid',now()))::date then raise exception 'Solo se admite el mes actual';end if;
  if greatest(abs(coalesce(p_revenue,0)),abs(coalesce(p_mbst_sessions,0)),abs(coalesce(p_bomba_sessions,0)),abs(coalesce(p_robot_traction_sessions,0)),abs(coalesce(p_brains_sessions,0)),abs(coalesce(p_revenue_target,0)),abs(coalesce(p_mbst_target,0)),abs(coalesce(p_bomba_target,0)),abs(coalesce(p_robot_traction_target,0)),abs(coalesce(p_brains_target,0)))>100000000 then raise exception 'Totales fuera de rango';end if;

  v_comparison:=jsonb_build_object(
    'period',to_char(v_period,'YYYY-MM'),'generated_at',p_generated_at,'source','atlas-murcia',
    'clinics',jsonb_build_object('murcia',jsonb_build_object('metrics',jsonb_build_object(
      'team_net_invoicing',jsonb_build_object('actual',p_revenue,'target',p_revenue_target,'percentage',case when p_revenue_target>0 then round(p_revenue/p_revenue_target*100,1) end,'active',p_revenue_target>0),
      'team_traction_paid_sessions',jsonb_build_object('actual',p_robot_traction_sessions,'target',p_robot_traction_target,'percentage',case when p_robot_traction_target>0 then round(p_robot_traction_sessions/p_robot_traction_target*100,1) end,'active',p_robot_traction_target>0,'source_label','Robot'),
      'team_mbst_paid_sessions',jsonb_build_object('actual',p_mbst_sessions,'target',p_mbst_target,'percentage',case when p_mbst_target>0 then round(p_mbst_sessions/p_mbst_target*100,1) end,'active',p_mbst_target>0),
      'team_bomba_paid_sessions',jsonb_build_object('actual',p_bomba_sessions,'target',p_bomba_target,'percentage',case when p_bomba_target>0 then round(p_bomba_sessions/p_bomba_target*100,1) end,'active',p_bomba_target>0),
      'team_brains_paid_sessions',jsonb_build_object('actual',p_brains_sessions,'target',p_brains_target,'percentage',case when p_brains_target>0 then round(p_brains_sessions/p_brains_target*100,1) end,'active',p_brains_target>0)
    )))
  );

  update public.clinic_settings s
  set payload=jsonb_set(coalesce(s.payload,'{}'::jsonb),'{team_goals_murcia_comparison}',v_comparison,true),updated_at=now()
  from public.clinics c
  where s.clinic_id=c.id and s.organization_id=c.organization_id and s.section='other' and lower(c.name) like '%alicante%';
  if not found then raise exception 'No se encontró la configuración de Alicante';end if;
  update atlas_private.objective_sync_sources set last_received_at=now(),updated_at=now() where source_clinic=p_source_clinic;
  return true;
end
$$;

revoke all on function public.atlas_team_goals_receive_external_snapshot(text,text,date,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) from public,authenticated;
grant execute on function public.atlas_team_goals_receive_external_snapshot(text,text,date,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) to anon;

