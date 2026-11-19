-- Pre-existing conflict functions, copied solely for isolated synthetic tests. No clinical records.
CREATE OR REPLACE FUNCTION public.atlas_professional_minutes(p_services jsonb, p_metadata jsonb, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with names as (
    select lower(translate(btrim(regexp_replace(value,'\s+',' ','g')),'áéíóúüÁÉÍÓÚÜñÑ','aeiouuAEIOUUnN')) as n, ord
    from jsonb_array_elements_text(case when jsonb_typeof(p_services)='array' then p_services else '[]'::jsonb end) with ordinality s(value,ord)
  ), info as (
    select
      coalesce((select n from names order by ord limit 1),
               lower(translate(btrim(coalesce(p_metadata->>'therapy','')),'áéíóúüÁÉÍÓÚÜñÑ','aeiouuAEIOUUnN'))) as therapy,
      greatest(0, round(extract(epoch from (p_ends_at - p_starts_at))/60))::integer as duration
  )
  select least(info.duration, case
    -- 1. La agenda envía el valor calculado: es la fuente de verdad.
    when coalesce(p_metadata->>'professional_minutes','') ~ '^\d+(\.\d+)?$'
      then round((p_metadata->>'professional_minutes')::numeric)::integer
    -- 2. Avisos, llamadas y seguimientos no ocupan al profesional.
    when exists (select 1 from names where n in ('aviso','avisos') or n like 'llamada %' or n like 'seguimiento %') then 0
    -- 3. Neuromodulación + Osteopatía en la misma cita: 45 minutos.
    when exists (select 1 from names where n like '%neuromodulacion%') and exists (select 1 from names where n like '%osteopatia%') then 45
    -- 4. Bomba dinámica: 15 minutos; bomba estática: no ocupa.
    when exists (select 1 from names where n like '%bomba%' and n like '%dinamica%') then 15
    when exists (select 1 from names where n like '%bomba%' and n like '%estatica%') then 0
    -- 5. Terapias sin profesional.
    when info.therapy like 'mbst%' or info.therapy in ('magnetophysio','magneto','sis','vacu') then 0
    -- 6. Tiempo de profesional configurado en la agenda (therapyProfessionalDurations).
    when info.therapy in ('robot','physicalm','physicalm dinamico','physicalm estatico','brains','imoove','bomba','bomba diamagnetica','onda de choque','onda','camilla') then 15
    when info.therapy in ('traccion','camilla fd','camilla flexion-distraccion','camilla fd club de afiliados') then 0
    when info.therapy in ('fisioterapia') then 30
    when info.therapy in ('dpa','neuromodulacion','osteopatia','readaptacion') then 45
    -- 7. En el resto, toda la cita.
    else info.duration
  end)
  from info
$function$;
CREATE OR REPLACE FUNCTION public.atlas_resource_capacity(p_resource text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case p_resource when 'MBST OSTEOSPIN' then 2 else 1 end;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_appointment_professional_minutes(p_services jsonb, p_metadata jsonb, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  total_minutes integer := greatest(0, floor(extract(epoch from (p_ends_at - p_starts_at)) / 60)::integer);
  stored_minutes text := coalesce(p_metadata->>'professional_minutes', '');
  service_name text;
  service_minutes integer;
  required_minutes integer := 0;
begin
  if exists (
    select 1 from jsonb_array_elements_text(coalesce(p_services,'[]'::jsonb)) value
    where lower(trim(value)) in ('tracción','traccion')
  ) then return least(total_minutes,5);
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(coalesce(p_services,'[]'::jsonb)) value
    where lower(trim(value))='camilla fd'
  ) then return least(total_minutes,15);
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(coalesce(p_services,'[]'::jsonb)) value
    where lower(trim(value)) like '%bomba%'
      and (lower(trim(value)) like '%dinámica%' or lower(trim(value)) like '%dinamica%')
  ) then return least(total_minutes,15);
  end if;

  if stored_minutes ~ '^\d+(\.\d+)?$' then
    return greatest(0, least(total_minutes, floor(stored_minutes::numeric)::integer));
  end if;
  if jsonb_typeof(coalesce(p_services, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_services, '[]'::jsonb)) = 0 then
    return total_minutes;
  end if;
  for service_name in
    select lower(trim(value)) from jsonb_array_elements_text(coalesce(p_services, '[]'::jsonb))
  loop
    service_minutes := case
      when service_name in ('aviso', 'avisos')
        or service_name like 'llamada %'
        or service_name like 'seguimiento %' then 0
      when service_name like '%bomba%'
        and (service_name like '%estática%' or service_name like '%estatica%') then 0
      when service_name in ('magnetophysio', 'sis', 'vacu', 'magneto')
        or service_name like 'mbst %' then 0
      when service_name in ('brains', 'robot', 'physicalm', 'imoove', 'onda', 'onda de choque') then 15
      when service_name = 'fisioterapia' then 30
      when service_name in ('dpa', 'neuromodulación', 'neuromodulacion', 'osteopatía', 'osteopatia', 'readaptación', 'readaptacion') then 45
      else total_minutes
    end;
    required_minutes := greatest(required_minutes, least(total_minutes, service_minutes));
  end loop;
  return required_minutes;
end;
$function$;
CREATE OR REPLACE FUNCTION public.atlas_prevent_appointment_conflicts()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  conflict_kind text;
  new_professional_minutes integer;
begin
  if tg_op='UPDATE' and old.deleted_at is null and old.status<>'cancelled'
     and row(new.organization_id,new.clinic_id,new.patient_id,new.starts_at,new.ends_at,new.resources,new.professionals,new.forced,new.metadata->>'professional_minutes')
         is not distinct from row(old.organization_id,old.clinic_id,old.patient_id,old.starts_at,old.ends_at,old.resources,old.professionals,old.forced,old.metadata->>'professional_minutes')
  then return new; end if;
  if new.deleted_at is not null or new.status = 'cancelled' then return new; end if;
  if new.ends_at <= new.starts_at then
    raise exception using errcode='22007', message='La hora de fin debe ser posterior a la hora de inicio.';
  end if;

  if current_setting('atlas.migration_mode', true) = 'on'
     and coalesce(new.metadata->>'migration_source','') = 'koibox'
     and coalesce(new.metadata->>'migration_run_id','') <> '' then
    return new;
  end if;

  new_professional_minutes := public.atlas_appointment_professional_minutes(new.services, new.metadata, new.starts_at, new.ends_at);
  perform pg_advisory_xact_lock(hashtextextended(new.clinic_id::text, 0));

  select case
    when a.patient_id = new.patient_id then 'patient'
    when exists (
      select 1
      from jsonb_array_elements_text(coalesce(new.resources,'[]'::jsonb)) nr
      join jsonb_array_elements_text(coalesce(a.resources,'[]'::jsonb)) ar on ar.value=nr.value
      where not (coalesce(new.professionals,'[]'::jsonb) ? nr.value)
        and not (coalesce(a.professionals,'[]'::jsonb) ? ar.value)
    ) then 'resource'
    else 'professional'
  end into conflict_kind
  from public.appointments a
  where a.clinic_id = new.clinic_id
    and a.id <> new.id
    and a.deleted_at is null
    and a.status <> 'cancelled'
    and not coalesce(new.forced,false)
    and (
      (a.patient_id = new.patient_id and a.starts_at < new.ends_at and new.starts_at < a.ends_at)
      or (
        a.starts_at < new.ends_at and new.starts_at < a.ends_at
        and exists (
          select 1
          from jsonb_array_elements_text(coalesce(new.resources,'[]'::jsonb)) nr
          join jsonb_array_elements_text(coalesce(a.resources,'[]'::jsonb)) ar on ar.value=nr.value
          where not (coalesce(new.professionals,'[]'::jsonb) ? nr.value)
            and not (coalesce(a.professionals,'[]'::jsonb) ? ar.value)
        )
      )
      or (
        new_professional_minutes > 0
        and public.atlas_appointment_professional_minutes(a.services, a.metadata, a.starts_at, a.ends_at) > 0
        and a.starts_at < new.starts_at + make_interval(mins => new_professional_minutes)
        and new.starts_at < a.starts_at + make_interval(mins => public.atlas_appointment_professional_minutes(a.services, a.metadata, a.starts_at, a.ends_at))
        and exists (
          select 1
          from jsonb_array_elements_text(coalesce(new.professionals,'[]'::jsonb)) np
          join jsonb_array_elements_text(coalesce(a.professionals,'[]'::jsonb)) ap on ap.value=np.value
        )
      )
    )
  limit 1;

  if conflict_kind is not null then
    raise exception using errcode='23P01',
      message=case conflict_kind
        when 'patient' then 'El paciente ya tiene otra cita en ese horario.'
        when 'resource' then 'Uno de los equipos o recursos ya está reservado.'
        else 'Uno de los profesionales ya está ocupado.'
      end;
  end if;
  return new;
end;
$function$
;
CREATE TRIGGER appointments_prevent_conflicts BEFORE INSERT OR UPDATE OF clinic_id, patient_id, starts_at, ends_at, status, resources, professionals, forced, deleted_at ON public.appointments FOR EACH ROW EXECUTE FUNCTION atlas_prevent_appointment_conflicts();
