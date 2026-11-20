const fs = require('fs');
const src = fs.readFileSync('src/services/authService.js', 'utf8');

/* collect every string/identifier declaration so .from(VAR) can be resolved */
const decls = new Map();
for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g)) {
  decls.set(m[1], m[2]);
}
console.log('── string constants declared ──');
for (const [k, v] of decls) console.log('  ' + k + ' = ' + v);

/* resolve every .from(...) argument */
const used = new Set();
for (const m of src.matchAll(/\.from\(\s*([^)]+?)\s*\)/g)) {
  const arg = m[1].trim();
  const lit = arg.match(/^['"]([^'"]+)['"]$/);
  if (lit) used.add(lit[1]);
  else if (decls.has(arg)) used.add(decls.get(arg));
  else console.log('  ⚠️ unresolved .from(' + arg + ')');
}
console.log('\n── tables this service uses ──');
console.log('  ' + ([...used].join(', ') || '(none resolved)'));

/* the user table is whichever one is not the updates/requests table */
const userTable = [...used].find(t => !/update|pwreq|msg|message/i.test(t));
if (!userTable) {
  console.log('\n❌ no user table resolved — paste the diagnostics above');
  process.exit(1);
}
console.log('\n✅ user table =', userTable);

const cols = [
  ['username', 'text'], ['password_hash', 'text'],
  ['first_name', "text default ''"], ['last_name', "text default ''"],
  ['role', "text default 'user'"], ['expiry_date', 'timestamptz'],
  ['device_id', 'text'], ['session_token', 'text'],
  ['created_at', 'timestamptz not null default now()'],
  ['updated_at', 'timestamptz not null default now()']
];
const sql = `-- user table: ${userTable}
create extension if not exists pgcrypto;

create table if not exists public.${userTable} (
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

${cols.map(([c, t]) => `alter table public.${userTable} add column if not exists ${c} ${t};`).join('\n')}

alter table public.${userTable} disable row level security;
grant all on public.${userTable} to anon, authenticated;
update public.${userTable} set role = 'user' where role is null;

create table if not exists public.scanprintpwreq (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  note text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.scanprintpwreq disable row level security;
grant all on public.scanprintpwreq to anon, authenticated;

select table_name from information_schema.tables
where table_schema = 'public' order by table_name;

select username, role, expiry_date from public.${userTable}
order by created_at desc limit 20;
`;
fs.mkdirSync('supabase', { recursive: true });
fs.writeFileSync('supabase/access_control.sql', sql);
console.log('\n✅ supabase/access_control.sql written\n');
console.log(sql);
