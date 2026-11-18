const fs = require('fs');
const p = 'src/App.jsx';
const s = fs.readFileSync(p, 'utf8');

console.log('── Session persistence check ──');

const checks = [
  { name: 'verifySession imported', test: /import.*verifySession.*authService/ },
  { name: 'booting state exists', test: /\[booting, setBooting\]/ },
  { name: 'async boot effect', test: /__asyncBoot__|await verifySession/ },
  { name: 'session gated behind booting', test: /\{!booting && !session/ },
  { name: 'boot splash overlay', test: /boot-splash/ }
];

let pass = 0, fail = 0;
for (const c of checks) {
  if (c.test.test(s)) { console.log('✅', c.name); pass++; }
  else { console.log('❌', c.name); fail++; }
}

if (fail > 0) {
  console.log('\n⚠️ Session persistence incomplete — re-applying patches');
  process.exit(1);
}

// Show the actual boot effect code
const bootMatch = s.match(/\/\* __asyncBoot__[\s\S]{0,400}/);
if (bootMatch) {
  console.log('\n── Boot effect code ──');
  console.log(bootMatch[0].slice(0, 400));
}

console.log('\n✅ Session persistence looks complete');
