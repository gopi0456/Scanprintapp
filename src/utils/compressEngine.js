import { loadImage, dataUrlKB } from './imageUtils.js';
export { dataUrlKB } from './imageUtils.js';

/* ---------- compression modes ---------- */
export const MODES = {
  hc_hq: { label: 'High compress + High quality', hint: 'Most pixels for your size · balanced encoding', textQ: 0.30, photoQ: 0.55, icon: '⚖️' },
  hc_lq: { label: 'High compress + Low quality',  hint: 'Maximum pixels · coarser encoding, smallest file', textQ: 0.17, photoQ: 0.32, icon: '🗜️' },
  lc_hq: { label: 'Less compress + High quality', hint: 'Cleanest encoding · fewer pixels, larger file', textQ: 0.62, photoQ: 0.80, icon: '💎' }
};

/* ---------- paper sizes for IMAGE output (PDF is always A4) ---------- */
export const PAPER_SIZES = {
  default:  { label: 'Default',   sub: 'As uploaded',        w: 0,     h: 0,     note: 'Keeps original pixels' },
  passport: { label: 'Passport',  sub: '35 × 45 mm',         w: 35,    h: 45,    note: 'Indian / intl. photo' },
  stamp:    { label: 'Stamp',     sub: '20 × 25 mm',         w: 20,    h: 25,    note: 'Form / signature' },
  visa:     { label: 'Visa',      sub: '51 × 51 mm',         w: 51,    h: 51,    note: 'US visa · square' },
  photo:    { label: 'Photo 4×6', sub: '102 × 152 mm',       w: 101.6, h: 152.4, note: 'Lab print' },
  a5:       { label: 'A5',        sub: '148 × 210 mm',       w: 148,   h: 210,   note: 'Half page' },
  a4:       { label: 'A4',        sub: '210 × 297 mm',       w: 210,   h: 297,   note: 'Full document' },
  letter:   { label: 'Letter',    sub: '216 × 279 mm',       w: 215.9, h: 279.4, note: 'US letter' }
};
export const DPI_OPTIONS = [96, 150, 200, 300, 600];
export const FIT_MODES = {
  contain: { label: 'Fit', hint: 'Whole image inside, white border' },
  cover:   { label: 'Fill', hint: 'Covers the sheet, edges cropped' },
  stretch: { label: 'Stretch', hint: 'Exact sheet, may distort' }
};
export const A4_PT = { w: 595.28, h: 841.89 };

export function paperPixels(key, dpi) {
  const p = PAPER_SIZES[key];
  if (!p || !p.w) return null;
  return { w: Math.max(16, Math.round(p.w / 25.4 * dpi)), h: Math.max(16, Math.round(p.h / 25.4 * dpi)) };
}
export function renderToPaper(img, key, dpi, fit = 'contain') {
  const t = paperPixels(key, dpi);
  if (!t) return { canvas: img, w: img.width, h: img.height, framed: false };
  const c = document.createElement('canvas'); c.width = t.w; c.height = t.h;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, t.w, t.h);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  const sr = img.width / img.height, tr = t.w / t.h;
  let dw, dh;
  if (fit === 'stretch') { dw = t.w; dh = t.h; }
  else if (fit === 'cover') { if (sr > tr) { dh = t.h; dw = dh * sr; } else { dw = t.w; dh = dw / sr; } }
  else { if (sr > tr) { dw = t.w; dh = dw / sr; } else { dh = t.h; dw = dh * sr; } }
  x.drawImage(img, (t.w - dw) / 2, (t.h - dh) / 2, dw, dh);
  return { canvas: c, w: t.w, h: t.h, framed: true };
}

