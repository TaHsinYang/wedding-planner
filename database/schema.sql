-- Wedding Planner: isolated spaces, verified accounts, email-bound single-use invites.
create schema if not exists wedding_private;
revoke all on schema wedding_private from public, anon, authenticated;
grant usage on schema wedding_private to authenticated;

create table public.wedding_spaces (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 partner_id uuid references auth.users(id),
 data jsonb not null,
 revision bigint not null default 1,
 updated_at timestamptz not null default now(),
 constraint distinct_partners check (owner_id is distinct from partner_id)
);
create index wedding_spaces_owner_idx on public.wedding_spaces(owner_id);
create index wedding_spaces_partner_idx on public.wedding_spaces(partner_id);
alter table public.wedding_spaces enable row level security;
revoke all on public.wedding_spaces from anon, authenticated;
grant select on public.wedding_spaces to authenticated;
create policy members_read on public.wedding_spaces for select to authenticated
 using ((select auth.uid()) = owner_id or (select auth.uid()) = partner_id);

create table wedding_private.members (
 user_id uuid primary key references auth.users(id),
 space_id uuid not null references public.wedding_spaces(id) on delete cascade
);
create index members_space_idx on wedding_private.members(space_id);
create table wedding_private.invites (
 space_id uuid primary key references public.wedding_spaces(id) on delete cascade,
 token_hash text unique not null,
 email text not null,
 expires_at timestamptz not null
);
alter table wedding_private.members enable row level security;
alter table wedding_private.invites enable row level security;
revoke all on all tables in schema wedding_private from public, anon, authenticated;

create function wedding_private.verified_user() returns uuid language plpgsql security definer
set search_path = '' as $$
declare u uuid := auth.uid();
begin
 if u is null or not exists(select 1 from auth.users where id=u and email_confirmed_at is not null and not coalesce(is_anonymous,false)) then
  raise exception '請先完成 Email 驗證並登入' using errcode='42501';
 end if;
 return u;
end $$;

create function wedding_private.valid_document(d jsonb) returns boolean language plpgsql immutable
set search_path = '' as $$
declare k text; a jsonb;
begin
 if d is null or jsonb_typeof(d) <> 'object' or octet_length(d::text)>1000000 then return false; end if;
 foreach k in array array['tasks','expenses','vendors','guests','notes'] loop
  if jsonb_typeof(d->k) is distinct from 'array' then return false; end if;
  if jsonb_array_length(d->k)>10000 then return false; end if;
  for a in select value from jsonb_array_elements(d->k) loop
   if jsonb_typeof(a) <> 'object' or jsonb_typeof(a->'id') is distinct from 'string' or (a->>'id') !~ '^[A-Za-z0-9_-]{1,100}$' then return false; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(d->k)) <> (select count(distinct value->>'id') from jsonb_array_elements(d->k)) then return false; end if;
 end loop;
 return true;
end $$;

create function wedding_private.create_space(initial_data jsonb) returns public.wedding_spaces
language plpgsql security definer set search_path = '' as $$
declare u uuid := wedding_private.verified_user(); s public.wedding_spaces;
begin
 if not wedding_private.valid_document(initial_data) then raise exception '資料格式不正確'; end if;
 if exists(select 1 from wedding_private.members where user_id=u) then raise exception '你已加入一個備婚空間'; end if;
 insert into public.wedding_spaces(owner_id,data) values(u,initial_data) returning * into s;
 insert into wedding_private.members values(u,s.id);
 return s;
end $$;

create function wedding_private.save_space(space_id uuid, expected_revision bigint, document jsonb) returns public.wedding_spaces
language plpgsql security definer set search_path = '' as $$
declare u uuid := wedding_private.verified_user(); s public.wedding_spaces;
begin
 if not wedding_private.valid_document(document) then raise exception '資料格式不正確'; end if;
 update public.wedding_spaces w set data=document,revision=w.revision+1,updated_at=now()
 where w.id=save_space.space_id and (w.owner_id=u or w.partner_id=u) and w.revision=expected_revision returning w.* into s;
 if not found then raise exception '版本已更新，請合併後重試' using errcode='40001'; end if;
 return s;
end $$;

create function wedding_private.invite_partner(space_id uuid, partner_email text) returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid := wedding_private.verified_user(); token text; target text := lower(trim(partner_email)); s public.wedding_spaces;
begin
 select * into s from public.wedding_spaces w where w.id=invite_partner.space_id and w.owner_id=u for update;
 if not found or s.partner_id is not null then raise exception '只有空間建立者能邀請一位伴侶'; end if;
 if target !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(target)>254 or target=(select lower(email) from auth.users where id=u) then raise exception '請輸入伴侶的 Email'; end if;
 token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
 insert into wedding_private.invites values(s.id,encode(sha256(convert_to(token,'UTF8')),'hex'),target,now()+interval '48 hours')
 on conflict on constraint invites_pkey do update set token_hash=excluded.token_hash,email=excluded.email,expires_at=excluded.expires_at;
 return token;
end $$;

create function wedding_private.join_space(invite_token text) returns public.wedding_spaces
language plpgsql security definer set search_path = '' as $$
declare u uuid := wedding_private.verified_user(); i wedding_private.invites; s public.wedding_spaces;
begin
 if exists(select 1 from wedding_private.members where user_id=u) then raise exception '你已加入備婚空間，不能重複加入'; end if;
 select * into i from wedding_private.invites where token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex');
 if not found then raise exception '邀請無效或已使用'; end if;
 -- Same lock order as invite_partner: space then invitation.
 select * into s from public.wedding_spaces w where w.id=i.space_id for update;
 select * into i from wedding_private.invites where space_id=s.id and token_hash=encode(sha256(convert_to(invite_token,'UTF8')),'hex') for update;
 if not found or i.expires_at<now() or i.email is distinct from (select lower(email) from auth.users where id=u) or s.partner_id is not null then raise exception '邀請已失效，或登入 Email 與受邀 Email 不同'; end if;
 insert into wedding_private.members values(u,s.id);
 update public.wedding_spaces w set partner_id=u where w.id=s.id returning w.* into s;
 delete from wedding_private.invites where space_id=s.id;
 return s;
end $$;

-- Exposed wrappers run as invoker. Privileged implementations are in a non-exposed schema.
create function public.create_wedding(initial_data jsonb) returns public.wedding_spaces language sql security invoker set search_path='' as $$select wedding_private.create_space(initial_data)$$;
create function public.save_wedding(space_id uuid, expected_revision bigint, document jsonb) returns public.wedding_spaces language sql security invoker set search_path='' as $$select wedding_private.save_space(space_id,expected_revision,document)$$;
create function public.invite_wedding_partner(space_id uuid, partner_email text) returns text language sql security invoker set search_path='' as $$select wedding_private.invite_partner(space_id,partner_email)$$;
create function public.join_wedding(invite_token text) returns public.wedding_spaces language sql security invoker set search_path='' as $$select wedding_private.join_space(invite_token)$$;
revoke all on all functions in schema wedding_private from public, anon, authenticated;
grant execute on function wedding_private.create_space(jsonb), wedding_private.save_space(uuid,bigint,jsonb), wedding_private.invite_partner(uuid,text), wedding_private.join_space(text) to authenticated;
revoke all on function public.create_wedding(jsonb),public.save_wedding(uuid,bigint,jsonb),public.invite_wedding_partner(uuid,text),public.join_wedding(text) from public,anon;
grant execute on function public.create_wedding(jsonb),public.save_wedding(uuid,bigint,jsonb),public.invite_wedding_partner(uuid,text),public.join_wedding(text) to authenticated;
