const fs = require('fs'); const path = require('path');
const root = process.cwd();
const target = process.argv[2];
const bdir = path.join(root, 'backups');
if (!fs.existsSync(bdir)) { console.log('No backups yet.'); process.exit(1); }
let chosen = target ? path.join(bdir, target) : null;
if (!chosen || !fs.existsSync(chosen)) {
  const list = fs.readdirSync(bdir).filter(d => d.startsWith('v-')).sort();
  chosen = path.join(bdir, list[list.length - 1]);
}
if (!chosen || !fs.existsSync(chosen)) { console.log('No valid backup found.'); process.exit(1); }
for (const it of ['src', 'package.json', 'vite.config.js', 'capacitor.config.json', 'index.html']) {
  const src = path.join(chosen, it);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(root, it), { recursive: true });
}
console.log('✅ Restored from: ' + path.basename(chosen));
