-- Campaign attribution for the Alicante v235 funnel.
-- Additive only: no historical patient or accounting rows are rewritten.

alter table public.appointments
  add column if not exists lead_id uuid references public.leads(id),
  add column if not exists lead_attribution_method text;

alter table public.budgets
  add column if not exists lead_id uuid references public.leads(id),
  add column if not exists lead_attribution_method text,
  add column if not exists presented_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='appointments_lead_attribution_method_check' and conrelid='public.appointments'::regclass) then
    alter table public.appointments add constraint appointments_lead_attribution_method_check
      check (lead_attribution_method is null or lead_attribution_method in ('direct','unique_patient'));
  end if;
  if not exists (select 1 from pg_constraint where conname='budgets_lead_attribution_method_check' and conrelid='public.budgets'::regclass) then
    alter table public.budgets add constraint budgets_lead_attribution_method_check
      check (lead_attribution_method is null or lead_attribution_method in ('direct','unique_patient'));
  end if;
end;
$$;

create index if not exists appointments_clinic_lead_starts_idx
  on public.appointments (clinic_id, lead_id, starts_at) where lead_id is not null and deleted_at is null;
create index if not exists budgets_clinic_lead_created_idx
  on public.budgets (clinic_id, lead_id, created_at) where lead_id is not null and deleted_at is null;
create index if not exists leads_clinic_patient_active_idx
  on public.leads (clinic_id, patient_id) where patient_id is not null and deleted_at is null and status <> 'duplicate';

create or replace function public.atlas_validate_lead_attribution()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lead public.leads%rowtype;
  v_metadata_lead text;
  v_old_status text;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'budgets' then
    v_old_status := old.status;
  end if;
  v_metadata_lead := coalesce(
    nullif(new.metadata->>'lead_id',''),
    nullif(new.metadata->'leadContext'->>'id',''),
    nullif(new.metadata->'leadContext'->>'lead_id','')
  );
  if new.lead_id is null and v_metadata_lead ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    new.lead_id := v_metadata_lead::uuid;
  end if;

  if new.lead_id is not null then
    select * into v_lead from public.leads where id = new.lead_id;
    if not found or v_lead.organization_id is distinct from new.organization_id or v_lead.clinic_id is distinct from new.clinic_id then
      raise exception 'El lead vinculado no pertenece a esta clínica.' using errcode='23514';
    end if;
    if v_lead.patient_id is not null and v_lead.patient_id is distinct from new.patient_id then
      raise exception 'El lead vinculado no corresponde a esta ficha.' using errcode='23514';
    end if;
    if tg_table_name = 'budgets' and v_lead.patient_id is distinct from new.patient_id then
      raise exception 'El presupuesto solo puede vincularse al paciente del lead.' using errcode='23514';
    end if;
    new.lead_attribution_method := case
      when new.lead_attribution_method = 'unique_patient' then 'unique_patient'
      else 'direct'
    end;
    new.metadata := coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'lead_id',new.lead_id::text,
      'lead_attribution_method',new.lead_attribution_method
    );
  end if;

  if tg_table_name = 'budgets' then
    if tg_op = 'UPDATE' and old.presented_at is not null then
      new.presented_at := old.presented_at;
    elsif new.status in ('delivered','accepted') and (tg_op = 'INSERT' or v_old_status not in ('delivered','accepted')) then
      new.presented_at := coalesce(new.presented_at,new.accepted_at,now());
    elsif tg_op = 'UPDATE' then
      new.presented_at := coalesce(new.presented_at,old.presented_at);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.atlas_validate_lead_attribution() from public, anon, authenticated;

drop trigger if exists appointments_validate_lead_attribution on public.appointments;
create trigger appointments_validate_lead_attribution
before insert or update of lead_id,metadata,patient_id,organization_id,clinic_id on public.appointments
for each row execute function public.atlas_validate_lead_attribution();

drop trigger if exists budgets_validate_lead_attribution on public.budgets;
create trigger budgets_validate_lead_attribution
before insert or update of lead_id,metadata,patient_id,organization_id,clinic_id,status,accepted_at,presented_at on public.budgets
for each row execute function public.atlas_validate_lead_attribution();

