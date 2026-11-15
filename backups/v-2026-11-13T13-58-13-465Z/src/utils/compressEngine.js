import { loadImage, dataUrlKB } from './imageUtils.js';
export { dataUrlKB } from './imageUtils.js';
export const FLOOR_DOC = 2;    // vector text ~ lossless, tiny
export const FLOOR_MIXED = 60; // text + images
export const FLOOR_PHOTO = 40; // image-only

/* ---------- classify each PDF page from its REAL content ---------- */
export async function analyzePdfPages(bytes) {
  const pdfjs = await import('pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const chars = tc.items.reduce((s, it) => s + ((it.str || '').trim().length), 0);
    let images = 0;
    try {
      const ops = await page.getOperatorList();
      for (const fn of ops.fnArray) {
        if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintJpegXObject || fn === pdfjs.OPS.paintInlineImageXObject) images++;
      }
    } catch (e) {}
    const vp = page.getViewport({ scale: 1 });
    const kind = chars > 40 && images === 0 ? 'text' : (chars > 40 && images > 0 ? 'mixed' : 'image');
    out.push({ kind, w: vp.width, h: vp.height, pageIdx: p - 1 });
  }
  await doc.destroy();
  return out;
}

export async function renderPageCanvas(bytes, pageIdx, scale = 3) {
  const pdfjs = await import('pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(pageIdx + 1);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  await doc.destroy();
  return c;
}

/* ---------- raster page: JPEG, resolution+quality search, legibility floor ---------- */
function jpegAt(img, width, q, gray) {
  const w = Math.max(64, Math.round(Math.min(width, img.width)));
  const h = Math.max(64, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  if (gray) ctx.filter = 'grayscale(1)';
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url) };
}
export function compressRasterPage(img, budgetKB, opts = {}) {
  const gray = !!opts.gray;
  const ultra = !!opts.ultra;
  const minScale = ultra ? 0.3 : 0.5;      // never shrink below half res unless ultra
  const minQ = ultra ? 0.4 : 0.55;         // keep text legible
  const scales = [1, 0.85, 0.7, 0.55, 0.4, 0.3];
  let best = null;
  for (const s of scales) {
    if (s < minScale) break;
    const w = img.width * s;
    let lo = minQ, hi = 0.9, fit = null;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      const enc = jpegAt(img, w, mid, gray);
      if (enc.kb <= budgetKB) { fit = enc; lo = mid; } else hi = mid;
    }
    if (fit) return fit;
    const low = jpegAt(img, w, minQ, gray);
    if (!best || low.kb < best.kb) best = low;
  }
  return best || jpegAt(img, img.width * minScale, minQ, gray);
}
export async function compressPageToTarget(dataUrl, budgetKB, opts = {}, override = null) {
  const img = override || await loadImage(dataUrl);
  return compressRasterPage(img, budgetKB, opts);
}
export async function compressPageForce(dataUrl, budgetKB, opts = {}) {
  const img = await loadImage(dataUrl);
  return compressRasterPage(img, budgetKB, { ...opts, ultra: true }).url;
}
export async function estimatePageKB(dataUrl) {
  const img = await loadImage(dataUrl);
  const s = 160; const c = document.createElement('canvas'); c.width = s; c.height = s;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, s, s);
  const d = ctx.getImageData(0, 0, s, s).data;
  let white = 0, colored = 0;
  for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; const lum = .299 * r + .587 * g + .114 * b; if (lum > 235) white++; else if (Math.max(r, g, b) - Math.min(r, g, b) > 60) colored++; }
  const n = d.length / 4;
  if (white / n > .6 && colored / n < .02) return FLOOR_DOC;
  if (white / n > .35) return FLOOR_MIXED;
  return FLOOR_PHOTO;
}
export async function allocateBudgets(urls, targetKB) {
  const n = Math.max(1, urls.length);
  return urls.map(() => Math.max(2, targetKB / n));   // fair per-page share, no global weighting
}

/* ---------- lossless vector copy (fonts + alignment preserved) ---------- */
export async function pdfSubsetLossless(origBytes, indices) {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(origBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const safe = (indices || []).filter(i => i >= 0 && i < src.getPageCount());
  const pages = await out.copyPages(src, safe.length ? safe : src.getPageIndices());
  pages.forEach(p => out.addPage(p));
  return new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
}
export async function pdfMergeLossless(entries) {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const en of entries) {
    if (!en.bytes) continue;
    const src = await PDFDocument.load(en.bytes, { ignoreEncryption: true });
    const safe = (en.indices || []).filter(i => i >= 0 && i < src.getPageCount());
    if (!safe.length) continue;
    const pages = await out.copyPages(src, safe);
    pages.forEach(p => out.addPage(p));
  }
  return new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
}
export async function compressPdfLossless(buf) { return pdfSubsetLossless(buf, null); }