/* ---------- pdf intake ---------- */
export async function analyzePdfPages(bytes) {
  const pdfjs = await import('pdfjs-dist');
  const task = pdfjs.getDocument({ data: bytes.slice(0) }); const doc = await task.promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const vp = (await doc.getPage(p)).getViewport({ scale: 1 });
    out.push({ pageIdx: p - 1, w: vp.width, h: vp.height });
  }
  try { await task.destroy(); } catch (e) {}
  return out;
}
export async function renderPageCanvas(bytes, pageIdx, scale = 3) {
  const pdfjs = await import('pdfjs-dist');
  const task = pdfjs.getDocument({ data: bytes.slice(0) }); const doc = await task.promise;
  const page = await doc.getPage(pageIdx + 1);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: x, viewport: vp }).promise;
  try { await task.destroy(); } catch (e) {}
  return c;
}
export async function originalPdf(bytes, indices) {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const want = (indices && indices.length) ? indices : src.getPageIndices();
  const full = want.length === total && want.every((v, i) => v === i);
  if (full) return new Blob([bytes], { type: 'application/pdf' });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, want);
  pages.forEach(p => out.addPage(p));
  return new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
}

/* ---------- content analysis ---------- */
function contentBox(img) {
  const s = 220;
  const c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, s, s); x.drawImage(img, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  let x0 = s, y0 = s, x1 = -1, y1 = -1;
  for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
    const i = (yy * s + xx) * 4;
    if (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2] < 236) {
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
      if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
    }
  }
  if (x1 < 0) return { sx: 0, sy: 0, sw: img.width, sh: img.height, rx: 0, ry: 0, rw: 1, rh: 1 };
  x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2);
  x1 = Math.min(s - 1, x1 + 2); y1 = Math.min(s - 1, y1 + 2);
  const rx = x0 / s, ry = y0 / s, rw = (x1 - x0 + 1) / s, rh = (y1 - y0 + 1) / s;
  return { sx: Math.round(rx * img.width), sy: Math.round(ry * img.height), sw: Math.max(16, Math.round(rw * img.width)), sh: Math.max(16, Math.round(rh * img.height)), rx, ry, rw, rh };
}
function cropTo(img, b) {
  const c = document.createElement('canvas'); c.width = b.sw; c.height = b.sh;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, b.sw, b.sh);
  x.drawImage(img, b.sx, b.sy, b.sw, b.sh, 0, 0, b.sw, b.sh);
  return c;
}
function isTextPage(img) {
  const s = 140; const c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  let white = 0, colored = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (.299 * r + .587 * g + .114 * b > 218) white++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 52) colored++;
  }
  const n = d.length / 4;
  return white / n > 0.44 && colored / n < 0.07;
}

