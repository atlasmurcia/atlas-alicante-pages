-- Verified server guards, reproduced only for isolated synthetic PostgreSQL tests.
-- Clinic and organization IDs below are synthetic; no patient records are included.
CREATE OR REPLACE FUNCTION public.atlas_alicante_reject_holiday_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  agenda jsonb;
  holiday_date date;
  holiday_name text;
BEGIN
  IF NEW.organization_id IS DISTINCT FROM '10000000-0000-0000-0000-000000000001'::uuid
     OR NEW.clinic_id IS DISTINCT FROM '20000000-0000-0000-0000-000000000001'::uuid THEN
    RETURN NEW;
  END IF;
  IF NEW.deleted_at IS NOT NULL OR NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at
       AND NEW.ends_at IS NOT DISTINCT FROM OLD.ends_at
       AND NEW.clinic_id IS NOT DISTINCT FROM OLD.clinic_id
       AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
       AND OLD.deleted_at IS NULL AND OLD.status <> 'cancelled' THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.starts_at IS NULL OR NEW.ends_at IS NULL OR NEW.ends_at <= NEW.starts_at THEN RETURN NEW; END IF;
  SELECT s.payload INTO agenda FROM public.clinic_settings s
    WHERE s.organization_id = NEW.organization_id AND s.clinic_id = NEW.clinic_id AND s.section = 'agenda';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'No se pudo comprobar el calendario de cierres de FisioSport Alicante.';
  END IF;
  SELECT (h.value->>'date')::date, coalesce(nullif(h.value->>'name',''),'Festivo')
    INTO holiday_date, holiday_name
    FROM jsonb_array_elements(coalesce(agenda->'holidays','[]'::jsonb)) h(value)
    WHERE h.value->>'date' ~ '^2027-[0-9]{2}-[0-9]{2}$'
      AND NEW.starts_at < (((h.value->>'date')::date + 1)::timestamp AT TIME ZONE 'Europe/Madrid')
      AND NEW.ends_at > ((h.value->>'date')::date::timestamp AT TIME ZONE 'Europe/Madrid')
    ORDER BY h.value->>'date' LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = format('Festivo / Clínica cerrada: FisioSport Alicante permanece cerrada el %s (%s). No se permiten reservas ni asignaciones de citas.',to_char(holiday_date,'DD/MM/YYYY'),holiday_name);
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.atlas_apply_fixed_resource_reservation_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  service_name text;
  professional_minutes integer;
  total_minutes integer;
  equipment_name text;
  reservation_label text;
begin
  if new.clinic_id <> '20000000-0000-0000-0000-000000000001'::uuid
     or new.deleted_at is not null
     or new.status='cancelled'
     or jsonb_typeof(coalesce(new.services,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(new.services,'[]'::jsonb)) <> 1 then
    return new;
  end if;

  select lower(trim(value)) into service_name
  from jsonb_array_elements_text(new.services)
  limit 1;

  if service_name in ('tracción','traccion') then
    professional_minutes:=5; total_minutes:=30; equipment_name:='Traccion'; reservation_label:='Poner tracción';
  elsif service_name='camilla fd' then
    professional_minutes:=15; total_minutes:=15; equipment_name:='Traccion'; reservation_label:='Camilla';
  elsif service_name like '%bomba%'
    and (service_name like '%dinámica%' or service_name like '%dinamica%') then
    professional_minutes:=15; total_minutes:=45; equipment_name:='Bomba Diamagnética'; reservation_label:='Poner bomba';
  else
    return new;
  end if;

  if jsonb_array_length(coalesce(new.professionals,'[]'::jsonb))=0 then
    raise exception using errcode='23514', message='Esta sesión requiere un profesional asignado.';
  end if;

  new.ends_at:=new.starts_at+make_interval(mins=>total_minutes);
  new.resources:=(
    select coalesce(jsonb_agg(value order by value),'[]'::jsonb)
    from (
      select distinct value
      from jsonb_array_elements_text(coalesce(new.resources,'[]'::jsonb)||jsonb_build_array(equipment_name))
    ) deduplicated
  );
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'professional_minutes',professional_minutes,
    'reservation_label',reservation_label,
    'reservation_rule_version','alicante-v227'
  );
  return new;
