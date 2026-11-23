-- Review and test in an isolated backend before applying. No existing leads are merged by this script.
create or replace function public.atlas_merge_leads(
  p_clinic_id uuid, p_primary_id uuid, p_duplicate_id uuid,
  p_primary_version timestamptz, p_duplicate_version timestamptz,
  p_fields jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
  a public.leads%rowtype; b public.leads%rowtype; result public.leads%rowtype;
  actor uuid := auth.uid(); stamp timestamptz := clock_timestamp(); meta jsonb;
  combined_history jsonb; snapshots jsonb; task_count integer;
begin
  if actor is null or p_primary_id=p_duplicate_id or p_primary_version is null or p_duplicate_version is null then
    raise exception 'Selecciona dos fichas distintas y actualiza sus datos.';
  end if;
  -- Stable lock order makes simultaneous merges serialize without partial changes.
  perform id from public.leads where id in (p_primary_id,p_duplicate_id) and clinic_id=p_clinic_id order by id for update;
  select * into a from public.leads where id=p_primary_id and clinic_id=p_clinic_id;
  select * into b from public.leads where id=p_duplicate_id and clinic_id=p_clinic_id;
  if a.id is null or b.id is null or a.organization_id<>b.organization_id
    or not public.has_clinic_permission(a.organization_id,p_clinic_id,'patients_write') then
    raise exception 'No tienes acceso a ambas fichas de esta clínica.';
  end if;
  if b.deleted_at is not null and b.metadata->>'merged_into'=a.id::text and a.deleted_at is null then
    return jsonb_build_object('lead',to_jsonb(a),'alreadyMerged',true);
  end if;
  if a.deleted_at is not null or b.deleted_at is not null or a.updated_at<>p_primary_version or b.updated_at<>p_duplicate_version then
    raise exception 'Alguien ha cambiado una ficha. Actualiza y vuelve a comparar.';
  end if;
  if a.patient_id is not null and b.patient_id is not null and a.patient_id<>b.patient_id then
    raise exception 'Las fichas están vinculadas a pacientes distintos. Revisa la identidad antes de fusionar.';
  end if;
  if a.metadata->>'workflow'='appointment_cancellation_rebook' or b.metadata->>'workflow'='appointment_cancellation_rebook' then
    raise exception 'Los circuitos de cancelación se gestionan por separado.';
  end if;
  if coalesce(jsonb_typeof(p_fields),'null')<>'object' or exists(select 1 from jsonb_object_keys(p_fields) k where k not in ('first_name','last_name','phone','email','notes','assigned_name','source_detail')) then
    raise exception 'Campos de fusión no válidos.';
  end if;
  select count(*) into task_count from public.atlas_internal_tasks where lead_id=b.id and clinic_id=p_clinic_id and organization_id=a.organization_id;
  if task_count>0 and not public.has_clinic_permission(a.organization_id,p_clinic_id,'agenda_write') then
    raise exception 'Necesitas permiso para trasladar las tareas pendientes.';
  end if;
  -- Preserve original values, campaigns, follow-up, consents and earlier merge snapshots.
  snapshots=jsonb_build_array(to_jsonb(a),to_jsonb(b));
  select coalesce(jsonb_agg(item order by item->>'at'),'[]'::jsonb) into combined_history
    from (select distinct item from jsonb_array_elements(
      coalesce(a.metadata#>'{follow_up,history}','[]'::jsonb)||coalesce(b.metadata#>'{follow_up,history}','[]'::jsonb)) item) h;
  meta=a.metadata||jsonb_build_object('merge_history',coalesce(a.metadata->'merge_history','[]'::jsonb)||
    jsonb_build_array(jsonb_build_object('at',stamp,'actor',actor,'source_id',b.id,'snapshots',snapshots)),
    'no_contact',coalesce((a.metadata->>'no_contact')::boolean,false) or coalesce((b.metadata->>'no_contact')::boolean,false)
      or coalesce(a.metadata#>>'{follow_up,step}'='do_not_contact',false) or coalesce(b.metadata#>>'{follow_up,step}'='do_not_contact',false));
  meta=jsonb_set(meta,'{follow_up}',coalesce(a.metadata->'follow_up','{}'::jsonb)||jsonb_build_object('history',combined_history));
  if coalesce((meta->>'no_contact')::boolean,false) then
    meta=jsonb_set(meta,'{follow_up,step}','"do_not_contact"'); meta=meta-'funnel_stage';
  end if;
  update public.leads set
    first_name=case when p_fields?'first_name' then nullif(btrim(p_fields->>'first_name'),'') else a.first_name end,
    last_name=case when p_fields?'last_name' then nullif(btrim(p_fields->>'last_name'),'') else coalesce(a.last_name,b.last_name) end,
    phone=case when p_fields?'phone' then nullif(btrim(p_fields->>'phone'),'') else coalesce(a.phone,b.phone) end,
    email=case when p_fields?'email' then nullif(btrim(p_fields->>'email'),'') else coalesce(a.email,b.email) end,
    assigned_name=case when p_fields?'assigned_name' then nullif(btrim(p_fields->>'assigned_name'),'') else coalesce(a.assigned_name,b.assigned_name) end,
    source_detail=case when p_fields?'source_detail' then nullif(btrim(p_fields->>'source_detail'),'') else coalesce(a.source_detail,b.source_detail) end,
    notes=case when p_fields?'notes' then nullif(btrim(p_fields->>'notes'),'') when a.notes is not distinct from b.notes then a.notes else concat_ws(E'\n\n',a.notes,b.notes) end,
    patient_id=coalesce(a.patient_id,b.patient_id), metadata=meta,
    marketing_consent=a.marketing_consent and b.marketing_consent,
    marketing_consent_at=case when a.marketing_consent and b.marketing_consent then a.marketing_consent_at else null end,
    last_contact_at=greatest(a.last_contact_at,b.last_contact_at),
    next_action_at=case when coalesce((meta->>'no_contact')::boolean,false) then null else a.next_action_at end,
    updated_by=actor,updated_at=stamp
    where id=a.id and clinic_id=p_clinic_id returning * into result;
  if result.id is null then raise exception 'No se pudo guardar la ficha principal.'; end if;
  update public.lead_activities set lead_id=a.id,
    metadata=metadata||jsonb_build_object('merge_original_lead_id',b.id)
    where lead_id=b.id and organization_id=a.organization_id and clinic_id=p_clinic_id;
  update public.atlas_internal_tasks set lead_id=a.id,updated_by=actor,updated_at=stamp,
    metadata=metadata||jsonb_build_object('merge_original_lead_id',b.id)
    where lead_id=b.id and organization_id=a.organization_id and clinic_id=p_clinic_id;
  update public.leads set deleted_at=stamp,status='duplicate',next_action_at=null,
    metadata=metadata||jsonb_build_object('merged_into',a.id,'merged_at',stamp,'no_contact',true),updated_by=actor,updated_at=stamp
    where id=b.id and clinic_id=p_clinic_id;
  if not found then raise exception 'No se pudo archivar la ficha duplicada.'; end if;
  insert into public.lead_activities(organization_id,clinic_id,lead_id,activity_type,summary,metadata,created_by,completed_at)
    values(a.organization_id,p_clinic_id,a.id,'status','Fichas de captación fusionadas',
      jsonb_build_object('primary_id',a.id,'source_id',b.id,'originals',snapshots),actor,stamp);
  return jsonb_build_object('lead',to_jsonb(result),'archivedId',b.id,'tasksMoved',task_count);
end;
$$;
revoke all on function public.atlas_merge_leads(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) from public,anon;
grant execute on function public.atlas_merge_leads(uuid,uuid,uuid,timestamptz,timestamptz,jsonb) to authenticated;

create or replace function public.atlas_edit_lead(
  p_clinic_id uuid,p_lead_id uuid,p_version timestamptz,p_fields jsonb,p_archive boolean default false
) returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare a public.leads%rowtype; result public.leads%rowtype; actor uuid:=auth.uid(); stamp timestamptz:=clock_timestamp();
begin
  select * into a from public.leads where id=p_lead_id and clinic_id=p_clinic_id and deleted_at is null for update;
  if actor is null or a.id is null or not public.has_clinic_permission(a.organization_id,p_clinic_id,'patients_write') then raise exception 'Acceso no autorizado.'; end if;
  if p_version is null or a.updated_at<>p_version then raise exception 'La ficha ha cambiado. Actualiza antes de guardar.'; end if;
  if coalesce(jsonb_typeof(p_fields),'null')<>'object' or exists(select 1 from jsonb_object_keys(p_fields) k where k not in ('first_name','last_name','email','phone','assigned_name','notes','source_detail')) then raise exception 'Campos no válidos.'; end if;
  update public.leads set
    first_name=case when p_fields?'first_name' then nullif(btrim(p_fields->>'first_name'),'') else a.first_name end,
    last_name=case when p_fields?'last_name' then nullif(btrim(p_fields->>'last_name'),'') else a.last_name end,
    email=case when p_fields?'email' then nullif(btrim(p_fields->>'email'),'') else a.email end,
    phone=case when p_fields?'phone' then nullif(btrim(p_fields->>'phone'),'') else a.phone end,
    assigned_name=case when p_fields?'assigned_name' then nullif(btrim(p_fields->>'assigned_name'),'') else a.assigned_name end,
    notes=case when p_fields?'notes' then nullif(btrim(p_fields->>'notes'),'') else a.notes end,
    source_detail=case when p_fields?'source_detail' then nullif(btrim(p_fields->>'source_detail'),'') else a.source_detail end,
    deleted_at=case when p_archive then stamp else null end,
    next_action_at=case when p_archive then null else a.next_action_at end,
    updated_by=actor,updated_at=stamp where id=a.id and clinic_id=p_clinic_id returning * into result;
  if result.id is null then raise exception 'No se pudo guardar.'; end if;
  insert into public.lead_activities(organization_id,clinic_id,lead_id,activity_type,summary,metadata,created_by,completed_at)
    values(a.organization_id,p_clinic_id,a.id,'note',case when p_archive then 'Ficha archivada' else 'Datos de captación editados' end,
    jsonb_build_object('before',to_jsonb(a),'after',to_jsonb(result),'recoverable',true),actor,stamp);
  return to_jsonb(result);
end;
$$;
revoke all on function public.atlas_edit_lead(uuid,uuid,timestamptz,jsonb,boolean) from public,anon;
grant execute on function public.atlas_edit_lead(uuid,uuid,timestamptz,jsonb,boolean) to authenticated;

-- Campaign ingestion: one contact card, many recorded arrivals. Only the signed
-- Meta worker may call this; it must use the returned `created` flag before sending.
create or replace function public.atlas_ingest_meta_lead(p_row jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare
  org uuid:=(p_row->>'organization_id')::uuid; clinic uuid:=(p_row->>'clinic_id')::uuid;
  phone_key text; email_key text:=lower(btrim(p_row->>'email')); name_key text;
  a public.leads%rowtype; source_lead public.leads%rowtype; was_created boolean:=false;
begin
  if current_user<>'service_role' or clinic<>'bb64ef32-ae0a-478f-bc30-bf6ce554567a'::uuid
    or not exists(select 1 from public.clinics where id=clinic and organization_id=org) then
    raise exception 'Meta intake is restricted to the Alicante worker.';
  end if;
  if nullif(p_row->>'external_id','') is null or p_row->>'source'<>'meta' then raise exception 'Invalid Meta delivery.'; end if;
  phone_key=regexp_replace(coalesce(p_row->>'phone',''),'[^0-9]','','g');
  phone_key=regexp_replace(phone_key,'^00','');
  if phone_key~'^[6789][0-9]{8}$' then phone_key='34'||phone_key; end if;
  if length(phone_key)<9 then phone_key=''; end if;
  name_key=regexp_replace(translate(lower(concat_ws(' ',p_row->>'first_name',p_row->>'last_name')),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g');
  -- External delivery retry and contact matching are serialized within the clinic.
  perform pg_advisory_xact_lock(hashtextextended(clinic::text||':'||(p_row->>'external_id'),0));
  perform pg_advisory_xact_lock(hashtextextended(clinic::text||':'||coalesce(nullif(phone_key,''),email_key,p_row->>'external_id'),1));
  select * into source_lead from public.leads where clinic_id=clinic and organization_id=org and external_id=p_row->>'external_id';
  if source_lead.id is not null then
    if source_lead.metadata?'merged_into' then
      select * into a from public.leads where id=(source_lead.metadata->>'merged_into')::uuid and clinic_id=clinic and organization_id=org and deleted_at is null;
    elsif source_lead.deleted_at is null then a=source_lead;
    else raise exception 'An archived delivery requires review.'; end if;
    if a.id is null then raise exception 'Merged target needs review.'; end if;
    return jsonb_build_object('lead',to_jsonb(a),'created',false,'repeatedDelivery',true);
  end if;
  -- A replay of an arrival attached to an existing card must not add another event.
  select l.* into a from public.lead_activities act join public.leads l on l.id=act.lead_id
    where act.clinic_id=clinic and act.organization_id=org and act.metadata->>'meta_external_id'=p_row->>'external_id'
      and l.deleted_at is null and l.clinic_id=clinic and l.organization_id=org limit 1;
  if a.id is not null then return jsonb_build_object('lead',to_jsonb(a),'created',false,'repeatedDelivery',true); end if;
  -- Never identify two people solely by a shared family phone or name.
  if name_key<>'' and name_key<>'leadmeta' and name_key<>'lead' then
    select l.* into a from public.leads l
    where l.organization_id=org and l.clinic_id=clinic and l.deleted_at is null
      and coalesce(l.metadata->>'workflow','')<>'appointment_cancellation_rebook'
      and regexp_replace(translate(lower(concat_ws(' ',l.first_name,l.last_name)),'áéíóúüñ','aeiouun'),'[^a-z0-9]','','g')=name_key
      and ((phone_key<>'' and regexp_replace(regexp_replace(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),'^00',''),'^([6789][0-9]{8})$','34\1')=phone_key)
        or (nullif(email_key,'') is not null and lower(btrim(l.email))=email_key))
    order by (l.status<>'new') desc,l.created_at,l.id limit 1 for update;
  end if;
  if a.id is null then
    insert into public.leads(organization_id,clinic_id,source,source_detail,first_name,last_name,email,phone,status,next_action_at,external_id,marketing_consent,marketing_consent_at,metadata)
      values(org,clinic,'meta',p_row->>'source_detail',p_row->>'first_name',p_row->>'last_name',p_row->>'email',p_row->>'phone','new',
      (p_row->>'next_action_at')::timestamptz,p_row->>'external_id',coalesce((p_row->>'marketing_consent')::boolean,false),(p_row->>'marketing_consent_at')::timestamptz,coalesce(p_row->'metadata','{}'::jsonb)) returning * into a;
    was_created=true;
  else
    insert into public.lead_activities(organization_id,clinic_id,lead_id,activity_type,summary,metadata)
      values(org,clinic,a.id,'note','Nueva entrada de campaña sobre contacto existente',
      jsonb_build_object('meta_external_id',p_row->>'external_id','incoming',p_row,'retained_stage',a.metadata->>'funnel_stage'));
  end if;
  return jsonb_build_object('lead',to_jsonb(a),'created',was_created);
end;
$$;
revoke all on function public.atlas_ingest_meta_lead(jsonb) from public,anon,authenticated;
grant execute on function public.atlas_ingest_meta_lead(jsonb) to service_role;
