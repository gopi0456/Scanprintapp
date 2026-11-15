import { loadImage, trimWhitespace, PRINT_SIZES } from './imageUtils.js';
import { blobToBase64, shareBlob } from './compressEngine.js';
import { nativePrint } from './nativePrinter.js';

export const DEFAULT_ADJ = { zoom: 1, x: 0, y: 0, rot: 0, fit: 'cover', brightness: 100, contrast: 100, crop: { x: 0, y: 0, w: 1, h: 1 } };

// Global crop + transform: editing the single preview applies to ALL cells / pages
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
  ctx.lineWidth = 2;
  if (dashed) ctx.setLineDash([10, 5]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function expand(images, n) {
  if (!images.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(images[i % images.length]);
  return out;
}

// ID CARD: two aligned cells with a small gap; single photo duplicated
export function createIdCardSheets(urls, adj) {
  const a4W = 2480, a4H = 3508, cW = 1013, cH = 638, mX = 120, mY = 120, g = 40;
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
  const cW = 1013, cH = 638, g = 20, m = 40;
  const cols = Math.max(1, Math.floor((p.width - 2 * m + g) / (cW + g)));
  const rows = Math.max(1, Math.floor((p.height - 2 * m + g) / (cH + g)));
  const ps = cols * rows, sc = Math.ceil(urls.length / ps);
  return Promise.all(urls.map(loadImage)).then(imgs => {
    const pages = [];
    for (let s = 0; s < sc; s++) {
      const c = document.createElement('canvas'); c.width = p.width; c.height = p.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, p.width, p.height);
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

// N-up / 4x6: small uniform gap between every tile
function tileWhole(imgs, cols, rows, paper, adj) {
  const m = 16, g = 16;
  const cW = (paper.width - 2 * m - (cols - 1) * g) / cols;
  const cH = (paper.height - 2 * m - (rows - 1) * g) / rows;
  const ps = cols * rows, sc = Math.ceil(imgs.length / ps);
  const pages = [];
  for (let s = 0; s < sc; s++) {
    const c = document.createElement('canvas'); c.width = paper.width; c.height = paper.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, paper.width, paper.height);
    imgs.slice(s * ps, (s + 1) * ps).forEach((img, i) => {
      const r = Math.floor(i / cols), co = i % cols;
      const x = m + co * (cW + g), y = m + r * (cH + g);
      drawAdjusted(ctx, trimWhitespace(img), x, y, cW, cH, adj);
    });
    pages.push(c.toDataURL('image/jpeg', 0.92));
  }
  return pages;
}

export function createNUpLayout(urls, arg2, arg3, adj) {
  let pp, pk;
  if (typeof arg2 === 'number') { pp = arg2; pk = arg3; } else { pk = arg2; pp = arg3; }
  const g = { 1: [1,1], 2: [1,2], 4: [2,2], 6: [2,3], 8: [2,4], 9: [3,3], 16: [4,4] };
  const [c, r] = g[pp] || [1, 1];
  return Promise.all(urls.map(loadImage)).then(imgs => tileWhole(imgs, c, r, PRINT_SIZES[pk] || PRINT_SIZES['A4'], adj));
}

export function createFrontBackNUpSheets(urls, pp, pk, adj) {
  const p = PRINT_SIZES[pk] || PRINT_SIZES['A4'];
  return Promise.all(urls.map(loadImage)).then(imgs => tileWhole(imgs, 2, Math.max(1, Math.round(pp / 2)), p, adj));
}

export function createPassportLayout(dataUrls, perPage, cols, pk, adj) {
  const list = Array.isArray(dataUrls) ? dataUrls : [dataUrls];
  const n = Math.max(1, perPage || 1), c = Math.max(1, cols || 1);
  const filled = expand(list, n);
  return Promise.all(filled.map(loadImage)).then(imgs => {
    const p = PRINT_SIZES[pk];
    const rows = Math.ceil(n / c);
    const m = 20, g = 12;
    const cW = (p.width - 2 * m - (c - 1) * g) / c;
    const cH = (p.height - 2 * m - (rows - 1) * g) / rows;
    const canvas = document.createElement('canvas'); canvas.width = p.width; canvas.height = p.height;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, p.width, p.height);
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / c), co = i % c;
      const x = m + co * (cW + g), y = m + r * (cH + g);
      drawAdjusted(ctx, imgs[i], x, y, cW, cH, adj); border(ctx, x, y, cW, cH, true);
    }
    return [canvas.toDataURL('image/jpeg', 0.92)];
  });
}

function fitAdjusted(dataUrl, cfg, adj) {
  return loadImage(dataUrl).then(img => {
    const trimmed = trimWhitespace(img);
    const c = document.createElement('canvas'); c.width = cfg.width; c.height = cfg.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    drawAdjusted(ctx, trimmed, 0, 0, c.width, c.height, adj);
    return c.toDataURL('image/jpeg', 0.92);
  });
}

export async function composePrintPages(images, o) {
  const adj = o.adj || {};
  const cfg = PRINT_SIZES[o.sizeKey];
  const copies = Math.max(1, o.copies || 1);
  let pages = [], cssW = cfg.cssWidth, cssH = cfg.cssHeight;
  const repeat = (arr) => { for (let k = 0; k < copies; k++) pages.push(...arr); };

  if (cfg.isIdCard) {
    repeat(await createIdCardSheets(images, adj));
    cssW = PRINT_SIZES['A4'].cssWidth; cssH = PRINT_SIZES['A4'].cssHeight;
  } else if (cfg.isPassport) {
    repeat(await createPassportLayout(images, o.passportPerPage, o.passportCols, o.passportPaper, adj));
    cssW = PRINT_SIZES[o.passportPaper].cssWidth; cssH = PRINT_SIZES[o.passportPaper].cssHeight;
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
    for (const img of images) one.push(await fitAdjusted(img, cfg, adj));
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
    const MAX = 1600;
    let w = img.width, h = img.height;
    if (Math.max(w, h) > MAX) { const s = MAX / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.85);
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
      setTimeout(() => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); resolve(); }, 1000);
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
