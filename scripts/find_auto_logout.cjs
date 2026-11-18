const fs = require('fs');
const path = require('path');

const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
};

const files = walk('src');
let found = 0;

for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/logoutLocal\(\)|performLogout\(\)|setSession\(null\)/.test(line)) {
      console.log(`\n${f}:${i + 1}`);
      for (let k = Math.max(0, i - 3); k <= Math.min(lines.length - 1, i + 2); k++) {
        console.log(`  ${k + 1}: ${lines[k]}`);
      }
      found++;
    }
  });
}

console.log(`\n\nFound ${found} logout-related calls`);
