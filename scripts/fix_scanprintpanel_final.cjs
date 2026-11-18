const fs = require('fs');
const path = require('path');

// Find the file
const possiblePaths = [
  'src/components/ScanPrintPanel.jsx',
  'scan-print-app/src/components/ScanPrintPanel.jsx',
  '../src/components/ScanPrintPanel.jsx'
];

let filePath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) {
    filePath = p;
    break;
  }
}

if (!filePath) {
  console.log('❌ Could not find ScanPrintPanel.jsx');
  console.log('Current directory:', process.cwd());
  console.log('Files in current dir:', fs.readdirSync('.'));
  process.exit(1);
}

console.log('✅ Found:', filePath);
let content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

// Show lines around the error
console.log('\n--- Lines 240-250 (error at 245) ---');
for (let i = 239; i < 250 && i < lines.length; i++) {
  console.log(`${i + 1}: ${lines[i]}`);
}

// Fix 1: Replace ALL instances of problematic "photo prints" spans with safe concatenation
const badPatterns = [
  /<span[^>]*fontWeight:\s*700[^>]*>[\s\S]*?photo prints[\s\S]*?<\/span>/g,
  /<span[^>]*>[^<]*photo prints[^<]*<\/span>/g
];

let fixed = content;
for (const pattern of badPatterns) {
  if (pattern.test(fixed)) {
    const safeSpan = `<span style={{ fontSize: '11px', color: '#047857', marginLeft: '10px', fontWeight: 700 }}>
                {('photo prints ' + (35 - 2 * passportPad).toFixed(1) + ' × ' + (45 - 2 * passportPad).toFixed(1) + ' mm')}
              </span>`;
    fixed = fixed.replace(pattern, safeSpan);
    console.log('✅ Fixed: photo prints span');
  }
}

// Fix 2: Check for any line with } that's not in a code block (heuristic)
console.log('\n--- Checking for potential JSX syntax issues ---');
const problemLines = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Look for lines that have } but no { and aren't closing tags or JS
  if (line.includes('}') && !line.includes('{') && !line.trim().startsWith('//')) {
    if (line.includes('photo prints') || line.includes('mm padding') || line.includes('passportPad')) {
      problemLines.push({ num: i + 1, line: line.trim() });
    }
  }
}

if (problemLines.length > 0) {
  console.log('⚠️  Potential issues found:');
  problemLines.forEach(p => console.log(`  Line ${p.num}: ${p.line}`));
}

// Fix 3: Ensure all JSX tags are balanced (rough check)
const openTags = (content.match(/<[A-Z][a-zA-Z0-9]*[\s/>]/g) || []).length;
const closeTags = (content.match(/<\/[A-Z][a-zA-Z0-9]*>/g) || []).length;
console.log(`\nJSX balance: ~${openTags} opening tags, ~${closeTags} closing tags`);

// Write the fixed content
if (fixed !== content) {
  fs.writeFileSync(filePath, fixed);
  console.log('\n✅ File updated with fixes');
} else {
  console.log('\n⚠️  No changes made - patterns not found');
  console.log('Please manually check line 245 in', filePath);
}

console.log('\n--- Showing lines 243-247 for manual inspection ---');
for (let i = 242; i < 247 && i < lines.length; i++) {
  console.log(`${i + 1}: ${lines[i]}`);
}
