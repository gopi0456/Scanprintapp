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

const auth = fs.readFileSync('src/services/authService.js', 'utf8');
const TABLE = (auth.match(/const TABLE\s*=\s*'([^']+)'/) || [])[1];
if (!TABLE) { console.log('❌ could not read the TABLE constant'); process.exit(1); }

const all = new Set();
for (const f of walk('src')) {
  const t = fs.readFileSync(f, 'utf8');
  for (const m of t.matchAll(/\.from\('([^']+)'\)/g)) all.add(m[1]);
}
console.log('user table in code :', TABLE);
console.log('all tables in code :', [...all].sort().join(', '));

const cols = [
  ['username', 'text'],
  ['password_hash', 'text'],
  ['first_name', "text default ''"],
  ['last_name', "text default ''"],
  ['role', "text default 'user'"],
  ['expiry_date', 'timestamptz'],
  ['device_id', 'text'],
  ['session_token', 'text'],
  ['created_at', 'timestamptz not null default now()'],
  ['updated_at', 'timestamptz not null default now()']
];

const sql = `-- generated for user table: ${TABLE}
create extension if not exists pgcrypto;

create table if not exists public.${TABLE} (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
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

${cols.map(([c, t]) => `alter table public.${TABLE} add column if not exists ${c} ${t};`).join('\n')}

alter table public.${TABLE} disable row level security;
grant all on public.${TABLE} to anon, authenticated;
update public.${TABLE} set role = 'user' where role is null;

create table if not exists public.scanprintpwreq (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  note text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.scanprintpwreq disable row level security;
grant all on public.scanprintpwreq to anon, authenticated;

-- confirm what now exists
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;

select username, role, expiry_date from public.${TABLE}
order by created_at desc limit 20;
`;

fs.mkdirSync('supabase', { recursive: true });
fs.writeFileSync('supabase/access_control.sql', sql);
console.log('\n✅ wrote supabase/access_control.sql for table "' + TABLE + '"\n');
console.log(sql);
