begin;

do $$
declare v jsonb;
begin
  v:=public.atlas_team_goals_sync_payload(date '2026-11-01');
  if v->>'p_source_clinic'<>'Alicante' then raise exception 'Clínica incorrecta';end if;
  if (v->>'p_revenue')::numeric<0 then raise exception 'Facturación incorrecta';end if;
  if (v->>'p_mbst_sessions')::numeric<0 or (v->>'p_bomba_sessions')::numeric<0
     or (v->>'p_robot_traction_sessions')::numeric<0 or (v->>'p_brains_sessions')::numeric<0 then
    raise exception 'Sesiones incorrectas';
  end if;
  if (v->>'p_revenue_target')::numeric<>65000 or (v->>'p_mbst_target')::numeric<>250
     or (v->>'p_bomba_target')::numeric<>100 or (v->>'p_robot_traction_target')::numeric<>110
     or (v->>'p_brains_target')::numeric<>0 then raise exception 'Metas incorrectas';end if;
end
$$;

rollback;
