const fs = require('fs');
const path = require('path');

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
};
const files = walk('src');

/* the exported TABLE constant, wherever it lives */
let codeTable = null;
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  const m = t.match(/export const TABLE\s*=\s*['"]([^'"]+)['"]/) || t.match(/\bTABLE\s*=\s*['"]([^'"]+)['"]/);
  if (m) { console.log('TABLE declared in ' + f + ' → ' + m[1]); codeTable = codeTable || m[1]; }
}
console.log('code TABLE =', codeTable || '(not found)');

/* credentials from any client file, plain or base64 */
const b64 = s => { try { return Buffer.from(s, 'base64').toString('utf8'); } catch (e) { return ''; } };
let URL_ = null, KEY_ = null;
for (const f of files.filter(f => /supabaseClient/i.test(f))) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/['"](https:\/\/[a-z0-9]+\.supabase\.co)['"]/g)) URL_ = URL_ || m[1];
  for (const m of t.matchAll(/['"](eyJ[A-Za-z0-9_.-]{40,})['"]/g)) KEY_ = KEY_ || m[1];
  for (const m of t.matchAll(/['"]([A-Za-z0-9+/=]{40,})['"]/g)) {
    const d = b64(m[1]);
    if (/^https:\/\/[a-z0-9]+\.supabase\.co/.test(d)) URL_ = URL_ || d;
    if (/^eyJ[A-Za-z0-9_.-]{40,}$/.test(d)) KEY_ = KEY_ || d;
  }
}
console.log('project URL =', URL_ || '(not found)');
console.log('anon key    =', KEY_ ? KEY_.slice(0, 18) + '…' : '(not found)');
if (!URL_ || !KEY_) { console.log('\n❌ credentials not resolved'); process.exit(1); }

(async () => {
  const r = await fetch(URL_ + '/rest/v1/', { headers: { apikey: KEY_, Authorization: 'Bearer ' + KEY_ } });
  const spec = await r.json();
  const tables = Object.keys(spec.definitions || spec.components?.schemas || {}).sort();
  console.log('\n── tables actually in your database ──');
  tables.forEach(t => console.log('  ' + t));

  const target = codeTable || 'scanprintuser';
  const exists = tables.includes(target);
  console.log('\ntarget "' + target + '" exists:', exists);
  if (!exists) {
    const near = tables.filter(t => /user|account|profile/i.test(t));
    if (near.length) console.log('⚠️ similar tables present: ' + near.join(', ') + ' — your users may live there');
  }

  const cols = [
    ['username', 'text'], ['password_hash', 'text'],
    ['first_name', "text default ''"], ['last_name', "text default ''"],
    ['role', "text default 'user'"], ['expiry_date', 'timestamptz'],
    ['device_id', 'text'], ['session_token', 'text'],
    ['created_at', 'timestamptz not null default now()'],
    ['updated_at', 'timestamptz not null default now()']
  ];
  const sql = `create extension if not exists pgcrypto;

create table if not exists public.${target} (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  first_name text default '',
  last_name text default '',
  role text default 'user',
  expiry_date timestamptz,
  device_id text,
  session_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

${cols.map(([c, t]) => `alter table public.${target} add column if not exists ${c} ${t};`).join('\n')}

alter table public.${target} disable row level security;
grant all on public.${target} to anon, authenticated;
update public.${target} set role = 'user' where role is null;

delete from public.${target} a using public.${target} b
where lower(a.username) = lower(b.username) and a.created_at > b.created_at;

create unique index if not exists ${target}_username_lower on public.${target} (lower(username));

update public.${target}
set expiry_date = coalesce(created_at, now()) + interval '7 days'
where role is distinct from 'admin' and expiry_date is null;

update public.${target} set expiry_date = null where role = 'admin';
alter table public.${target} alter column role set default 'user';

create table if not exists public.scanprintpwreq (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  note text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.scanprintpwreq disable row level security;
grant all on public.scanprintpwreq to anon, authenticated;

insert into public.${target} (username, password_hash, first_name, last_name, role, expiry_date)
select 'admin', encode(digest('scanprint::Admin@2026', 'sha256'), 'hex'), 'Admin', 'SuperUser', 'admin', null
where not exists (select 1 from public.${target} where role = 'admin');

select username, role, created_at::date as registered, expiry_date::date as expires
from public.${target} order by created_at desc limit 20;
`;
  fs.mkdirSync('supabase', { recursive: true });
  fs.writeFileSync('supabase/access_control.sql', sql);
  console.log('\n✅ supabase/access_control.sql written for "' + target + '" (CREATE runs first, so it cannot fail)\n');
  console.log(sql);
})();
