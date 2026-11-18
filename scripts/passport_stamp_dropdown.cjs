const fs = require('fs');
const must = (c, m) => { if (!c) { console.log('❌ ' + m); process.exit(1); } };
function extractFn(src, name) {
  let a = src.indexOf('export function ' + name + '(');
  if (a < 0) a = src.indexOf('export async function ' + name + '(');
  if (a < 0) return null;
  const open = src.indexOf('{', a);
  let d = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) { i++; break; } }
  }
  return { start: a, end: i };
}

/* ═══ 1. Drop the standalone mix entry — it now lives inside Passport ═══ */
const iu = 'src/utils/imageUtils.js';
let u = fs.readFileSync(iu, 'utf8');
const MIXLINE = "  'Passport + Stamp Mix': { width: 2480, height: 3508, cssWidth: '210mm', cssHeight: '297mm', isMix: true }\n";
if (u.includes(MIXLINE)) {
  u = u.replace(MIXLINE, '');
  u = u.replace(/isStamp: true, cellW: 25, cellH: 30 \},\n\};/, 'isStamp: true, cellW: 25, cellH: 30 }\n};');
  fs.writeFileSync(iu, u);
  console.log('✅ removed standalone mix size (now a Passport sub-option)');
} else console.log('ℹ️ mix entry already removed');

/* ═══ 2. Mix layout: mm-based columns (DPI-proof) + optional stamp size ═══ */
const pe = 'src/utils/printEngine.js';
let p = fs.readFileSync(pe, 'utf8');

const MIX = `export function createMixLayout(dataUrls, passportCount, stampCount, pk, adj, padMm, stampWmm, stampHmm) {
  const list = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const paper = PRINT_SIZES[pk] || PRINT_SIZES['A4'];
  const W = sc(paper.width), H = sc(paper.height);
  /* physical sheet size in mm, derived from the 300 DPI base dimensions */
  const sheetWmm = paper.width * 25.4 / 300;
  const sheetHmm = paper.height * 25.4 / 300;
  /* columns come from MILLIMETRES, never pixels — 6 passport across A4 at any DPI */
  const colsFor = mmW => Math.max(1, Math.floor(sheetWmm / mmW + 1e-6));
  const pxW = mmW => Math.floor(W * mmW / sheetWmm);
  const pxH = mmH => Math.floor(H * mmH / sheetHmm);

  const SW = stampWmm || 20, SH = stampHmm || 25;
  const P_W = pxW(35), P_H = pxH(45), pCols = colsFor(35);
  const S_W = pxW(SW), S_H = pxH(SH), sCols = colsFor(SW);
  const PAD = Math.max(0, Math.round((padMm == null ? 1 : padMm) / 25.4 * DPI));

  const nP = Math.max(0, passportCount == null ? 6 : passportCount);
  const nS = Math.max(0, stampCount == null ? 0 : stampCount);
  const total = Math.max(1, nP + nS);
  const filled = expand(list, total);

  return Promise.all(filled.map(loadImage)).then(imgs => {
    const pRows = Math.ceil(nP / pCols);
    const sRows = Math.ceil(nS / sCols);
    const blockH = pRows * P_H + sRows * S_H;
    const originY = Math.max(0, Math.round((H - blockH) / 2));
    const sheets = [];
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    let idx = 0;

    for (let r = 0; r < pRows; r++) {
      const inRow = Math.min(pCols, nP - r * pCols);
      const rowX = Math.max(0, Math.round((W - inRow * P_W) / 2));
      for (let co = 0; co < inRow; co++) {
        const x = rowX + co * P_W, y = originY + r * P_H;
        ctx.fillStyle = '#fff'; ctx.fillRect(x, y, P_W, P_H);
        drawAdjusted(ctx, imgs[idx], x + PAD, y + PAD, P_W - 2 * PAD, P_H - 2 * PAD, adj);
        border(ctx, x + PAD, y + PAD, P_W - 2 * PAD, P_H - 2 * PAD, true);
        idx++;
      }
    }
    for (let r = 0; r < sRows; r++) {
      const inRow = Math.min(sCols, nS - r * sCols);
      const rowX = Math.max(0, Math.round((W - inRow * S_W) / 2));
      for (let co = 0; co < inRow; co++) {
        const x = rowX + co * S_W, y = originY + pRows * P_H + r * S_H;
        ctx.fillStyle = '#fff'; ctx.fillRect(x, y, S_W, S_H);
        drawAdjusted(ctx, imgs[idx], x + PAD, y + PAD, S_W - 2 * PAD, S_H - 2 * PAD, adj);
        border(ctx, x + PAD, y + PAD, S_W - 2 * PAD, S_H - 2 * PAD, true);
        idx++;
      }
    }
    sheets.push(c.toDataURL('image/jpeg', 0.92));
    return sheets;
  });
}`;

