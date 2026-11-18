const fs = require('fs');
const sc = fs.readFileSync('src/supabaseClient.js', 'utf8');
const grab = n => { const m = sc.match(new RegExp(n + "\\s*=\\s*'([^']+)'")); return m ? Buffer.from(m[1], 'base64').toString('utf8') : ''; };
const U = grab('SUPABASE_URL_B64'), K = grab('SUPABASE_ANON_KEY_B64');
(async () => {
  const r = await fetch(`${U}/rest/v1/scanprintupdates?select=*&order=created_at.desc&limit=1`,
    { headers: { apikey: K, Authorization: 'Bearer ' + K } });
  console.log('scanprintupdates HTTP', r.status);
  const rows = await r.json();
  console.log(JSON.stringify(rows, null, 2).slice(0, 800));
  if (Array.isArray(rows) && rows[0]) {
    const l = rows[0];
    console.log('\nkind:', l.kind, '| version:', l.version, '| send_alert:', l.send_alert);
    console.log('apk_url:', l.apk_url || '(EMPTY)');
    if (l.apk_url) {
      const h = await fetch(l.apk_url, { method: 'HEAD' });
      console.log('APK HEAD:', h.status, h.headers.get('content-length'), 'bytes');
    }
  } else {
    console.log('\n❌ no row readable with the app key — run:');
    console.log('   alter table public.scanprintupdates disable row level security;');
  }
})();