/* ---------- encoders ---------- */
function jpegAt(img, width, q, gray, textMode) {
  const w = Math.max(32, Math.round(Math.min(width, img.width)));
  const h = Math.max(32, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  const f = [];
  if (gray || textMode) f.push('grayscale(1)');
  if (textMode) f.push('contrast(1.08)');
  if (f.length) x.filter = f.join(' ');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url), px: w, ph: h, q };
}
function encodeMaxResolution(src, budget, startQ, gray, textMode) {
  let lo = 160, hi = src.width;
  let best = jpegAt(src, lo, startQ, gray, textMode);
  if (best.kb > budget) {
    for (const qq of [startQ * .75, startQ * .55, .14, .09]) {
      const e = jpegAt(src, lo, Math.max(.06, qq), gray, textMode);
      if (e.kb < best.kb) best = e;
      if (e.kb <= budget) return e;
    }
    return best;
  }
  while (hi - lo > 18) {
    const mid = Math.round((lo + hi) / 2);
    const e = jpegAt(src, mid, startQ, gray, textMode);
    if (e.kb <= budget) { best = e; lo = mid; } else hi = mid;
  }
  for (const bump of [.07, .15, .24, .34]) {
    const e = jpegAt(src, lo, Math.min(.93, startQ + bump), gray, textMode);
    if (e.kb <= budget) best = e; else break;
  }
  return best;
}
/* framed output: hold the exact paper pixels, spend quality first */
function encodeFramed(src, budget, startQ, gray, textMode) {
  const top = jpegAt(src, src.width, .93, gray, textMode);
  if (top.kb <= budget) return { ...top, exact: true };
  let lo = .06, hi = .93, best = null;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const e = jpegAt(src, src.width, mid, gray, textMode);
    if (e.kb <= budget) { best = e; lo = mid; } else hi = mid;
  }
  if (best) return { ...best, exact: true };
  return { ...encodeMaxResolution(src, budget, startQ, gray, textMode), exact: false };
}
export function compressRasterPage(img, budgetKB, mode = 'hc_hq', gray = false) {
  const cfg = MODES[mode] || MODES.hc_hq;
  const box = contentBox(img);
  const src = cropTo(img, box);
  const textMode = isTextPage(src);
  const r = encodeMaxResolution(src, Math.max(.4, budgetKB), textMode ? cfg.textQ : cfg.photoQ, gray, textMode);
  return { ...r, box, textMode };
}
export function computeBudgets(count, targetKB, origKB) {
  const n = Math.max(1, count);
  const base = targetKB > 0 ? targetKB : (origKB || 400);
  return Array.from({ length: n }, () => Math.max(.4, (base * .955) / n));
}
export function clarityFor(widthPx) {
  if (widthPx < 420) return { key: 'bad', label: 'Unreadable', note: 'Too few pixels for a dense table.' };
  if (widthPx < 650) return { key: 'low', label: 'Barely legible', note: 'Headings read; fine print is soft.' };
  if (widthPx < 950) return { key: 'ok', label: 'Readable', note: 'Most table text stays legible.' };
  return { key: 'high', label: 'Sharp', note: 'Close to the original scan detail.' };
}
export function readableMinimum(count, origKB) {
  const n = Math.max(1, count);
  const per = origKB ? origKB / n : 40;
  const est = Math.round(n * Math.min(40, Math.max(6, per * 0.8)));
  return Math.max(1, Math.min(origKB || est, est));
}
export async function pageImage(entry) {
  if (entry.bytes && entry.pageIdx != null) return renderPageCanvas(entry.bytes, entry.pageIdx, 3);
  return loadImage(entry.dataUrl);
}
export async function measurePage(entry, budgetKB, mode, gray) {
  const r = compressRasterPage(await pageImage(entry), budgetKB, mode, gray);
  return { kb: r.kb, px: r.px, q: r.q, url: r.url };
}

