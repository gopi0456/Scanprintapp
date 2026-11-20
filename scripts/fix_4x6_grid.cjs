const fs = require('fs');
const must = (c, m) => { if (!c) { console.log('❌ ' + m); process.exit(1); } };

/* ═══ 1. printEngine: 4x6 = exact 101.6 x 152.4 mm cells tiled on the paper ═══ */
const pe = 'src/utils/printEngine.js';
let p = fs.readFileSync(pe, 'utf8');
const ANCHOR = "} else if (o.sizeKey === 'A4' && o.sideMode === 'double') {";
must(p.includes(ANCHOR), 'double-side branch anchor');
if (!p.includes("o.sizeKey === '4x6 Photo') {\n    repeat(await createStampLayout")) {
  p = p.replace(ANCHOR, `} else if (o.sizeKey === '4x6 Photo') {
    repeat(await createStampLayout(images, o.stampPerPage || o.passportPerPage, paper, adj, pad, 101.6, 152.4, { fill: false }));
    cssW = PRINT_SIZES[paper].cssWidth; cssH = PRINT_SIZES[paper].cssHeight;
  ` + ANCHOR);
  fs.writeFileSync(pe, p);
  console.log('✅ 4x6 tiles exact-size cells from top-left, remainder empty');
} else console.log('ℹ️ 4x6 branch present');

/* capacity math for the report */
const toMm = v => parseFloat(v);
for (const [pw, ph] of [[210, 297], [101.6, 152.4]]) {
  const cols = Math.floor(pw / 101.6 + 1e-4), rows = Math.floor(ph / 152.4 + 1e-4);
  console.log(`   paper ${pw}x${ph}mm → ${cols} x ${rows} = ${cols * rows} per sheet`);
}

/* ═══ 2. ScanPrintPanel: paper, preview, limit, bank, readout for 4x6 ═══ */
const sp = 'src/components/ScanPrintPanel.jsx';
let s = fs.readFileSync(sp, 'utf8');

const KEY_OLD = "const previewPageKey = (selectedSize === 'ID Card (CR80)' || selectedSize === 'Passport (2x2)' || selectedSize.startsWith('Stamp') || selectedSize === 'Passport + Stamp Mix') ? (selectedSize === 'ID Card (CR80)' ? 'A4' : passportPaperSize) : selectedSize;";
const KEY_NEW = "const previewPageKey = (selectedSize === 'ID Card (CR80)' || selectedSize === 'Passport (2x2)' || selectedSize.startsWith('Stamp') || selectedSize === '4x6 Photo' || selectedSize === 'Passport + Stamp Mix') ? (selectedSize === 'ID Card (CR80)' ? 'A4' : passportPaperSize) : selectedSize;";
must(s.includes(KEY_OLD), 'previewPageKey anchor');
s = s.replace(KEY_OLD, KEY_NEW);
console.log('✅ 4x6 preview uses the real paper (A4)');

const LIM_OLD = "const isFullSingle = (selectedSize === 'A4' || selectedSize === '4x6 Photo')";
const LIM_NEW = "const isFullSingle = selectedSize === 'A4'";
must(s.includes(LIM_OLD), 'isFullSingle anchor');
s = s.replace(LIM_OLD, LIM_NEW);
const L2_OLD = ": (selectedSize.startsWith('Stamp') || selectedSize === 'Passport (2x2)') ? 4";
const L2_NEW = ": (selectedSize.startsWith('Stamp') || selectedSize === 'Passport (2x2)' || selectedSize === '4x6 Photo') ? Math.min(activeImages.length, 24)";
must(s.includes(L2_OLD), 'limit anchor');
s = s.replace(L2_OLD, L2_NEW);
console.log('✅ 4x6 previews every sheet');

const GATE_OLD = "{(selectedSize === 'Stamp (20x25)' || selectedSize === 'Stamp (25x30)') && (";
const GATE_NEW = "{(selectedSize === 'Stamp (20x25)' || selectedSize === 'Stamp (25x30)' || selectedSize === '4x6 Photo') && (";
must(s.includes(GATE_OLD), 'stamp gate anchor');
s = s.replace(GATE_OLD, GATE_NEW);
console.log('✅ 4x6 gets paper + count + padding + sheet bank');

const ISO_OLD = "const isoW = selectedSize === 'Stamp (20x25)' ? 20 : selectedSize === 'Stamp (25x30)' ? 25 : 35;";
const ISO_NEW = "const isoW = selectedSize === 'Stamp (20x25)' ? 20 : selectedSize === 'Stamp (25x30)' ? 25 : selectedSize === '4x6 Photo' ? 101.6 : 35;";
must(s.includes(ISO_OLD), 'isoW anchor');
s = s.replace(ISO_OLD, ISO_NEW);
const ISOH_OLD = "const isoH = selectedSize === 'Stamp (20x25)' ? 25 : selectedSize === 'Stamp (25x30)' ? 30 : 45;";
const ISOH_NEW = "const isoH = selectedSize === 'Stamp (20x25)' ? 25 : selectedSize === 'Stamp (25x30)' ? 30 : selectedSize === '4x6 Photo' ? 152.4 : 45;";
must(s.includes(ISOH_OLD), 'isoH anchor');
s = s.replace(ISOH_OLD, ISOH_NEW);
console.log('✅ readout shows true 4x6 cell + up-count + sheets');

const OPT_OLD = 'grid: { cols: gridCols, rows: gridRows, fill: fillSheet } });';
const OPT_NEW = "grid: { cols: gridCols, rows: gridRows, fill: selectedSize === '4x6 Photo' ? false : fillSheet } });";
must(s.includes(OPT_OLD), 'opts grid anchor');
s = s.replace(OPT_OLD, OPT_NEW);
console.log('✅ 4x6 always uses exact cells (never stretched)');

fs.writeFileSync(sp, s);
