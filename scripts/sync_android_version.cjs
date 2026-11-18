const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const p = 'android/app/build.gradle';
let g = fs.readFileSync(p, 'utf8');
const before = g;
g = g.replace(/versionName\s+["'][^"']+["']/, `versionName "${pkg.version}"`);
g = g.replace(/versionCode\s+(\d+)/, (m, n) => 'versionCode ' + (parseInt(n, 10) + 1));
if (g === before) { console.log('ℹ️ gradle already in sync'); process.exit(0); }
fs.writeFileSync(p, g);
console.log('✅ versionName →', pkg.version, '| versionCode bumped');
