const fs = require('fs');
const ap = 'src/services/authService.js';
let lines = fs.readFileSync(ap, 'utf8').split('\n');

const rx = /^\s*(?:export\s+)?(?:const|let|var)\s+(TABLE|H)\s*=\s*(.+?);?\s*$/;
const found = [];
lines.forEach((l, i) => { const m = l.match(rx); if (m) found.push({ i, name: m[1], value: m[2], text: l }); });

console.log('── declarations found ──');
found.forEach(f => console.log(`  line ${f.i + 1}: ${f.name} = ${f.value}`));

const seen = new Set();
const drop = [];
for (const f of found) {
  if (seen.has(f.name)) drop.push(f.i);
  else seen.add(f.name);
}

if (drop.length) {
  drop.sort((a, b) => b - a).forEach(i => { console.log('  ✂ removing duplicate at line ' + (i + 1) + ': ' + lines[i].trim()); lines.splice(i, 1); });
  fs.writeFileSync(ap, lines.join('\n'));
  console.log('\n✅ removed ' + drop.length + ' duplicate declaration(s)');
} else {
  console.log('\nℹ️ no duplicates');
}

/* the survivors must point at the real tables */
const after = fs.readFileSync(ap, 'utf8');
for (const [name, want] of [['TABLE', 'scanprintuser'], ['H', null]]) {
  const m = after.match(new RegExp('(?:const|let|var)\\s+' + name + '\\s*=\\s*[\'"]([^\'"]+)[\'"]'));
  if (!m) { console.log('❌ ' + name + ' has no literal declaration'); process.exit(1); }
  console.log('  ' + name + ' → ' + m[1]);
  if (want && m[1] !== want) { console.log('⚠️ ' + name + ' should be ' + want); }
}
