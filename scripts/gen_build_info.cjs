const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const now = new Date();
const code = `/* Auto-generated at build time — do not edit */
export const APP_VERSION = ${JSON.stringify(pkg.version || '1.0.0')};
export const APP_BUILD_DATE = ${JSON.stringify(now.toISOString())};
export const APP_BUILD_LABEL = ${JSON.stringify(now.toLocaleString())};
`;
fs.writeFileSync('src/buildInfo.js', code);
console.log('✅ buildInfo.js → version', pkg.version, '| built', now.toLocaleString());
