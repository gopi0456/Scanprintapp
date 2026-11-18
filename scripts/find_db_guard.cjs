const fs = require('fs'), path = require('path');
const walk = (d, o = []) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p, o); else if (/\.(js|jsx)$/.test(e.name)) o.push(p);
} return o; };
let hits = 0;
for (const f of walk('src')) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => {
    if (/not connected|YOUR[-_]|PLACEHOLDER|Set URL\/key/i.test(l)) {
      hits++;
      console.log(`\n── ${f}:${i + 1}`);
      for (let k = Math.max(0, i - 6); k <= Math.min(lines.length - 1, i + 2); k++) console.log(`  ${k + 1}: ${lines[k]}`);
    }
  });
}
if (!hits) console.log('✅ no placeholder guard left in src/');