const mf = extractFn(p, 'createMixLayout');
must(mf, 'createMixLayout not found');
p = p.slice(0, mf.start) + MIX + p.slice(mf.end);
console.log('✅ createMixLayout: 6 passport across at every DPI, optional stamp size');

/* ═══ 3. Dispatcher: Passport + optional stamps ═══ */
const OLD_BRANCH = `  } else if (cfg.isPassport) {
    repeat(await createPassportLayout(images, o.passportPerPage, o.passportCols, paper, adj, pad));
    cssW = PRINT_SIZES[paper].cssWidth; cssH = PRINT_SIZES[paper].cssHeight;`;
const NEW_BRANCH = `  } else if (cfg.isPassport) {
    if (o.mixStamp && o.mixStamp !== 'none' && (o.stampPerPage || 0) > 0) {
      const dims = o.mixStamp === '25x30' ? [25, 30] : [20, 25];
      repeat(await createMixLayout(images, o.passportPerPage, o.stampPerPage, paper, adj, pad, dims[0], dims[1]));
    } else {
      repeat(await createPassportLayout(images, o.passportPerPage, o.passportCols, paper, adj, pad));
    }
    cssW = PRINT_SIZES[paper].cssWidth; cssH = PRINT_SIZES[paper].cssHeight;`;
must(p.includes(OLD_BRANCH), 'passport branch anchor not found');
p = p.replace(OLD_BRANCH, NEW_BRANCH);
fs.writeFileSync(pe, p);
console.log('✅ Passport branch honours the optional stamp dropdown');

/* ═══ 4. Panel: mixStamp state, opts, deps, and the dropdown UI ═══ */
const sp = 'src/components/ScanPrintPanel.jsx';
let s = fs.readFileSync(sp, 'utf8');

const ST_OLD = '  const [stampPerPage, setStampPerPage] = useState(24);';
must(s.includes(ST_OLD), 'stampPerPage state anchor not found');
if (!s.includes('mixStamp')) {
  s = s.replace(ST_OLD, ST_OLD + "\n  const [mixStamp, setMixStamp] = useState('none');");
  console.log('✅ mixStamp state added');
}

const O_OLD = 'passportPad, stampPad, stampPerPage, stampMode, mixedMode, pagesPerSheet,';
must(s.includes(O_OLD), 'opts anchor not found');
s = s.replace(O_OLD, 'passportPad, stampPad, stampPerPage, mixStamp, stampMode, mixedMode, pagesPerSheet,');
console.log('✅ opts() passes mixStamp');

const D_OLD = 'passportPad, stampPad, stampPerPage, stampMode, mixedMode, pagesPerSheet, printDpi, rangeInput, adj]);';
must(s.includes(D_OLD), 'deps anchor not found');
s = s.replace(D_OLD, 'passportPad, stampPad, stampPerPage, mixStamp, stampMode, mixedMode, pagesPerSheet, printDpi, rangeInput, adj]);');
console.log('✅ preview deps include mixStamp');

const P_BLOCK = "        {selectedSize === 'Passport (2x2)' && (";
must(s.includes(P_BLOCK), 'passport settings block not found');
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
if (!s.includes('No stamp — passport only')) {
  s = s.replace(P_BLOCK, P_BLOCK + DROPDOWN);
  console.log('✅ stamp dropdown inserted inside the Passport menu');
}

/* preview limit: enough source frames for the grid */
s = s.replace(
  "selectedSize.startsWith('Stamp') || selectedSize === 'Passport + Stamp Mix' || selectedSize === 'Passport (2x2)'",
  "selectedSize.startsWith('Stamp') || selectedSize === 'Passport (2x2)'"
);
fs.writeFileSync(sp, s);
