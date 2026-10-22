-- Transactional integration tests: no accounts or wedding records survive rollback.
begin;
create temporary table wedding_test_results(test text, passed boolean);
grant select,insert on wedding_test_results to authenticated,anon;
do $$
declare u uuid;
begin
 foreach u in array array['11111111-1111-4111-8111-111111111111'::uuid,'22222222-2222-4222-8222-222222222222'::uuid,'33333333-3333-4333-8333-333333333333'::uuid,'44444444-4444-4444-8444-444444444444'::uuid] loop
  insert into auth.users(id,email,email_confirmed_at) values(u,case u::text when '11111111-1111-4111-8111-111111111111' then 'owner@example.invalid' when '22222222-2222-4222-8222-222222222222' then 'partner@example.invalid' when '33333333-3333-4333-8333-333333333333' then 'outsider@example.invalid' else 'unverified@example.invalid' end,case when u::text like '4444%' then null else now() end);
 end loop;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
do $$
declare s public.wedding_spaces; t text; d jsonb := '{"couple":"test","venue":"","weddingDate":"","totalBudget":500000,"tasks":[],"expenses":[],"vendors":[],"guests":[],"notes":[]}'; denied boolean;
begin
 s:=public.create_wedding(d);perform set_config('wedding_test.space',s.id::text,true);
 insert into wedding_test_results values('verified owner creates and reads own space',(select count(*)=1 from public.wedding_spaces));
 t:=public.invite_wedding_partner(s.id,'partner@example.invalid');perform set_config('wedding_test.token',t,true);
 perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
 insert into wedding_test_results values('outsider RLS returns no wedding data',(select count(*)=0 from public.wedding_spaces));
 denied:=false;begin perform public.join_wedding(t);exception when others then denied:=true;end;
 insert into wedding_test_results values('wrong-email invite redemption denied',denied);
 denied:=false;begin perform public.save_wedding(s.id,1,d);exception when sqlstate '40001' then denied:=true;end;
 insert into wedding_test_results values('outsider RPC write denied',denied);
 denied:=false;begin update public.wedding_spaces set partner_id='33333333-3333-4333-8333-333333333333' where id=s.id;exception when insufficient_privilege then denied:=true;end;
 insert into wedding_test_results values('direct table update denied',denied);
 perform set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
 denied:=false;begin perform public.create_wedding(d);exception when insufficient_privilege then denied:=true;end;
 insert into wedding_test_results values('unverified account creation denied',denied);
 perform set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
 s:=public.join_wedding(t);
 insert into wedding_test_results values('invited partner joins and reads same space',(select count(*)=1 from public.wedding_spaces));
 s:=public.save_wedding(s.id,1,jsonb_set(d,'{couple}','"共同編輯"'));
 insert into wedding_test_results values('partner edit persists with new revision',s.revision=2 and s.data->>'couple'='共同編輯');
 denied:=false;begin perform public.save_wedding(s.id,1,d);exception when sqlstate '40001' then denied:=true;end;
 insert into wedding_test_results values('stale revision cannot overwrite',denied and (select data->>'couple'='共同編輯' from public.wedding_spaces));
 denied:=false;begin perform public.create_wedding(d);exception when others then denied:=true;end;
 insert into wedding_test_results values('user limited to one shared space',denied);
 perform set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
 denied:=false;begin perform public.join_wedding(t);exception when others then denied:=true;end;
 insert into wedding_test_results values('used invite cannot be reused',denied);
end $$;
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$declare denied boolean:=false;begin
 begin perform * from public.wedding_spaces;exception when insufficient_privilege then denied:=true;end;
 insert into wedding_test_results values('anonymous table read denied',denied);
 denied:=false;begin perform public.create_wedding('{}');exception when insufficient_privilege then denied:=true;end;
 insert into wedding_test_results values('anonymous RPC denied',denied);
end $$;
select * from wedding_test_results;
do $$begin if exists(select 1 from wedding_test_results where not passed) then raise exception 'Security test failed';end if;end $$;
rollback;
