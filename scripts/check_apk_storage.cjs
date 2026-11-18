const fs = require('fs');
const sc = fs.readFileSync('src/supabaseClient.js', 'utf8');
const grab = n => { const m = sc.match(new RegExp(n + "\\s*=\\s*'([^']+)'")); return m ? Buffer.from(m[1], 'base64').toString('utf8') : ''; };
const U = grab('SUPABASE_URL_B64'), K = grab('SUPABASE_ANON_KEY_B64');

(async () => {
  const r = await fetch(`${U}/rest/v1/scanprintupdates?select=id,kind,version,apk_url,message,send_alert,created_at&order=created_at.desc&limit=3`,
    { headers: { apikey: K, Authorization: 'Bearer ' + K } });
  const rows = await r.json();
  
  console.log('── Latest published updates ──');
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log('❌ No published updates found');
    process.exit(1);
  }
  
  for (const row of rows) {
    console.log(`\n[${row.id.slice(0, 8)}] ${row.kind} v${row.version}`);
    console.log('  message:', row.message);
    console.log('  send_alert:', row.send_alert);
    console.log('  apk_url:', row.apk_url || '❌ EMPTY');
    
    if (row.apk_url) {
      try {
        const h = await fetch(row.apk_url, { method: 'HEAD' });
        console.log('  ✓ APK reachable:', h.status, h.headers.get('content-length'), 'bytes');
      } catch (e) {
        console.log('  ❌ APK unreachable:', e.message);
      }
    }
  }
})();
