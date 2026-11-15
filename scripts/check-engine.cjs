const fs = require('fs');
const eng = fs.readFileSync('src/utils/compressEngine.js', 'utf8');
const panel = fs.readFileSync('src/components/CompressSavePanel.jsx', 'utf8');

const exported = new Set();
let m;
const fnRe = /export\s+(?:async\s+function|function|const)\s+([A-Za-z0-9_$]+)/g;
while ((m = fnRe.exec(eng))) exported.add(m[1]);
const reRe = /export\s*\{([^}]+)\}\s*from/g;
while ((m = reRe.exec(eng))) m[1].split(',').forEach(s => exported.add(s.trim().split(/\s+as\s+/).pop()));

let bad = 0;
const impRe = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]*compressEngine[^'"]*['"]/g;
while ((m = impRe.exec(panel))) {
  m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(n => {
    if (!exported.has(n)) { console.log('❌ panel imports missing export:', n); bad++; }
    else console.log('✅ import ok:', n);
  });
}
const dupRe = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm;
const seen = new Set();
while ((m = dupRe.exec(eng))) {
  if (seen.has(m[1])) { console.log('❌ duplicate function:', m[1]); bad++; }
  seen.add(m[1]);
}
console.log(bad ? '❌ ' + bad + ' problem(s) found' : '✅ engine exports + panel imports + no duplicates: ALL OK');
process.exit(bad ? 1 : 0);