end;
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.atlas_guard_cancellation_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare request jsonb; unresolved boolean;
begin
  request := old.metadata->'cancellationRequest';
  if tg_op = 'DELETE' then
    if request->>'status' = 'pending' then raise exception 'Tramita la cancelación antes de eliminar la cita'; end if;
    return old;
  end if;
  if request->>'status' = 'pending' then
    if new.deleted_at is not null then
      raise exception 'Tramita la cancelación antes de eliminar la cita';
    end if;
    if new.status = 'cancelled' then
      if auth.uid() is null then raise exception 'La cancelación pendiente requiere gestión de recepción'; end if;
      request := request || jsonb_build_object('status', 'resolved', 'resolvedAt', now(), 'resolvedBy', auth.uid());
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('cancellationRequest', request);
    else
      if new.status not in ('pending', 'confirmed') then raise exception 'La cita está pendiente de cancelación'; end if;
      if new.status = 'confirmed'
         or (new.metadata->>'appointmentConfirmationStatus' = 'confirmed' and old.metadata->>'appointmentConfirmationStatus' is distinct from 'confirmed')
         or (new.metadata->>'whatsappConfirmationStatus' = 'confirmed' and old.metadata->>'whatsappConfirmationStatus' is distinct from 'confirmed') then
        raise exception 'Recepción debe gestionar la cancelación antes de confirmar';
      end if;
      -- Preserve the request even if a stale browser save omitted it.
      if jsonb_typeof(new.metadata->'cancellationRequest'->'inboundMessageIds') = 'array' then
        request := request || jsonb_build_object('inboundMessageIds',
          (select jsonb_agg(distinct value) from jsonb_array_elements(
            coalesce(request->'inboundMessageIds','[]'::jsonb) || (new.metadata->'cancellationRequest'->'inboundMessageIds'))));
      end if;
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('cancellationRequest', request);
    end if;
  end if;
  if new.metadata->'cancellationRequest'->>'status' = 'pending' then
    new.status := 'pending';
    new.metadata := (coalesce(new.metadata, '{}'::jsonb)
      - 'appointmentConfirmationAt' - 'whatsappConfirmationAt' - 'appointmentConfirmationByName')
      || jsonb_build_object('status', 'Pendiente', 'appointmentConfirmationStatus', 'not_confirmed', 'whatsappConfirmationStatus', 'not_confirmed');
  end if;
  -- An unidentified request protects the patient's appointments until reception identifies it.
  if new.status <> 'cancelled' and (new.status = 'confirmed' or new.metadata->>'appointmentConfirmationStatus' = 'confirmed' or new.metadata->>'whatsappConfirmationStatus' = 'confirmed') then
    select exists(select 1 from public.atlas_internal_tasks t
      where t.organization_id = new.organization_id and t.clinic_id = new.clinic_id
      and t.patient_id = new.patient_id and t.source_label like 'whatsapp-cancellation-review:%'
      and t.status in ('pending','in_progress','snoozed')) into unresolved;
    if unresolved then raise exception 'Hay una solicitud de cancelación pendiente de identificar en recepción'; end if;
  end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.atlas_guard_cancellation_task()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare appointment public.appointments%rowtype; linked_id uuid;