/* ---------- CONTENT-AWARE PDF: allocate per page as we go ---------- */
export async function compressPdfSmart(entries, targetKB, onProgress, opts = {}) {
  const { PDFDocument } = await import('pdf-lib');
  const finite = isFinite(targetKB);
  const textEntries = entries.filter(e => e.kind === 'text');
  const rasterEntries = entries.filter(e => e.kind !== 'text');

  // 1) measure what the lossless text pages actually cost
  let textCost = 0;
  if (textEntries.length) {
    const tmp = await PDFDocument.create();
    for (const e of textEntries) { const src = await PDFDocument.load(e.bytes, { ignoreEncryption: true }); const [pg] = await tmp.copyPages(src, [e.pageIdx]); tmp.addPage(pg); }
    textCost = (await tmp.save({ useObjectStreams: true })).byteLength;
  }
  onProgress && onProgress(10);

  // 2) give each raster page a fair share of what's LEFT (sequential, content-based)
  let remaining = finite ? targetKB * 1024 - textCost : Infinity;
  const results = new Map();
  for (let i = 0; i < rasterEntries.length; i++) {
    const e = rasterEntries[i];
    const left = rasterEntries.length - i;
    const budget = finite ? Math.max(4, remaining / 1024 / left) : 200;
    const img = (e.bytes && e.pageIdx != null) ? await renderPageCanvas(e.bytes, e.pageIdx, 3) : await loadImage(e.dataUrl);
    const r = compressRasterPage(img, budget, opts);
    results.set(e, r);
    if (finite) remaining -= r.kb * 1024;
    onProgress && onProgress(10 + Math.round(((i + 1) / Math.max(1, rasterEntries.length)) * 70));
  }

  // 3) assemble in ORIGINAL order; text lossless, raster at ORIGINAL page size (alignment kept)
  const out = await PDFDocument.create();
  const cache = new Map();
  for (const e of entries) {
    if (e.kind === 'text') {
      let m = cache.get(e.bytes);
      if (!m) { m = { src: await PDFDocument.load(e.bytes, { ignoreEncryption: true }), map: {} }; cache.set(e.bytes, m); }
      if (m.map[e.pageIdx] == null) { const [pg] = await out.copyPages(m.src, [e.pageIdx]); m.map[e.pageIdx] = pg; }
      out.addPage(m.map[e.pageIdx]);
    } else {
      const r = results.get(e);
      const img = await out.embedJpg(r.url);
      const w = e.w || 595.28, h = e.h || 841.89;
      const pg = out.addPage([w, h]);
      pg.drawImage(img, { x: 0, y: 0, width: w, height: h });
    }
  }
  let blob = new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });

  // 4) if text alone already exceeds target, keep fonts (honest) unless user allows rasterizing text
  if (finite && blob.size > targetKB * 1024 && opts.allowRasterText && textEntries.length) {
    const all = entries.map(e => ({ ...e, kind: e.kind === 'text' ? 'image' : e.kind }));
    return compressPdfSmart(all, targetKB, onProgress, { ...opts, allowRasterText: false });
  }
  onProgress && onProgress(100);
  return blob;
}
export async function compressPdfToTarget(images, targetKB, onProgress, opts = {}, origBytes, indices) {
  const entries = images.map(u => ({ kind: 'image', dataUrl: u }));
  return compressPdfSmart(entries, targetKB, onProgress, opts);
}

/* ---------- SEPARATE simple image path (jpg / png) ---------- */
export async function compressImageToTarget(dataUrl, targetKB, mime = 'image/jpeg', onProgress, opts = {}) {
  const img = await loadImage(dataUrl);
  const origKB = dataUrlKB(dataUrl);
  if (!isFinite(targetKB) || origKB <= targetKB) { onProgress && onProgress(100); return dataUrl; }
  if (mime === 'image/png') {
    let s = 1, best = null;
    while (s >= 0.2) {
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
      const url = c.toDataURL('image/png'); const kb = dataUrlKB(url);
      if (kb <= targetKB) { onProgress && onProgress(100); return url; }
      if (!best || kb < best.kb) best = { url, kb };
      s *= 0.8;
    }
    onProgress && onProgress(100); return best ? best.url : dataUrl;
  }
  const r = compressRasterPage(img, targetKB, opts);
  onProgress && onProgress(100); return r.url;
}
export async function compressToTarget(d, t, p) { return compressImageToTarget(d, t, 'image/jpeg', p, {}); }
export async function convertToPng(d) { const i = await loadImage(d); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; c.getContext('2d').drawImage(i, 0, 0); return c.toDataURL('image/png'); }
export async function convertToJpg(d, q = .92) { const i = await loadImage(d); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(i, 0, 0); return c.toDataURL('image/jpeg', q); }
export async function dataUrlToBlob(d, n) { const r = await fetch(d); const b = await r.blob(); return new File([b], n, { type: b.type || 'application/octet-stream' }); }
export function blobToBase64(b) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); }); }
export async function shareBlob(blob, filename) {
  try {
    const { Share } = await import('@capacitor/share');
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const b64 = await blobToBase64(blob);
    const uri = await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache, recursive: true });
    await Share.share({ title: filename, text: filename, url: uri.uri, dialogTitle: 'Save / Print / Share' });
    return;
  } catch (e) { console.warn('share fallback', e); }
  if (blob instanceof Blob) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
}
