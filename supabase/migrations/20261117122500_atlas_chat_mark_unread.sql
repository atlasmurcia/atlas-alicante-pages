create or replace function public.atlas_chat_mark_unread(
  p_organization_id uuid,
  p_clinic_id uuid,
  p_sender_user_id uuid
)
returns setof public.internal_chat_messages
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_recipient_user_id uuid := (select auth.uid());
begin
  if v_recipient_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not private.is_active_clinic_member(
    v_recipient_user_id,
    p_organization_id,
    p_clinic_id
  ) then
    raise exception 'Active clinic membership required';
  end if;

  if not private.is_active_clinic_member(
    p_sender_user_id,
    p_organization_id,
    p_clinic_id
  ) then
    raise exception 'Sender is not an active clinic member';
  end if;

  return query
  update public.internal_chat_messages message
     set read_at = null
   where message.id = (
     select incoming.id
       from public.internal_chat_messages incoming
      where incoming.organization_id = p_organization_id
        and incoming.clinic_id = p_clinic_id
        and incoming.recipient_user_id = v_recipient_user_id
        and incoming.sender_user_id = p_sender_user_id
        and incoming.deleted_at is null
      order by incoming.created_at desc, incoming.id desc
      limit 1
   )
     and message.organization_id = p_organization_id
     and message.clinic_id = p_clinic_id
     and message.recipient_user_id = v_recipient_user_id
     and message.sender_user_id = p_sender_user_id
     and message.read_at is not null
  returning message.*;
end;
$function$;

revoke all on function public.atlas_chat_mark_unread(uuid, uuid, uuid) from public;
revoke all on function public.atlas_chat_mark_unread(uuid, uuid, uuid) from anon;
grant execute on function public.atlas_chat_mark_unread(uuid, uuid, uuid) to authenticated;

comment on function public.atlas_chat_mark_unread(uuid, uuid, uuid) is
  'Marca como no leído el último mensaje recibido del remitente indicado. Solo actúa para el usuario autenticado que figura como destinatario.';
