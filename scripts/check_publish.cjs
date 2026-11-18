const fs = require('fs');
const sc = fs.readFileSync('src/supabaseClient.js', 'utf8');
const grab = n => { const m = sc.match(new RegExp(n + "\\s*=\\s*'([^']+)'")); return m ? Buffer.from(m[1], 'base64').toString('utf8') : ''; };
const U = grab('SUPABASE_URL_B64'), K = grab('SUPABASE_ANON_KEY_B64');
(async () => {
  const r = await fetch(`${U}/rest/v1/scanprintupdates?select=*&order=created_at.desc&limit=3`, {
    headers: { apikey: K, Authorization: 'Bearer ' + K }
  });
  console.log('HTTP', r.status);
  const rows = await r.json();
  console.log(JSON.stringify(rows, null, 2).slice(0, 900));
  if (Array.isArray(rows) && rows.length) {
    const l = rows[0];
    console.log('\nlatest →', l.kind, l.version, '| alert:', l.send_alert);
    console.log('apk_url:', l.apk_url || '(none)');
    if (!l.apk_url && l.kind === 'update') console.log('⚠️ no APK URL stored — the upload did not reach storage');
  } else console.log('⚠️ nothing published / not readable');
})();
