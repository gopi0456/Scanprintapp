const fs = require('fs');
const must = (c, m) => { if (!c) { console.log('❌ ' + m); process.exit(1); } };

/* ═══ 1. printEngine: whole-page contain fit for A4 / 4x6 (no side cropping) ═══ */
const pe = 'src/utils/printEngine.js';
let p = fs.readFileSync(pe, 'utf8');

const FIT = `function fitContainAdjusted(dataUrl, cfg, adj) {
  return loadImage(dataUrl).then(img => {
    const W = sc(cfg.width), H = sc(cfg.height);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const s = Math.min(W / img.width, H / img.height);
    const w = Math.round(img.width * s), h = Math.round(img.height * s);
    const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
    drawAdjusted(ctx, img, x, y, w, h, adj);
    return c.toDataURL('image/jpeg', 0.92);
  });
}

`;
const OLD_FIT = 'for (const img of images) one.push(await fitAdjusted(img, cfg, adj));';
must(p.includes(OLD_FIT), 'full-page fit line');
if (!p.includes('fitContainAdjusted')) {
  const anchor = 'export async function composePrintPages';
  must(p.includes(anchor), 'composePrintPages anchor');
  p = p.replace(anchor, FIT + anchor);
}
p = p.replace(OLD_FIT, 'for (const img of images) one.push(await fitContainAdjusted(img, cfg, adj));');
fs.writeFileSync(pe, p);
console.log('✅ A4/4x6 now fits the WHOLE page (contain), centred — no left/right crop');

/* ═══ 2. ScanPrintPanel: preview every sheet for full-page single-side mode ═══ */
const sp = 'src/components/ScanPrintPanel.jsx';
let s = fs.readFileSync(sp, 'utf8');
const OLD_LIMIT = "const limit = selectedSize === 'ID Card (CR80)' ? 2 : (selectedSize.startsWith('Stamp') || selectedSize === 'Passport (2x2)') ? 4 : Math.max(2, pagesPerSheet);";
must(s.includes(OLD_LIMIT), 'preview limit line');
s = s.replace(OLD_LIMIT,
  "const isFullSingle = (selectedSize === 'A4' || selectedSize === '4x6 Photo') && sideMode !== 'double' && (pagesPerSheet || 1) <= 1;\n        const limit = selectedSize === 'ID Card (CR80)' ? 2 : (selectedSize.startsWith('Stamp') || selectedSize === 'Passport (2x2)') ? 4 : (isFullSingle ? activeImages.length : Math.max(2, pagesPerSheet));");
fs.writeFileSync(sp, s);
console.log('✅ preview composes ALL uploaded pages (8 pages → 8 sheets, 8 dots)');

/* deps already include activeImages via printImages/included; confirm */
const D = s.match(/\}, \[printImages, included, selectedSize[^\]]*\]\);/);
must(D && D[0].includes('sideMode'), 'deps include sideMode');
console.log('✅ preview deps already cover sideMode + images');
