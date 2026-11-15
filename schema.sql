-- Run top to bottom in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  user_name  text not null,
  message    text not null,
  created_at timestamptz not null default now(),
  constraint chat_name_len check (length(user_name) between 1 and 20),
  constraint chat_msg_len  check (length(message) between 1 and 200),
  constraint chat_msg_text check (length(btrim(message)) > 0)
);

create index if not exists chat_messages_created_at_idx on public.chat_messages (created_at desc);

-- Full old row in DELETE events (id is always present; FULL is just safest).
alter table public.chat_messages replica identity full;

-- Server-side rate limit: max 15 messages per user_name per minute.
-- (Name-based, so a determined spammer can rotate names. Add Auth for strict limits.)
create or replace function public.chat_rate_limit() returns trigger
language plpgsql as $$
begin
  if (select count(*) from public.chat_messages
      where user_name = new.user_name and created_at > now() - interval '1 minute') >= 15 then
    raise exception 'rate limit exceeded';
  end if;
  return new;
end $$;

drop trigger if exists trg_chat_rate_limit on public.chat_messages;
create trigger trg_chat_rate_limit before insert on public.chat_messages
  for each row execute function public.chat_rate_limit();

-- RLS (no UPDATE policy => updates are impossible)
alter table public.chat_messages enable row level security;
drop policy if exists chat_select        on public.chat_messages;
drop policy if exists chat_insert        on public.chat_messages;
drop policy if exists chat_delete_simple on public.chat_messages;
drop policy if exists chat_insert_secure on public.chat_messages;
drop policy if exists chat_insert_admin  on public.chat_messages;
drop policy if exists chat_delete_admin  on public.chat_messages;

create policy chat_select on public.chat_messages
  for select to anon, authenticated using (true);

-- ===== MODE A: "simple" (default). Anyone with the anon key can delete. =====
create policy chat_insert on public.chat_messages
  for insert to anon, authenticated
  with check (length(message) between 1 and 200 and length(user_name) between 1 and 20);

create policy chat_delete_simple on public.chat_messages
  for delete to anon, authenticated using (true);

-- ===== MODE B: "secure". Run this block INSTEAD of the two MODE A policies. =====
-- 1) Supabase Dashboard > Authentication > create ONE user (your admin email + password).
-- 2) Authentication > Providers > Email > turn OFF "Allow new users to sign up".
-- 3) Replace admin@example.com below with that email (same value as ADMIN_EMAIL in script.js).
--
-- drop policy if exists chat_insert on public.chat_messages;
-- drop policy if exists chat_delete_simple on public.chat_messages;
-- create policy chat_insert_secure on public.chat_messages
--   for insert to anon
--   with check (length(message) between 1 and 200 and length(user_name) between 1 and 20
--               and lower(btrim(user_name)) <> 'atulya');
-- create policy chat_insert_admin on public.chat_messages
--   for insert to authenticated
--   with check (length(message) between 1 and 200 and length(user_name) between 1 and 20);
-- create policy chat_delete_admin on public.chat_messages
--   for delete to authenticated using ((auth.jwt() ->> 'email') = 'admin@example.com');

-- Realtime publication (idempotent)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;
