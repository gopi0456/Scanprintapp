const fs = require('fs');
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };

const pkg = JSON.parse(read('package.json') || '{}');
const bi = read('src/buildInfo.js');
const grab = (src, key) => (src.match(new RegExp(key + "\\s*=\\s*['\"]([^'\"]+)['\"]")) || [])[1] || '—';
const gradle = read('android/app/build.gradle');
const vName = (gradle.match(/versionName\s+["']([^"']+)["']/) || [])[1] || '—';
const vCode = (gradle.match(/versionCode\s+(\d+)/) || [])[1] || '—';

const baked = grab(bi, 'APP_VERSION');
const built = grab(bi, 'APP_BUILD_LABEL');
const stamp = grab(bi, 'APP_BUILD_DATE');

console.log('╭─────────────────────────────────────────────');
console.log('│ package.json      :', pkg.version || '—');
console.log('│ baked APP_VERSION :', baked);
console.log('│ built at          :', built);
console.log('│ build stamp (ISO) :', stamp);
console.log('│ Android versionName:', vName);
console.log('│ Android versionCode:', vCode);
console.log('╰─────────────────────────────────────────────');

let bad = 0;
if (baked !== pkg.version) { console.log('⚠️  buildInfo is stale — run a build (prebuild regenerates it)'); bad++; }
if (vName !== pkg.version) { console.log('⚠️  Android versionName differs from package.json'); bad++; }
if (!bad) console.log('✅ all version markers agree');

console.log('\nPublish this exact string in the admin panel → New version number:');
console.log('   ' + pkg.version);
