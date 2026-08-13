begin;

create schema if not exists identity;
create schema if not exists access;
create schema if not exists business;
create schema if not exists question;
create schema if not exists storage;
create schema if not exists audit;
create schema if not exists migration;

revoke all on schema public from public;
revoke all on schema identity from public;
revoke all on schema access from public;
revoke all on schema business from public;
revoke all on schema question from public;
revoke all on schema storage from public;
revoke all on schema audit from public;
revoke all on schema migration from public;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'gewu_vnext_runtime') then
    create role gewu_vnext_runtime nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'gewu_vnext_migrator') then
    create role gewu_vnext_migrator nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'gewu_vnext_auditor') then
    create role gewu_vnext_auditor nologin nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;

grant usage on schema identity, access, business, question, storage, audit to gewu_vnext_runtime;
grant usage on schema identity, access, business, question, storage, audit, migration to gewu_vnext_migrator;
grant usage on schema audit, migration to gewu_vnext_auditor;

commit;