begin
  if old.source_label = 'whatsapp-cancellation-pending' or old.source_label like 'whatsapp-cancellation-review:%' then
    if old.status in ('pending','in_progress','snoozed') then
      if tg_op = 'DELETE' then raise exception 'La solicitud de cancelación debe conservarse hasta su gestión'; end if;
      if new.source_label is distinct from old.source_label or new.clinic_id is distinct from old.clinic_id
        or new.organization_id is distinct from old.organization_id or new.patient_id is distinct from old.patient_id then
        raise exception 'No se puede desvincular una solicitud de cancelación pendiente';
      end if;
      if new.area <> 'recepcion' or to_jsonb(new)->>'deleted_at' is not null then
        raise exception 'La solicitud pendiente debe permanecer visible en recepción';
      end if;
      if old.source_appointment_id is not null and new.source_appointment_id is distinct from old.source_appointment_id then
        raise exception 'No se puede sustituir la cita de una solicitud de cancelación';
      end if;
      if new.status not in ('pending','in_progress','snoozed') then
        if auth.uid() is null then raise exception 'Solo recepción puede completar la gestión'; end if;
        linked_id := coalesce(old.source_appointment_id, new.source_appointment_id);
        select * into appointment from public.appointments a where a.id = linked_id
          and a.organization_id = old.organization_id and a.clinic_id = old.clinic_id
          and (old.patient_id is null or a.patient_id = old.patient_id) for update;
        if not found or appointment.status <> 'cancelled' or appointment.deleted_at is not null then
          raise exception 'Identifica y cancela la cita antes de cerrar la tarea';
        end if;
        if new.status <> 'completed' then raise exception 'Registra la gestión como completada'; end if;
        new.completed_at := now();
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.atlas_guard_mbst_day()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare local_day date; active_count int; previous_end timestamptz; next_start timestamptz;
begin
  if new.deleted_at is not null or new.status in ('cancelled','no_show')
     or coalesce(new.services::text,'') not ilike '%mbst%' then return new; end if;
  if tg_op='UPDATE' and old.patient_id=new.patient_id and old.starts_at=new.starts_at
     and old.ends_at=new.ends_at and old.services=new.services
     and old.status not in ('cancelled','no_show') and old.deleted_at is null then return new; end if;
  local_day := (new.starts_at at time zone 'Europe/Madrid')::date;
  perform pg_advisory_xact_lock(hashtextextended('atlas-mbst:'||new.patient_id::text||':'||local_day::text,0));
  select count(*),max(ends_at),min(starts_at) into active_count,previous_end,next_start
    from public.appointments
    where patient_id=new.patient_id and clinic_id=new.clinic_id and id is distinct from new.id
      and (starts_at at time zone 'Europe/Madrid')::date=local_day
      and status not in ('cancelled','no_show') and deleted_at is null
      and services::text ilike '%mbst%';
  if active_count>=2 then
    raise exception 'Este paciente ya tiene dos MBST el %. No se puede añadir otra.',local_day;
  end if;
  if active_count>0 and nullif(new.metadata->>'planId','') is not null
     and (new.starts_at>previous_end+interval '15 minutes'
          or next_start>new.ends_at+interval '15 minutes') then
    raise exception 'Las MBST automáticas del mismo día deben quedar en una sola visita, sin separar mañana y tarde.';
  end if;
  return new;
end;$function$
;

CREATE OR REPLACE FUNCTION public.atlas_keep_completed_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if old.status='completed' and new.status in ('pending','confirmed','arrived','no_show')
 and not (
  coalesce(new.metadata#>>'{attendance,status}','')='pending'
  and coalesce(new.metadata#>>'{attendance,correctionReason}','')<>''
  and coalesce(new.metadata#>>'{attendance,correctedAt}','')>greatest(coalesce(old.metadata#>>'{attendance,completedAt}',''),coalesce(old.metadata#>>'{attendance,correctedAt}',''))
 ) then
  new.status:='completed';
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object('status','Realizada','planConflict',false,'attendance',coalesce(old.metadata->'attendance','{}'::jsonb));
 end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.atlas_normalize_internal_task_title()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.title := left(btrim(coalesce(new.title, '')), 180);
  return new;
end;
$function$
;

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
CREATE TRIGGER appointments_00_keep_completed BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION atlas_keep_completed_status();
CREATE TRIGGER appointments_01_fixed_resource_rules BEFORE INSERT OR UPDATE OF clinic_id, starts_at, ends_at, status, services, resources, professionals, metadata, deleted_at ON public.appointments FOR EACH ROW EXECUTE FUNCTION atlas_apply_fixed_resource_reservation_rules();
CREATE TRIGGER appointments_guard_mbst_day BEFORE INSERT OR UPDATE OF patient_id, clinic_id, starts_at, ends_at, services, status, deleted_at ON public.appointments FOR EACH ROW EXECUTE FUNCTION atlas_guard_mbst_day();
CREATE TRIGGER atlas_alicante_holiday_booking_guard BEFORE INSERT OR UPDATE OF starts_at, ends_at, organization_id, clinic_id, status, deleted_at ON public.appointments FOR EACH ROW WHEN (((new.organization_id = '10000000-0000-0000-0000-000000000001'::uuid) AND (new.clinic_id = '20000000-0000-0000-0000-000000000001'::uuid))) EXECUTE FUNCTION atlas_alicante_reject_holiday_booking();
CREATE TRIGGER atlas_cancellation_guard BEFORE DELETE OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION atlas_guard_cancellation_request();
CREATE TRIGGER atlas_cancellation_task_guard BEFORE DELETE OR UPDATE ON public.atlas_internal_tasks FOR EACH ROW EXECUTE FUNCTION atlas_guard_cancellation_task();
CREATE TRIGGER atlas_normalize_internal_task_title BEFORE INSERT OR UPDATE OF title ON public.atlas_internal_tasks FOR EACH ROW EXECUTE FUNCTION atlas_normalize_internal_task_title();
