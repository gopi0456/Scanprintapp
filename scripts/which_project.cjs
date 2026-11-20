const fs = require('fs');
const path = require('path');

/* 1. follow the real import chain: App → authService → supabaseClient */
const auth = fs.readFileSync('src/services/authService.js', 'utf8');
console.log('── authService imports ──');
auth.split('\n').filter(l => /^import/.test(l)).forEach(l => console.log('  ' + l));

const m = auth.match(/import\s*\{[^}]*\bsupabase\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/);
if (!m) { console.log('❌ no supabase import found'); process.exit(1); }
const clientPath = path.normalize(path.join('src/services', m[1]));
console.log('\n── resolved client file ──\n  ' + clientPath);
if (!fs.existsSync(clientPath)) { console.log('❌ that file does not exist'); process.exit(1); }

const src = fs.readFileSync(clientPath, 'utf8');
const b64 = s => { try { return Buffer.from(s, 'base64').toString('utf8'); } catch (e) { return ''; } };
let URL_ = null, KEY_ = null;
for (const mm of src.matchAll(/['"](https:\/\/[a-z0-9]+\.supabase\.co)['"]/g)) URL_ = URL_ || mm[1];
for (const mm of src.matchAll(/['"](eyJ[A-Za-z0-9_.-]{40,})['"]/g)) KEY_ = KEY_ || mm[1];
for (const mm of src.matchAll(/['"]([A-Za-z0-9+/=]{40,})['"]/g)) {
  const d = b64(mm[1]);
  if (/^https:\/\/[a-z0-9]+\.supabase\.co/.test(d)) URL_ = URL_ || d;
  if (/^eyJ[A-Za-z0-9_.-]{40,}$/.test(d)) KEY_ = KEY_ || d;
}
console.log('\nproject ref :', URL_ ? URL_.replace('https://', '').replace('.supabase.co', '') : '(none)');
console.log('anon key    :', KEY_ ? KEY_.slice(0, 20) + '…' : '(none)');
if (!URL_ || !KEY_) process.exit(1);

/* 2. probe candidate tables directly — more reliable than the OpenAPI root */
const H = { apikey: KEY_, Authorization: 'Bearer ' + KEY_ };
const candidates = ['scanprintuser', 'scanprintusers', 'scanprint_user', 'users', 'profiles',
                    'scanprintupdates', 'scanprintmessage', 'scanprintpwreq'];

(async () => {
  console.log('\n── table probe ──');
  const present = [];
  for (const t of candidates) {
    try {
      const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, { headers: H });
      const txt = await r.text();
      if (r.ok) {
        let n = '?';
        try { n = JSON.parse(txt).length; } catch (e) {}
        console.log(`  ✅ ${t.padEnd(18)} exists (sample rows: ${n})`);
        present.push(t);
      } else {
        const code = (txt.match(/"code"\s*:\s*"([^"]+)"/) || [])[1] || r.status;
        console.log(`  ❌ ${t.padEnd(18)} ${code}`);
      }
    } catch (e) { console.log(`  ⚠️ ${t.padEnd(18)} ${e.message}`); }
  }

  /* 3. raw OpenAPI keys, in case naming is unusual */
  try {
    const r = await fetch(URL_ + '/rest/v1/', { headers: H });
    const j = await r.json();
    const keys = Object.keys(j.definitions || j.components?.schemas || {});
    console.log('\n── OpenAPI tables ──\n  ' + (keys.join(', ') || '(empty — schema may be hidden from anon)'));
  } catch (e) { console.log('\nOpenAPI fetch failed:', e.message); }

  console.log('\n── verdict ──');
  if (present.includes('scanprintupdates') && !present.includes('scanprintuser')) {
    console.log('  This IS the right project (updates table found).');
    console.log('  scanprintuser is genuinely missing → run supabase/access_control.sql');
  } else if (!present.includes('scanprintupdates')) {
    console.log('  ⚠️ scanprintupdates NOT found here — this client points at a different project.');
    console.log('  Compare the project ref above with the one in your Supabase dashboard.');
  } else {
    console.log('  scanprintuser already exists — no CREATE needed.');
  }
})();
