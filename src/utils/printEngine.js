import { loadImage, trimWhitespace, PRINT_SIZES } from './imageUtils.js';
import { blobToBase64, shareBlob } from './compressEngine.js';
import { nativePrint } from './nativePrinter.js';

export const DEFAULT_ADJ = { zoom: 1, x: 0, y: 0, rot: 0, fit: 'contain', brightness: 100, contrast: 100, crop: { x: 0, y: 0, w: 1, h: 1 } };

/* ---- print resolution: 300 DPI is the base grid, everything scales from it ---- */
let DPI = 300;
export function setPrintDpi(d) { DPI = [150, 200, 300, 400, 600].includes(Number(d)) ? Number(d) : 300; }
export function getPrintDpi() { return DPI; }
const sc = v => Math.round(v * (DPI / 300));

function drawCover(ctx, img, x, y, w, h, adj = {}) {
  const zoom = Math.max(0.2, adj.zoom || 1);
  const s = Math.max(w / img.width, h / img.height) * zoom;
  const dw = img.width * s, dh = img.height * s;
  const dx = x + (w - dw) / 2 + ((adj.x || 0) / 100) * w;
  const dy = y + (h - dh) / 2 + ((adj.y || 0) / 100) * h;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(((adj.rotate || 0) * Math.PI) / 180);
  ctx.translate(-(x + w / 2), -(y + h / 2));
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

function drawAdjusted(ctx, img, x, y, w, h, adj = {}) {
  const a = { ...DEFAULT_ADJ, ...adj };
  const cr = a.crop || { x: 0, y: 0, w: 1, h: 1 };
  const sx = img.width * cr.x, sy = img.height * cr.y;
  const sw = Math.max(1, img.width * cr.w), sh = Math.max(1, img.height * cr.h);
  const cropActive = cr.w < 0.999 || cr.h < 0.999 || cr.x > 0.001 || cr.y > 0.001;
  const fitMode = cropActive ? 'contain' : a.fit;
  const base = fitMode === 'cover' ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh);
  const s = base * a.zoom;
  const dw = sw * s, dh = sh * s;
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.filter = `brightness(${a.brightness}%) contrast(${a.contrast}%)`;
  ctx.translate(x + w / 2 + (a.x / 100) * w, y + h / 2 + (a.y / 100) * h);
  ctx.rotate((a.rot * Math.PI) / 180);
  ctx.drawImage(img, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}
function border(ctx, x, y, w, h, dashed) {
  ctx.save();
  ctx.strokeStyle = dashed ? '#9aa3af' : '#111';
  ctx.lineWidth = Math.max(1, sc(2));
  if (dashed) ctx.setLineDash([sc(10), sc(5)]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}
function expand(images, n) {
  if (!images.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(images[i % images.length]);
  return out;
}

export function createIdCardSheets(urls, adj) {
  const a4W = sc(2480), a4H = sc(3508), cW = sc(1013), cH = sc(638), mX = sc(120), mY = sc(120), g = sc(40);
  const list = urls.length === 1 ? [urls[0], urls[0]] : urls;
  return Promise.all(list.map(loadImage)).then((imgs) => {
    const sheets = [];
    for (let i = 0; i < imgs.length; i += 2) {
      const c = document.createElement('canvas'); c.width = a4W; c.height = a4H;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, a4W, a4H);
      drawAdjusted(ctx, imgs[i], mX, mY, cW, cH, adj); border(ctx, mX, mY, cW, cH, false);
      if (imgs[i + 1]) { drawAdjusted(ctx, imgs[i + 1], mX + cW + g, mY, cW, cH, adj); border(ctx, mX + cW + g, mY, cW, cH, false); }
      sheets.push(c.toDataURL('image/jpeg', 0.92));
    }
    return sheets;
  });
}
export function createIdCardLayout(f, b, adj) { return createIdCardSheets([f, b], adj).then(s => s[0]); }

export function createCardGridLayout(urls, paperSizeKey, adj) {
  const p = PRINT_SIZES[paperSizeKey];
  const W = sc(p.width), H = sc(p.height);
  const cW = sc(1013), cH = sc(638), g = sc(20), m = sc(40);
  const cols = Math.max(1, Math.floor((W - 2 * m + g) / (cW + g)));
  const rows = Math.max(1, Math.floor((H - 2 * m + g) / (cH + g)));
  const ps = cols * rows, sheetCount = Math.ceil(urls.length / ps);
  return Promise.all(urls.map(loadImage)).then(imgs => {
    const pages = [];
    for (let s = 0; s < sheetCount; s++) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      imgs.slice(s * ps, (s + 1) * ps).forEach((img, i) => {
        const r = Math.floor(i / cols), co = i % cols;
        const x = m + co * (cW + g), y = m + r * (cH + g);
        drawAdjusted(ctx, img, x, y, cW, cH, adj); border(ctx, x, y, cW, cH, false);
      });
      pages.push(c.toDataURL('image/jpeg', 0.92));
    }
    return pages;
  });
}

function tileWhole(imgs, cols, rows, paper, adj) {
  const W = sc(paper.width), H = sc(paper.height);
  const m = sc(16), g = sc(16);
  const cW = (W - 2 * m - (cols - 1) * g) / cols;
  const cH = (H - 2 * m - (rows - 1) * g) / rows;
  const ps = cols * rows, sheetCount = Math.ceil(imgs.length / ps);
  const pages = [];
  for (let s = 0; s < sheetCount; s++) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    imgs.slice(s * ps, (s + 1) * ps).forEach((img, i) => {
      const r = Math.floor(i / cols), co = i % cols;
      drawAdjusted(ctx, img, m + co * (cW + g), m + r * (cH + g), cW, cH, adj);
    });
    pages.push(c.toDataURL('image/jpeg', 0.92));
  }
  return pages;
}
export function createNUpLayout(urls, arg2, arg3, adj) {
  let pp, pk;
  if (typeof arg2 === 'number') { pp = arg2; pk = arg3; } else { pk = arg2; pp = arg3; }
  const g = { 1: [1, 1], 2: [1, 2], 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3], 16: [4, 4] };
  const [c, r] = g[pp] || [1, 1];
  return Promise.all(urls.map(loadImage)).then(imgs => tileWhole(imgs, c, r, PRINT_SIZES[pk] || PRINT_SIZES['A4'], adj));
}
export function createFrontBackNUpSheets(urls, pp, pk, adj) {
  const p = PRINT_SIZES[pk] || PRINT_SIZES['A4'];
  return Promise.all(urls.map(loadImage)).then(imgs => tileWhole(imgs, 2, Math.max(1, Math.round(pp / 2)), p, adj));
}

