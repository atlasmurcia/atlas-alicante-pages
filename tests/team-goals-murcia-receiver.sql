begin;
do $$
declare v_token text:='synthetic-reverse-token-012345678901234567890';v_period date:=date_trunc('month',timezone('Europe/Madrid',now()))::date;v jsonb;
begin
 insert into atlas_private.objective_sync_sources(source_clinic,token_hash) values('Murcia',extensions.crypt(v_token,extensions.gen_salt('bf',6)))
 on conflict(source_clinic) do update set token_hash=excluded.token_hash,active=true;
 perform public.atlas_team_goals_receive_external_snapshot(v_token,'Murcia',v_period,now(),1000,2,3,4,5,150000,340,320,210,180);
 select payload->'team_goals_murcia_comparison' into v from public.clinic_settings where section='other' limit 1;
 if v->>'period'<>to_char(v_period,'YYYY-MM') or (v#>>'{clinics,murcia,metrics,team_net_invoicing,actual}')::numeric<>1000 then raise exception 'Resumen incorrecto';end if;
end $$;
rollback;
