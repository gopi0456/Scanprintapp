const fs = require('fs');
const sp = 'src/components/ScanPrintPanel.jsx';
let s = fs.readFileSync(sp, 'utf8');

/* ── show every candidate so nothing is guessed ── */
const lines = s.split('\n');
console.log('── lines mentioning Passport (2x2) ──');
lines.forEach((l, i) => { if (l.includes('Passport (2x2)')) console.log(`  ${i + 1}: ${l.trim().slice(0, 120)}`); });

/* ── 1. state ── */
if (!s.includes('mixStamp')) {
  const st = s.match(/[ \t]*const \[stampPerPage, setStampPerPage\] = useState\(\d+\);/);
  if (st) {
    s = s.replace(st[0], st[0] + "\n  const [mixStamp, setMixStamp] = useState('none');");
    console.log('✅ mixStamp state added');
  } else { console.log('❌ stampPerPage state not found'); process.exit(1); }
} else console.log('ℹ️ mixStamp state present');

/* ── 2. opts ── */
if (!/mixStamp/.test(s.match(/const opts = \(forPreview\) => \(\{[\s\S]*?\}\);/)?.[0] || '')) {
  const o = s.match(/const opts = \(forPreview\) => \(\{[\s\S]*?\}\);/);
  if (o) {
    const updated = o[0].replace(/stampPerPage,/, 'stampPerPage, mixStamp,');
    if (updated !== o[0]) { s = s.replace(o[0], updated); console.log('✅ opts() passes mixStamp'); }
    else {
      const alt = o[0].replace(/passportPad,/, 'passportPad, mixStamp,');
      s = s.replace(o[0], alt);
      console.log('✅ opts() passes mixStamp (after passportPad)');
    }
  } else { console.log('❌ opts() not found'); process.exit(1); }
} else console.log('ℹ️ opts already has mixStamp');

/* ── 3. preview deps ── */
const dep = s.match(/\}, \[printImages, included, selectedSize[^\]]*\]\);/);
if (dep && !dep[0].includes('mixStamp')) {
  s = s.replace(dep[0], dep[0].replace(/stampPerPage,/, 'stampPerPage, mixStamp,').replace(/passportPad,/, (m) => dep[0].includes('stampPerPage') ? m : m + ' mixStamp,'));
  console.log('✅ preview deps include mixStamp');
} else console.log('ℹ️ deps ok');

/* ── 4. the dropdown — tolerant whitespace match ── */
if (s.includes('No stamp — passport only')) {
  console.log('ℹ️ dropdown already present');
} else {
  const rx = /\{\s*selectedSize\s*===\s*'Passport \(2x2\)'\s*&&\s*\(/;
  const m = s.match(rx);
  if (!m) {
    console.log('❌ no JSX block for Passport (2x2). Paste the grep output above so I can target it exactly.');
    fs.writeFileSync(sp, s);   /* keep state/opts/deps progress */
    process.exit(1);
  }
  console.log('✅ anchor matched: ' + m[0]);
  const DROPDOWN = `
          <div className="workflow-card settings-card">
            <div className="card-content"><span className="icon">📮</span>
              <select value={mixStamp} onChange={e => { const v = e.target.value; setMixStamp(v); if (v !== 'none' && (!stampPerPage || stampPerPage < 1)) setStampPerPage(10); }} className="neon-select">
                <option value="none">No stamp — passport only</option>
                <option value="20x25">Add stamp 20 × 25 mm</option>
                <option value="25x30">Add stamp 25 × 30 mm</option>
              </select>
            </div>
            <div className="check-icon">✓</div>
          </div>
          {mixStamp !== 'none' && (
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">🔢</span>
                <input type="number" min="0" max="120" value={stampPerPage} onChange={e => setStampPerPage(Math.max(0, parseInt(e.target.value) || 0))} className="neon-input" />
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>
                  {mixStamp === '25x30' ? 'stamps (25×30 mm)' : 'stamps (20×25 mm)'}
                </span>
                <button className="em-step" style={{ marginLeft: '10px' }} onClick={() => { setMixStamp('none'); setStampPerPage(0); }}>clear</button>
              </div>
              <div className="check-icon">✓</div>
            </div>
          )}`;
  s = s.replace(m[0], m[0] + DROPDOWN);
  console.log('✅ stamp dropdown inserted inside the Passport menu');
}

fs.writeFileSync(sp, s);
console.log('\n✅ panel saved');