/* PASSPORT: fixed 6 across the top line, 35×45 mm cells, white padding on 4 sides, multi-sheet */
function sheetMetrics(paper, cellWmm, cellHmm, grid) {
  const W = sc(paper.width), H = sc(paper.height);
  const toMm = v => { const n = parseFloat(v); return /in$/.test(String(v)) ? n * 25.4 : n; };
  const sheetWmm = toMm(paper.cssWidth), sheetHmm = toMm(paper.cssHeight);
  const isoCols = Math.max(1, Math.floor(sheetWmm / cellWmm + 1e-4));
  const isoRows = Math.max(1, Math.floor(sheetHmm / cellHmm + 1e-4));
  const g = grid || {};
  const fill = g.fill !== false;
  const cols = fill ? Math.max(1, Math.min(24, g.cols || isoCols)) : isoCols;
  const rows = fill ? Math.max(1, Math.min(24, g.rows || isoRows)) : isoRows;
  const CW = fill ? Math.floor(W / cols) : Math.floor(W * cellWmm / sheetWmm);
  const CH = fill ? Math.floor(H / rows) : Math.floor(H * cellHmm / sheetHmm);
  return { W, H, cols, rows, CW, CH, perSheet: cols * rows, fill, sheetWmm, sheetHmm };
}

function newSheetCanvas(W, H) {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  return { c, ctx };
}

function stampCell(ctx, img, x, y, cw, ch, pad, adj, cover) {
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, cw, ch);
  if (cover) drawCover(ctx, img, x + pad, y + pad, cw - 2 * pad, ch - 2 * pad, adj);
  else drawAdjusted(ctx, img, x + pad, y + pad, cw - 2 * pad, ch - 2 * pad, adj);
  border(ctx, x + pad, y + pad, cw - 2 * pad, ch - 2 * pad, true);
}

