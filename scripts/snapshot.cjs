const fs = require('fs'); const path = require('path');
const root = process.cwd();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.join(root, 'backups', 'v-' + stamp);
fs.mkdirSync(dir, { recursive: true });
const items = ['src', 'package.json', 'vite.config.js', 'capacitor.config.json', 'index.html'];
for (const it of items) {
  const src = path.join(root, it);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, it), { recursive: true });
}
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ stamp, note: process.argv[2] || 'working snapshot' }, null, 2));
console.log('✅ Snapshot saved: backups/v-' + stamp);
