const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
};

let bad = 0;
for (const f of walk('src')) {
  const tmp = '.syntax-check.mjs';
  fs.copyFileSync(f, tmp);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    console.log('  ✅ ' + f);
  } catch (e) {
    bad++;
    console.log('  ❌ ' + f);
    console.log(String(e.stderr || e.stdout || e.message).split('\n').slice(0, 8).join('\n'));
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) {}
  }
}
if (bad) { console.log('\n❌ ' + bad + ' file(s) failed syntax check — not building'); process.exit(1); }
console.log('\n✅ every JS module parses cleanly');