export function createPassportLayout(dataUrls, perPage, colsArg, pk, adj, padMm, grid) {
  const list = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const paper = PRINT_SIZES[pk] || PRINT_SIZES['A4'];
  const m = sheetMetrics(paper, 35, 45, grid);
  const PAD = Math.max(0, Math.round((padMm == null ? 1 : padMm) / 25.4 * DPI));
  const n = Math.max(1, perPage || m.perSheet);
  const filled = expand(list, n);
  return Promise.all(filled.map(loadImage)).then(imgs => {
    const sheets = [];
    for (let start = 0; start < n; start += m.perSheet) {
      const count = Math.min(m.perSheet, n - start);
      const { c, ctx } = newSheetCanvas(m.W, m.H);
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / m.cols), co = i % m.cols;
        stampCell(ctx, imgs[start + i], co * m.CW, r * m.CH, m.CW, m.CH, PAD, adj);
      }
      sheets.push(c.toDataURL('image/jpeg', 0.92));
    }
    return sheets;
  });
}

function fitContainAdjusted(dataUrl, cfg, adj) {
  return loadImage(dataUrl).then(img => {
    const W = sc(cfg.width), H = sc(cfg.height);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const a = adj || {};
    const zoom = Math.max(0.2, a.zoom || 1);
    /* zoom 1 (= 0%) draws the source page edge-to-edge on the sheet, exactly as the original */
    const dw = W * zoom, dh = H * zoom;
    const dx = (W - dw) / 2 + ((a.x || 0) / 100) * W;
    const dy = (H - dh) / 2 + ((a.y || 0) / 100) * H;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(((a.rotate || 0) * Math.PI) / 180);
    ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return c.toDataURL('image/jpeg', 0.92);
  });
}

function fitCoverAdjusted(dataUrl, cfg, adj) {
  return loadImage(dataUrl).then(img => {
    const W = sc(cfg.width), H = sc(cfg.height);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const a = adj || {};
    const zoom = Math.max(0.2, a.zoom || 1);
    const s = Math.max(W / img.width, H / img.height) * zoom;
    const dw = img.width * s, dh = img.height * s;
    const dx = (W - dw) / 2 + ((a.x || 0) / 100) * W;
    const dy = (H - dh) / 2 + ((a.y || 0) / 100) * H;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(((a.rotate || 0) * Math.PI) / 180);
    ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return c.toDataURL('image/jpeg', 0.92);
  });
}

function fitAdjusted(dataUrl, cfg, adj) {
  return loadImage(dataUrl).then(img => {
    const W = sc(cfg.width), H = sc(cfg.height);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    drawAdjusted(ctx, img, 0, 0, W, H, adj);
    return c.toDataURL('image/jpeg', 0.88);
  });
}

export async function composePrintPages(images, o) {
  if (o.dpi) setPrintDpi(o.dpi);
  const adj = o.adj || {};
  const cfg = PRINT_SIZES[o.sizeKey];
  const copies = Math.max(1, o.copies || 1);
  let pages = [], cssW = cfg.cssWidth, cssH = cfg.cssHeight;
  const repeat = (arr) => { for (let k = 0; k < copies; k++) pages.push(...arr); };
  const paper = o.passportPaper || 'A4';
  const pad = o.passportPad == null ? 1 : o.passportPad;

  if (cfg.isIdCard) {
    repeat(await createIdCardSheets(images, adj));
    cssW = PRINT_SIZES['A4'].cssWidth; cssH = PRINT_SIZES['A4'].cssHeight;
  } else if (cfg.isPassport) {
    if (o.mixStamp && o.mixStamp !== 'none' && (o.stampPerPage || 0) > 0) {
      const dims = o.mixStamp === '25x30' ? [25, 30] : [20, 25];
      repeat(await createMixLayout(images, o.passportPerPage, o.stampPerPage, paper, adj, pad, dims[0], dims[1], o.grid));
    } else {
      repeat(await createPassportLayout(images, o.passportPerPage, o.grid && o.grid.cols, paper, adj, pad, o.grid));
    }
    cssW = PRINT_SIZES[paper].cssWidth; cssH = PRINT_SIZES[paper].cssHeight;
  } else if (cfg.isStamp) {
    repeat(await createStampLayout(images, o.stampPerPage || o.passportPerPage, paper, adj, pad, cfg.cellW, cfg.cellH, o.grid));
    cssW = PRINT_SIZES[paper].cssWidth; cssH = PRINT_SIZES[paper].cssHeight;
  } else if (cfg.isMix) {
    repeat(await createMixLayout(images, o.passportPerPage || 6, o.stampPerPage || 20, paper, adj, pad));
    cssW = PRINT_SIZES[paper].cssWidth; cssH = PRINT_SIZES[paper].cssHeight;
  } else if (o.sizeKey === '4x6 Photo') {
    repeat(await createStampLayout(images, o.stampPerPage || o.passportPerPage, paper, adj, pad, 101.6, 152.4, { fill: false, cover: true }));
    cssW = PRINT_SIZES[paper].cssWidth; cssH = PRINT_SIZES[paper].cssHeight;
  } else if (o.sizeKey === 'A4' && o.sideMode === 'double') {
    const per = Math.max(2, 2 * Math.round((o.pagesPerSheet || 2) / 2));
    const total = Math.max(images.length, per);
    repeat(await createFrontBackNUpSheets(expand(images, Math.ceil(total / per) * per), per, 'A4', adj));
  } else if ((o.sizeKey === 'A4' || o.sizeKey === '4x6 Photo') && (o.pagesPerSheet || 1) > 1) {
    const per = o.pagesPerSheet;
    const total = Math.max(images.length, per);
    repeat(await createNUpLayout(expand(images, Math.ceil(total / per) * per), per, o.sizeKey, adj));
  } else {
    const one = [];
    for (const img of images) one.push(o.sizeKey === 'A4' ? await fitContainAdjusted(img, cfg, adj) : (o.sizeKey === '4x6 Photo' ? await fitCoverAdjusted(img, cfg, adj) : await fitAdjusted(img, cfg, adj)));
    repeat(one);
  }
  return { pages, cssW, cssH };
}