/* ---------- PDF: every page lands on A4, centred, aspect kept ---------- */
export async function compressPdfWithMode(entries, targetKB, origKB, mode, gray, onProgress) {
  const { PDFDocument } = await import('pdf-lib');
  const finite = isFinite(targetKB) && targetKB > 0;
  const sameSrc = entries.length > 0 && entries.every(e => e.bytes && e.bytes === entries[0].bytes);
  if (sameSrc && (!finite || targetKB >= origKB)) {
    const blob = await originalPdf(entries[0].bytes, entries.map(e => e.pageIdx));
    onProgress && onProgress(100);
    return { blob, per: [], passthrough: true };
  }
  const build = async (budgets) => {
    const out = await PDFDocument.create();
    const per = [];
    for (let i = 0; i < entries.length; i++) {
      const r = compressRasterPage(await pageImage(entries[i]), budgets[i], mode, gray);
      per.push({ kb: r.kb, px: r.px, q: r.q });
      const emb = await out.embedJpg(r.url);
      const pg = out.addPage([A4_PT.w, A4_PT.h]);
      const ir = emb.width / emb.height, pr = A4_PT.w / A4_PT.h;
      let dw, dh;
      if (ir > pr) { dw = A4_PT.w; dh = dw / ir; } else { dh = A4_PT.h; dw = dh * ir; }
      pg.drawImage(emb, { x: (A4_PT.w - dw) / 2, y: (A4_PT.h - dh) / 2, width: dw, height: dh });
      onProgress && onProgress(Math.round(((i + 1) / entries.length) * 92));
    }
    return { blob: new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' }), per };
  };
  let res = await build(computeBudgets(entries.length, targetKB, origKB));
  if (finite && res.blob.size > targetKB * 1024) {
    const k = (targetKB * 1024 * .94) / res.blob.size;
    res = await build(computeBudgets(entries.length, targetKB, origKB).map(b => Math.max(.3, b * k)));
  }
  if (sameSrc && origKB && res.blob.size > origKB * 1024) {
    const blob = await originalPdf(entries[0].bytes, entries.map(e => e.pageIdx));
    onProgress && onProgress(100);
    return { blob, per: [], passthrough: true };
  }
  onProgress && onProgress(100);
  return { ...res, passthrough: false };
}

/* ---------- IMAGE: paper size + DPI + fit, then size target ---------- */
export async function compressImageToTarget(dataUrl, targetKB, mime, mode, gray, opts = {}, onProgress) {
  const cfg = MODES[mode] || MODES.hc_hq;
  const { paper = 'default', dpi = 300, fit = 'contain' } = opts;
  const img = await loadImage(dataUrl);
  const shaped = renderToPaper(img, paper, dpi, fit);
  const src = shaped.canvas;
  const budget = targetKB > 0 ? targetKB : Infinity;

  if (mime === 'image/png') {
    const enc = w => {
      const ww = Math.max(32, Math.round(w)), hh = Math.max(32, Math.round(src.height * (ww / src.width)));
      const c = document.createElement('canvas'); c.width = ww; c.height = hh;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, ww, hh);
      if (gray) x.filter = 'grayscale(1)';
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(src, 0, 0, ww, hh);
      const url = c.toDataURL('image/png');
      return { url, kb: dataUrlKB(url), px: ww, ph: hh, q: 1 };
    };
    let best = enc(src.width);
    let exact = true;
    if (isFinite(budget) && best.kb > budget) {
      let lo = 64, hi = src.width; exact = false;
      best = enc(lo);
      while (hi - lo > 16) {
        const mid = Math.round((lo + hi) / 2);
        const e = enc(mid);
        if (e.kb <= budget) { best = e; lo = mid; } else hi = mid;
      }
    }
    onProgress && onProgress(100);
    return { ...best, exact, framed: shaped.framed, sheet: shaped };
  }

  const textMode = isTextPage(src);
  const q = textMode ? cfg.textQ : cfg.photoQ;
  const r = shaped.framed
    ? encodeFramed(src, budget, q, gray, textMode)
    : { ...encodeMaxResolution(src, budget, q, gray, textMode), exact: false };
  onProgress && onProgress(100);
  return { ...r, framed: shaped.framed, sheet: shaped };
}

/* ---------- shared helpers ---------- */
export async function convertToJpg(d, q = .92) { const i = await loadImage(d); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(i, 0, 0); return c.toDataURL('image/jpeg', q); }
export async function convertToPng(d) { const i = await loadImage(d); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; c.getContext('2d').drawImage(i, 0, 0); return c.toDataURL('image/png'); }
export async function dataUrlToBlob(d, n) { const r = await fetch(d); const b = await r.blob(); return new File([b], n, { type: b.type || 'application/octet-stream' }); }
export function blobToBase64(b) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); }); }
export async function shareBlob(blob, filename) {
  try { const { Share } = await import('@capacitor/share'); const { Filesystem, Directory } = await import('@capacitor/filesystem'); const b64 = await blobToBase64(blob); const uri = await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache, recursive: true }); await Share.share({ title: filename, text: filename, url: uri.uri, dialogTitle: 'Save / Share' }); return; } catch (e) { console.warn('share fallback', e); }
  if (blob instanceof Blob) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
}

export { compressPdfKeepText, inspectPdf } from './pdfSmart.js';