create or replace function public.atlas_marketing_funnel_v235(
  p_clinic uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_org uuid;
  v_result jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic;
  if v_org is null or not coalesce((
    public.has_clinic_permission(v_org,p_clinic,'payments_read')
    and public.has_clinic_permission(v_org,p_clinic,'patients_read')
  ),false) then
    raise exception 'Sin permiso para ver el embudo de campañas' using errcode='42501';
  end if;

  with
  base_leads as (
    select l.id, l.organization_id, l.clinic_id, l.patient_id,
      l.created_at as lead_at,
      coalesce(nullif(l.metadata->>'campaign_id',''),nullif(l.metadata->>'utm_campaign_id',''),
        'origen:' || coalesce(nullif(l.metadata->>'campaign_name',''),nullif(l.metadata->>'utm_campaign',''),
          nullif(l.metadata->>'campaign',''),nullif(l.metadata->>'form_name',''),nullif(l.source_detail,''),nullif(l.source,''),'desconocido')) as campaign_key,
      coalesce(nullif(l.metadata->>'campaign_name',''),nullif(l.metadata->>'utm_campaign',''),
        nullif(l.metadata->>'campaign',''),nullif(l.metadata->>'form_name',''),nullif(l.source_detail,''),nullif(l.source,''),'(sin campaña)') as campaign_name
    from public.leads l
    where l.organization_id=v_org and l.clinic_id=p_clinic and l.deleted_at is null
      and l.status <> 'duplicate' and coalesce(l.metadata->>'archived_as_test','false') <> 'true'
  ),
  selected_leads as (
    select * from base_leads
      where (p_from is null or lead_at >= (p_from::timestamp at time zone 'Europe/Madrid'))
      and (p_to is null or lead_at < ((p_to + 1)::timestamp at time zone 'Europe/Madrid'))
  ),
  patient_lead_counts as (
    select patient_id,count(*) as lead_count
    from base_leads where patient_id is not null group by patient_id
  ),
  service_catalog as (
    select
      upper(regexp_replace(translate(coalesce(s->>'name',s->>'service_name',''),'ÁÉÍÓÚÜÑáéíóúüñºª','AEIOUUNaeiouun'),'[^[:alnum:]]','','g')) as service_norm,
      upper(regexp_replace(translate(coalesce(s->>'category',s->>'category_name',''),'ÁÉÍÓÚÜÑáéíóúüñºª','AEIOUUNaeiouun'),'[^[:alnum:]]','','g')) as category_norm
    from public.clinic_settings cs
    cross join lateral jsonb_array_elements(case when jsonb_typeof(cs.payload->'services')='array' then cs.payload->'services' else '[]'::jsonb end) s
    where cs.organization_id=v_org and cs.clinic_id=p_clinic and cs.section='sales'
  ),
  appointment_flags as (
    select a.id,a.lead_id,a.patient_id,a.starts_at,a.status,a.organization_id,a.clinic_id,a.metadata,
      coalesce(a.lead_id,case
        when coalesce(a.metadata->>'lead_id',a.metadata->'leadContext'->>'id',a.metadata->'leadContext'->>'lead_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then coalesce(a.metadata->>'lead_id',a.metadata->'leadContext'->>'id',a.metadata->'leadContext'->>'lead_id')::uuid end) as linked_lead_id,
      (a.lead_id is not null or coalesce(nullif(a.metadata->>'lead_id',''),nullif(a.metadata->'leadContext'->>'id',''),nullif(a.metadata->'leadContext'->>'lead_id','')) is not null) as has_link_reference,
      bool_or(normalized.service_norm like '%VALORACION%' or normalized.category_norm like '%VALORACION%') as valuation,
      bool_or(normalized.service_norm like '1CONSULTA%' or normalized.service_norm like '%PRIMERACONSULTA%' or normalized.category_norm like '1CONSULTA%') as first_consult,
      bool_or(normalized.category_norm is not null and normalized.category_norm not like 'PRODUCTOSPRUEBASDIAGNOSTICAS%'
        and normalized.category_norm not like '%VALORACION%' and normalized.category_norm not like '1CONSULTA%'
        and normalized.service_norm not like '%AVISO%' and normalized.service_norm not like '%LLAMADA%'
        and normalized.service_norm not like '%TELEF%' and normalized.service_norm not like '%REUNION%'
        and normalized.service_norm not like '%RESERVA%') as treatment_service,
      bool_or(normalized.category_norm is null and normalized.service_norm not like '%VALORACION%' and normalized.service_norm not like '1CONSULTA%'
        and normalized.service_norm not like '%PRIMERACONSULTA%' and normalized.service_norm not like '%AVISO%'
        and normalized.service_norm not like '%LLAMADA%' and normalized.service_norm not like '%TELEF%'
        and normalized.service_norm not like '%REUNION%' and normalized.service_norm not like '%RESERVA%') as unclassified_service
    from public.appointments a
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(a.services)='array' then a.services else '[]'::jsonb end) service(value)
    left join lateral (
      select sc.service_norm,sc.category_norm from service_catalog sc
      where sc.service_norm=upper(regexp_replace(translate(service.value,'ÁÉÍÓÚÜÑáéíóúüñºª','AEIOUUNaeiouun'),'[^[:alnum:]]','','g'))
      order by sc.category_norm limit 1
    ) catalog on true
    cross join lateral (select
      upper(regexp_replace(translate(service.value,'ÁÉÍÓÚÜÑáéíóúüñºª','AEIOUUNaeiouun'),'[^[:alnum:]]','','g')) service_norm,
      catalog.category_norm
    ) normalized
    where a.organization_id=v_org and a.clinic_id=p_clinic and a.deleted_at is null and a.status='completed'
    group by a.id
  ),
  appointment_links as (
    select distinct on (a.id) a.id,a.starts_at,l.id as attributed_lead_id,
      a.valuation,a.first_consult,a.treatment_service,a.unclassified_service,
      case when direct_lead.id is not null then 'direct' else 'unique_patient' end as link_quality
    from appointment_flags a
    left join public.leads direct_lead on direct_lead.id=a.linked_lead_id
      and direct_lead.organization_id=v_org and direct_lead.clinic_id=p_clinic and direct_lead.deleted_at is null and direct_lead.status<>'duplicate'
      and (direct_lead.patient_id is null or direct_lead.patient_id=a.patient_id)
    join selected_leads l on (l.id=direct_lead.id or (not a.has_link_reference and direct_lead.id is null and a.patient_id=l.patient_id and l.patient_id is not null
          and exists(select 1 from patient_lead_counts pc where pc.patient_id=l.patient_id and pc.lead_count=1)))
      and a.starts_at>=l.lead_at
    order by a.id, case when direct_lead.id is not null then 0 else 1 end
  ),
  budget_events as (
    select b.id,b.lead_id,b.lead_attribution_method,b.patient_id,b.status,b.accepted_at,b.presented_at,b.created_at,b.metadata,
      coalesce(b.lead_id,case
        when coalesce(b.metadata->>'lead_id',b.metadata->'leadContext'->>'id',b.metadata->'leadContext'->>'lead_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then coalesce(b.metadata->>'lead_id',b.metadata->'leadContext'->>'id',b.metadata->'leadContext'->>'lead_id')::uuid end) as linked_lead_id,
      (b.lead_id is not null or coalesce(nullif(b.metadata->>'lead_id',''),nullif(b.metadata->'leadContext'->>'id',''),nullif(b.metadata->'leadContext'->>'lead_id','')) is not null) as has_link_reference,
      coalesce(b.presented_at,b.accepted_at,b.created_at) as presentation_date
    from public.budgets b
    where b.organization_id=v_org and b.clinic_id=p_clinic and b.deleted_at is null
      and b.status in ('delivered','accepted')
  ),
  budget_links as (
    select distinct on (b.id) b.id,b.status,b.accepted_at,b.presented_at,b.presentation_date,l.id as attributed_lead_id,
      case when direct_lead.id is not null then coalesce(b.lead_attribution_method,'direct') else 'unique_patient' end as link_quality
    from budget_events b
    left join public.leads direct_lead on direct_lead.id=b.linked_lead_id
      and direct_lead.organization_id=v_org and direct_lead.clinic_id=p_clinic and direct_lead.deleted_at is null and direct_lead.status<>'duplicate'
      and direct_lead.patient_id=b.patient_id
    join selected_leads l on (l.id=direct_lead.id or (not b.has_link_reference and direct_lead.id is null and b.patient_id=l.patient_id and l.patient_id is not null
          and exists(select 1 from patient_lead_counts pc where pc.patient_id=l.patient_id and pc.lead_count=1)))
      and b.presentation_date>=l.lead_at
    order by b.id, case when direct_lead.id is not null then 0 else 1 end
  ),
  appt_per_lead as (
    select al.attributed_lead_id,
      bool_or(al.valuation and al.link_quality='direct') as valuation_direct,
      bool_or(al.valuation and al.link_quality='unique_patient') as valuation_estimated,
      bool_or(al.first_consult and al.link_quality='direct') as consult_direct,
      bool_or(al.first_consult and al.link_quality='unique_patient') as consult_estimated,
      min(al.starts_at) filter(where al.first_consult) as first_consult_at,
      bool_or(al.unclassified_service) as has_unclassified_service
    from appointment_links al group by al.attributed_lead_id
  ),
  treatment_per_lead as (
    select al.attributed_lead_id,
      bool_or(al.treatment_service and al.starts_at>ap.first_consult_at and al.link_quality='direct') as treatment_direct,
      bool_or(al.treatment_service and al.starts_at>ap.first_consult_at and al.link_quality='unique_patient') as treatment_estimated
    from appointment_links al join appt_per_lead ap on ap.attributed_lead_id=al.attributed_lead_id
    where ap.first_consult_at is not null group by al.attributed_lead_id
  ),
  budget_per_lead as (
    select bl.attributed_lead_id,
      bool_or(bl.presentation_date is not null and bl.link_quality='direct' and bl.presented_at is not null) as presented_direct,
      bool_or(bl.presentation_date is not null and (bl.link_quality='unique_patient' or bl.presented_at is null)) as presented_estimated,
      bool_or(bl.status='accepted' and bl.link_quality='direct') as accepted_direct,
      bool_or(bl.status='accepted' and bl.link_quality='unique_patient') as accepted_estimated
    from budget_links bl group by bl.attributed_lead_id
  ),
  campaign_metrics as (
    select l.campaign_key,max(l.campaign_name) campaign_name,count(*) leads,
      count(*) filter(where coalesce(ap.valuation_direct,false)) valuation_confirmed,
      count(*) filter(where not coalesce(ap.valuation_direct,false) and coalesce(ap.valuation_estimated,false)) valuation_estimated,
      count(*) filter(where coalesce(ap.consult_direct,false)) first_consult_confirmed,
      count(*) filter(where not coalesce(ap.consult_direct,false) and coalesce(ap.consult_estimated,false)) first_consult_estimated,
      count(*) filter(where coalesce(tp.treatment_direct,false)) treatment_started_confirmed,
      count(*) filter(where not coalesce(tp.treatment_direct,false) and coalesce(tp.treatment_estimated,false)) treatment_started_estimated,
      count(*) filter(where coalesce(bp.presented_direct,false)) budget_presented_confirmed,
      count(*) filter(where not coalesce(bp.presented_direct,false) and coalesce(bp.presented_estimated,false)) budget_presented_estimated,
      count(*) filter(where coalesce(bp.accepted_direct,false)) budget_accepted_confirmed,
      count(*) filter(where not coalesce(bp.accepted_direct,false) and coalesce(bp.accepted_estimated,false)) budget_accepted_estimated,
      count(*) filter(where coalesce(ap.has_unclassified_service,false)) leads_with_unclassified_services
    from selected_leads l
    left join appt_per_lead ap on ap.attributed_lead_id=l.id
    left join treatment_per_lead tp on tp.attributed_lead_id=l.id
    left join budget_per_lead bp on bp.attributed_lead_id=l.id
    group by l.campaign_key
  ),
  unattributed as (
    select
      (select count(*) from selected_leads where patient_id is null) leads_without_patient_link,
      (select count(*) from appointment_flags a where a.patient_id is not null
        and not exists(select 1 from appointment_links x where x.id=a.id)
        and exists(select 1 from selected_leads l where l.patient_id=a.patient_id and a.starts_at>=l.lead_at)) appointments_ambiguous_or_unmatched,
      (select count(*) from budget_events b where b.patient_id is not null
        and not exists(select 1 from budget_links x where x.id=b.id)
        and exists(select 1 from selected_leads l where l.patient_id=b.patient_id and b.presentation_date>=l.lead_at)) budgets_ambiguous_or_unmatched
  )
  select jsonb_build_object(
    'generated_at',now(),'from',p_from,'to',p_to,
    'campaigns',coalesce((select jsonb_agg(to_jsonb(c) order by c.leads desc,c.campaign_name) from campaign_metrics c),'[]'::jsonb),
    'unattributed',(select to_jsonb(u) from unattributed u)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.atlas_marketing_funnel_v235(uuid,date,date) from public, anon;
grant execute on function public.atlas_marketing_funnel_v235(uuid,date,date) to authenticated;