function toPt(v) {
  if (/mm$/.test(v)) return (parseFloat(v) / 25.4) * 72;
  if (/in$/.test(v)) return parseFloat(v) * 72;
  return parseFloat(v);
}
async function toJpegPages(pages) {
  return Promise.all(pages.map(async (p) => {
    const img = await loadImage(p);
    const MAX = sc(1600);           // fast print path; still scales with chosen DPI
    let w = img.width, h = img.height;
    if (Math.max(w, h) > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.88);
  }));
}
export async function buildPdfBlob(pages, widthCSS, heightCSS) {
  const { jsPDF } = await import('jspdf');
  const jpeg = await toJpegPages(pages);
  const wPt = toPt(widthCSS), hPt = toPt(heightCSS);
  const pdf = new jsPDF({ unit: 'pt', format: [wPt, hPt], compress: true });
  for (let i = 0; i < jpeg.length; i++) {
    if (i > 0) pdf.addPage([wPt, hPt]);
    pdf.addImage(jpeg[i], 'JPEG', 0, 0, wPt, hPt, undefined, 'FAST');
  }
  return pdf.output('blob');
}
function iframePrint(pages, widthCSS, heightCSS) {
  return new Promise((resolve) => {
    const old = document.getElementById('scanprint-print-frame');
    if (old) old.remove();
    const iframe = document.createElement('iframe');
    iframe.id = 'scanprint-print-frame';
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    const html = pages.map(p => `<div class="page"><img src="${p}" /></div>`).join('');
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><style>
      @page { size: ${widthCSS} ${heightCSS}; margin: 0; }
      html, body { margin: 0; padding: 0; background: white; }
      .page { width: ${widthCSS}; height: ${heightCSS}; page-break-after: always; display:flex; align-items:center; justify-content:center; }
      .page:last-child { page-break-after: auto; }
      .page img { width:100%; height:100%; object-fit:contain; }
    </style></head><body>${html}</body></html>`);
    doc.close();
    setTimeout(() => {
      try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (e) {}
      setTimeout(() => { if (iframe.parentNode) iframe.removeChild(iframe); resolve(); }, 1000);
    }, 600);
  });
}
export async function printImage(pages, widthCSS, heightCSS) {
  const jpeg = await toJpegPages(pages);
  const blob = await buildPdfBlob(jpeg, widthCSS, heightCSS);
  const b64 = await blobToBase64(blob);
  if (await nativePrint(b64, 'ScanPrint-' + Date.now())) return;
  try { await shareBlob(blob, 'scanprint-' + Date.now() + '.pdf'); return; }
  catch (e) { console.warn('share failed', e); }
  await iframePrint(jpeg, widthCSS, heightCSS);
}

/* ── STAMP 25×30 mm, 8 across A4 ── */
export function createStampLayout(dataUrls, perPage, pk, adj, padMm, cellWmm, cellHmm, grid) {
  const list = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const paper = PRINT_SIZES[pk] || PRINT_SIZES['A4'];
  const m = sheetMetrics(paper, cellWmm || 20, cellHmm || 25, grid);
  const PAD = Math.max(0, Math.round((padMm == null ? 0.5 : padMm) / 25.4 * DPI));
  const n = Math.max(1, perPage || m.perSheet);
  const filled = expand(list, n);
  return Promise.all(filled.map(loadImage)).then(imgs => {
    const sheets = [];
    for (let start = 0; start < n; start += m.perSheet) {
      const count = Math.min(m.perSheet, n - start);
      const { c, ctx } = newSheetCanvas(m.W, m.H);
      for (let i = 0; i < count; i++) {
        const r = Math.floor(i / m.cols), co = i % m.cols;
        stampCell(ctx, imgs[start + i], co * m.CW, r * m.CH, m.CW, m.CH, PAD, adj, (grid || {}).cover);
      }
      sheets.push(c.toDataURL('image/jpeg', 0.92));
    }
    return sheets;
  });
}

/* ── MIXED: passport rows (6×35×45) then stamp rows (8×25×30), packed per sheet ── */
export function createMixLayout(dataUrls, passportCount, stampCount, pk, adj, padMm, stampWmm, stampHmm, grid) {
  const list = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const paper = PRINT_SIZES[pk] || PRINT_SIZES['A4'];
  const W = sc(paper.width), H = sc(paper.height);
  const toMm = v => { const n = parseFloat(v); return /in$/.test(String(v)) ? n * 25.4 : n; };
  const sheetWmm = toMm(paper.cssWidth), sheetHmm = toMm(paper.cssHeight);
  const SW = stampWmm || 20, SH = stampHmm || 25;
  const g = grid || {};
  const wantFill = g.fill !== false;
  const pIso = Math.max(1, Math.floor(sheetWmm / 35 + 1e-4));
  const sIso = Math.max(1, Math.floor(sheetWmm / SW + 1e-4));
  const pCols = wantFill ? Math.max(1, Math.min(24, g.cols || pIso)) : pIso;
  const sCols = sIso;
  const nP = Math.max(0, passportCount == null ? pCols : passportCount);
  const nS = Math.max(0, stampCount == null ? 0 : stampCount);
  const pRows = Math.ceil(nP / pCols), sRows = Math.ceil(nS / sCols);
  const P_W = wantFill ? Math.floor(W / pCols) : Math.floor(W * 35 / sheetWmm);
  const S_W = wantFill ? Math.floor(W / sCols) : Math.floor(W * SW / sheetWmm);
  const isoP_H = Math.floor(H * 45 / sheetHmm), isoS_H = Math.floor(H * SH / sheetHmm);
  const natural = pRows * isoP_H + sRows * isoS_H;
  const onePage = wantFill && natural > 0 && natural <= H;
  let P_H = isoP_H, S_H = isoS_H;
  if (onePage) { const k = H / natural; P_H = Math.floor(isoP_H * k); S_H = Math.floor(isoS_H * k); }
  const PAD = Math.max(0, Math.round((padMm == null ? 1 : padMm) / 25.4 * DPI));
  const total = Math.max(1, nP + nS);
  const filled = expand(list, total);

  return Promise.all(filled.map(loadImage)).then(imgs => {
    const sheets = [];
    let cur = newSheetCanvas(W, H), y = 0, idx = 0;
    const roll = () => { sheets.push(cur.c.toDataURL('image/jpeg', 0.92)); cur = newSheetCanvas(W, H); y = 0; };

    for (let r = 0; r < pRows; r++) {
      if (y + P_H > H) roll();
      const inRow = Math.min(pCols, nP - r * pCols);
      for (let co = 0; co < inRow; co++) { stampCell(cur.ctx, imgs[idx], co * P_W, y, P_W, P_H, PAD, adj); idx++; }
      y += P_H;
    }
    for (let r = 0; r < sRows; r++) {
      if (y + S_H > H) roll();
      const inRow = Math.min(sCols, nS - r * sCols);
      for (let co = 0; co < inRow; co++) { stampCell(cur.ctx, imgs[idx], co * S_W, y, S_W, S_H, PAD, adj); idx++; }
      y += S_H;
    }
    sheets.push(cur.c.toDataURL('image/jpeg', 0.92));
    return sheets;
  });
}
