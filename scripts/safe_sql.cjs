const fs = require('fs');
const path = require('path');

const auth = fs.readFileSync('src/services/authService.js', 'utf8');
const m = auth.match(/import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/);
const clientPath = path.normalize(path.join('src/services', m[1]));
const src = fs.readFileSync(clientPath, 'utf8');
const b64 = s => { try { return Buffer.from(s, 'base64').toString('utf8'); } catch (e) { return ''; } };
let URL_ = null;
for (const mm of src.matchAll(/['"](https:\/\/[a-z0-9]+\.supabase\.co)['"]/g)) URL_ = URL_ || mm[1];
for (const mm of src.matchAll(/['"]([A-Za-z0-9+/=]{40,})['"]/g)) {
  const d = b64(mm[1]);
  if (/^https:\/\/[a-z0-9]+\.supabase\.co/.test(d)) URL_ = URL_ || d;
}
const ref = URL_ ? URL_.replace('https://', '').replace('.supabase.co', '') : 'unknown';
console.log('▶ Run the SQL in THIS project: ' + ref + '\n');

const sql = `-- ═══ scanprint tables ONLY — nothing else is touched ═══
-- Run in project: ${ref}

do $$
begin
  if to_regclass('public.scanprintuser') is null then
    raise exception 'WRONG PROJECT: public.scanprintuser is not here. Switch to project ${ref} and run again.';
  end if;
end $$;

create extension if not exists pgcrypto;

-- 1. make sure every column the app reads exists
alter table public.scanprintuser add column if not exists username text;
alter table public.scanprintuser add column if not exists password_hash text;
alter table public.scanprintuser add column if not exists first_name text default '';
alter table public.scanprintuser add column if not exists last_name text default '';
alter table public.scanprintuser add column if not exists role text default 'user';
alter table public.scanprintuser add column if not exists expiry_date timestamptz;
alter table public.scanprintuser add column if not exists device_id text;
alter table public.scanprintuser add column if not exists session_token text;
alter table public.scanprintuser add column if not exists created_at timestamptz not null default now();
alter table public.scanprintuser add column if not exists updated_at timestamptz not null default now();

alter table public.scanprintuser disable row level security;
grant all on public.scanprintuser to anon, authenticated;

-- 2. normalise + remove duplicate usernames (keep the earliest account)
update public.scanprintuser set username = lower(trim(username)) where username <> lower(trim(username));
update public.scanprintuser set role = 'user' where role is null;

delete from public.scanprintuser a
using public.scanprintuser b
where lower(a.username) = lower(b.username)
  and (a.created_at > b.created_at
       or (a.created_at = b.created_at and a.id::text > b.id::text));

-- 3. uniqueness the database enforces, case-insensitive
create unique index if not exists scanprintuser_username_lower
  on public.scanprintuser (lower(username));

-- 4. every normal user gets 7 days from their registration date
update public.scanprintuser
set expiry_date = coalesce(created_at, now()) + interval '7 days'
where role is distinct from 'admin' and expiry_date is null;

update public.scanprintuser set expiry_date = null where role = 'admin';
alter table public.scanprintuser alter column role set default 'user';

-- 5. password-reset requests table (only scanprint-prefixed)
create table if not exists public.scanprintpwreq (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  note text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.scanprintpwreq disable row level security;
grant all on public.scanprintpwreq to anon, authenticated;

-- 6. seed one admin (password Admin@2026) only if none exists
insert into public.scanprintuser (username, password_hash, first_name, last_name, role, expiry_date)
select 'admin', encode(digest('scanprint::Admin@2026', 'sha256'), 'hex'), 'Admin', 'SuperUser', 'admin', null
where not exists (select 1 from public.scanprintuser where role = 'admin');

-- 7. verify
select username, role,
       created_at::date as registered,
       expiry_date::date as expires,
       case when expiry_date is null then 'never (admin)'
            else greatest(0, ceil(extract(epoch from (expiry_date - now())) / 86400))::text || ' days left'
       end as status
from public.scanprintuser
order by created_at desc;
`;

fs.mkdirSync('supabase', { recursive: true });
fs.writeFileSync('supabase/access_control.sql', sql);
console.log(sql);
