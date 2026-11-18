const fs = require('fs');
const src = fs.readFileSync('src/supabaseClient.js', 'utf8');
const grab = (name) => {
  const m = src.match(new RegExp(name + "\\s*=\\s*'([^']+)'"));
  return m ? Buffer.from(m[1], 'base64').toString('utf8') : null;
};
const URL_ = grab('SUPABASE_URL_B64');
const KEY_ = grab('SUPABASE_ANON_KEY_B64');
console.log('URL :', URL_);
console.log('KEY :', KEY_ ? KEY_.slice(0, 24) + '… (' + KEY_.length + ' chars)' : 'MISSING');

(async () => {
  for (const t of ['scanprintuser', 'scanprintupdates']) {
    try {
      const r = await fetch(`${URL_}/rest/v1/${t}?select=*&limit=1`, {
        headers: { apikey: KEY_, Authorization: 'Bearer ' + KEY_ }
      });
      const body = await r.text();
      console.log(`\n[${t}] HTTP ${r.status}`);
      console.log(body.slice(0, 400));
      if (r.status === 200) console.log('✅ readable');
      else if (r.status === 401 || r.status === 403) console.log('❌ RLS / key problem → run the SQL below');
      else if (r.status === 404) console.log('❌ table missing → run the SQL below');
    } catch (e) { console.log(`\n[${t}] network error:`, e.message); }
  }
})();
