import { loadImage, dataUrlKB } from './imageUtils.js';

export const FLOOR_DOC = 20;
export const FLOOR_PHOTO = 35;
export const FLOOR_MIXED = 60;
export { dataUrlKB } from './imageUtils.js';

const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function pngChunk(type, data) { const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer); dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out; }
async function zlibDeflate(bytes) { const cs = new CompressionStream('deflate'); const stream = new Blob([bytes]).stream().pipeThrough(cs); return new Uint8Array(await new Response(stream).arrayBuffer()); }
function b64(bytes) { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }

/* PNG row filters (None/Sub/Up/Avg/Paeth) - pick cheapest per row = smaller text pages */
function filterCost(a) { let s = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; s += v < 128 ? v : 256 - v; } return s; }
function applyFilter(t, row, prev) {
  const n = row.length; const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = i >= 1 ? row[i - 1] : 0, b = prev ? prev[i] : 0, c = (prev && i >= 1) ? prev[i - 1] : 0;
    let v = row[i];
    if (t === 1) v = row[i] - a;
    else if (t === 2) v = row[i] - b;
    else if (t === 3) v = row[i] - ((a + b) >> 1);
    else if (t === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); v = row[i] - pr; }
    out[i] = v & 0xFF;
  }
  return out;
}

async function encode1bitPng(img, width) {
  const w = Math.max(16, Math.round(Math.min(width, img.width)));
  const h = Math.max(16, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const stride = Math.ceil(w / 8);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < w; x += 8) {
      const count = Math.min(8, w - x);
      let bits = 0;
      for (let b = 0; b < count; b++) { const i = (y * w + x + b) * 4; const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; bits = (bits << 1) | (lum < 170 ? 0 : 1); }
      row[x >> 3] = (bits << (8 - count)) | ((1 << (8 - count)) - 1);
    }
    rows.push(row);
  }
  const raw = new Uint8Array(h * (stride + 1));
  let o = 0, prev = null;
  for (const row of rows) {
    let bestT = 0, bestArr = row, bestCost = filterCost(row);
    for (const t of [1, 2, 3, 4]) { const arr = applyFilter(t, row, prev); const cc = filterCost(arr); if (cc < bestCost) { bestCost = cc; bestT = t; bestArr = arr; } }
    raw[o++] = bestT; raw.set(bestArr, o); o += stride;
    prev = row;
  }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 1; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = await zlibDeflate(raw);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = new Uint8Array(sig.length + 12 + 13 + 12 + idat.length + 12);
  let p = 0; png.set(sig, p); p += sig.length;
  for (const ch of [pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))]) { png.set(ch, p); p += ch.length; }
  const url = 'data:image/png;base64,' + b64(png);
  return { url, kb: dataUrlKB(url) };
}
async function oneBitAt(img, w) {
  try { return await encode1bitPng(img, w); }
  catch (e) { const cc = document.createElement('canvas'); cc.width = w; cc.height = Math.round(img.height * (w / img.width)); const cx = cc.getContext('2d'); cx.drawImage(img, 0, 0, cc.width, cc.height); const url = cc.toDataURL('image/png'); return { url, kb: dataUrlKB(url) }; }
}

function classify(img) {
  const s = 200;
  const c = document.createElement('canvas'); c.width = s; c.height = s;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, s, s);
  const d = ctx.getImageData(0, 0, s, s).data;
  let white = 0, colored = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (lum > 235) white++; else if (sat > 60) colored++;
  }
  const n = d.length / 4, wf = white / n, cf = colored / n;
  if (wf > 0.55 && cf < 0.02) return 'text';
  if (wf > 0.35) return 'mixed';
  return 'photo';
}
async function classifyAll(urls) { const out = []; for (const u of urls) { const img = await loadImage(u); out.push(classify(img)); } return out; }
const WEIGHTS = { text: 1, mixed: 8, photo: 4 };

export async function allocateBudgets(urls, targetKB) {
  const cls = await classifyAll(urls);
  const ws = cls.map(c => WEIGHTS[c]);
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  return ws.map(w => Math.max(2, (w / sum) * targetKB * 0.94));
}

function sharpen(img, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h); const p = d.data;
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const out = new Uint8ClampedArray(p.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let ch = 0; ch < 3; ch++) {
    let sum = 0, ki = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) sum += p[((y + ky) * w + (x + kx)) * 4 + ch] * kernel[ki++];
    out[(y * w + x) * 4 + ch] = Math.max(0, Math.min(255, sum));
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  ctx.putImageData(new ImageData(out, w, h), 0, 0);
  return c;
}
function jpegAt(img, width, q, gray, contrast, docMode) {
  const w = Math.max(16, Math.round(Math.min(width, img.width)));
  const h = Math.max(16, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  const f = []; if (gray) f.push('grayscale(1)'); if (contrast) f.push('contrast(1.08)');
  if (f.length) ctx.filter = f.join(' ');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (docMode) ctx.drawImage(sharpen(img, w, h), 0, 0); else ctx.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url) };
}
function pngAt(img, width) {
  const w = Math.max(16, Math.round(Math.min(width, img.width)));
  const h = Math.max(16, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/png');
  return { url, kb: dataUrlKB(url) };
}
function ladder(img, cap, floor) { const out = []; let w = Math.min(img.width, cap || 1600); while (w >= (floor || 120)) { out.push(Math.round(w)); w *= 0.8; } out.push(floor || 120); return out; }
function bestJpegAtWidth(img, w, targetKB, gray, contrast, docMode, minQ = 0.12) {
  const minEnc = jpegAt(img, w, minQ, gray, contrast, docMode);
  if (minEnc.kb > targetKB) return null;
  let lo = minQ, hi = 0.92, best = minEnc;
  for (let i = 0; i < 6; i++) { const mid = (lo + hi) / 2; const enc = jpegAt(img, w, mid, gray, contrast, docMode); if (enc.kb <= targetKB) { best = enc; lo = mid; } else hi = mid; }
  return best;
}

export async function compressPageToTarget(dataUrl, targetKB, opts = {}) {
  const img = await loadImage(dataUrl);
  const cls = classify(img);
  const gray = !!opts.gray;                 // grayscale now applies to EVERY page type
  const contrast = opts.readable !== false;
  const ultra = !!opts.ultra;
  const minQ = ultra ? 0.08 : 0.12;
  let smallest = null;
  if (cls === 'text') {
    for (const w of ladder(img, 1600, ultra ? 300 : 600)) {
      const enc = await oneBitAt(img, w);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) return { ...enc, doc: true, cls };
    }
    for (const w of ladder(img, ultra ? 260 : 500, 150)) {
      const enc = await oneBitAt(img, w);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) return { ...enc, doc: true, cls };
    }
  } else {
    for (const w of ladder(img, 1600, ultra ? 500 : 900)) {
      const fit = bestJpegAtWidth(img, w, targetKB, gray, contrast, cls === 'mixed', minQ);
      if (fit) return { ...fit, doc: false, cls };
      const minEnc = jpegAt(img, w, minQ, gray, contrast, cls === 'mixed');
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
    for (const w of ladder(img, ultra ? 400 : 720, ultra ? 120 : 200)) {
      const fit = bestJpegAtWidth(img, w, targetKB, gray, contrast, false, minQ);
      if (fit) return { ...fit, doc: false, cls };
      const minEnc = jpegAt(img, w, minQ, gray, contrast, false);
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
  }
  return { ...(smallest || { url: dataUrl, kb: dataUrlKB(dataUrl) }), doc: cls === 'text', cls };
}

export async function compressPageForce(dataUrl, targetKB, opts = {}) {
  const img = await loadImage(dataUrl);
  const cls = classify(img);
  const gray = !!opts.gray;
  if (cls === 'text') {
    for (const w of [900, 700, 550, 430, 340, 260, 200, 150, 120]) { const enc = await oneBitAt(img, w); if (enc.kb <= targetKB) return enc.url; }
    return (await oneBitAt(img, 120)).url;
  }
  let last = null;
  for (const w of [800, 600, 450, 340, 260, 200, 150]) { const enc = jpegAt(img, w, 0.3, gray, true, cls === 'mixed'); last = enc; if (enc.kb <= targetKB) return enc.url; }
  return last.url;
}

export async function estimatePageKB(dataUrl, ultra = false) {
  const img = await loadImage(dataUrl);
  const cls = classify(img);
  if (cls === 'text') return ultra ? 10 : FLOOR_DOC;
  if (cls === 'mixed') return ultra ? 30 : FLOOR_MIXED;
  return ultra ? 18 : FLOOR_PHOTO;
}

export async function compressImageToTarget(dataUrl, targetKB, mime = 'image/jpeg', onProgress, opts = {}) {
  const gray = !!opts.gray, contrast = opts.readable !== false, ultra = !!opts.ultra;
  const want = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const origKB = dataUrlKB(dataUrl);
  const img = await loadImage(dataUrl);
  const cls = classify(img);
  if (!isFinite(targetKB) || origKB <= targetKB) {
    if (dataUrl.startsWith('data:' + want) && !gray && !contrast) { onProgress && onProgress(100); return dataUrl; }
    const conv = (want === 'image/png' && cls === 'text') ? await oneBitAt(img, img.width) : (want === 'image/png' ? pngAt(img, img.width) : jpegAt(img, img.width, 0.9, gray, contrast, cls === 'mixed'));
    onProgress && onProgress(100);
    return conv.kb <= origKB ? conv.url : dataUrl;
  }
  let smallest = null;
  const widths = ladder(img, 1600, cls === 'text' ? (ultra ? 200 : 300) : (ultra ? 400 : 600));
  const minQ = ultra ? 0.08 : 0.12;
  for (let i = 0; i < widths.length; i++) {
    onProgress && onProgress(Math.min(92, Math.round((i / widths.length) * 92)));
    if (cls === 'text' && want === 'image/png') {
      const enc = await oneBitAt(img, widths[i]);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) { onProgress && onProgress(100); return enc.url; }
    } else if (cls === 'text') {
      const bl = await oneBitAt(img, widths[i]);
      const bimg = await loadImage(bl.url);
      const enc = jpegAt(bimg, bimg.width, 0.8, gray, false, false);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) { onProgress && onProgress(100); return enc.url; }
    } else if (want === 'image/png') {
      const enc = pngAt(img, widths[i]);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) { onProgress && onProgress(100); return enc.url; }
    } else {
      const fit = bestJpegAtWidth(img, widths[i], targetKB, gray, contrast, cls === 'mixed', minQ);
      if (fit) { onProgress && onProgress(100); return fit.url; }
      const minEnc = jpegAt(img, widths[i], minQ, gray, contrast, cls === 'mixed');
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
  }
  onProgress && onProgress(100);
  return smallest ? smallest.url : dataUrl;
}
export async function compressToTarget(dataUrl, targetKB, onProgress) { return compressImageToTarget(dataUrl, targetKB, 'image/jpeg', onProgress, {}); }

export async function convertToPng(dataUrl) { const img = await loadImage(dataUrl); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0); return c.toDataURL('image/png'); }
export async function convertToJpg(dataUrl, q = 0.92) { const img = await loadImage(dataUrl); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0); return c.toDataURL('image/jpeg', q); }
export async function dataUrlToBlob(dataUrl, name) { const res = await fetch(dataUrl); const blob = await res.blob(); return new File([blob], name, { type: blob.type || 'application/octet-stream' }); }
export function blobToBase64(blob) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); }); }
export async function shareBlob(blob, filename) {
  try {
    const { Share } = await import('@capacitor/share');
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const b64 = await blobToBase64(blob);
    const uri = await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache, recursive: true });
    await Share.share({ title: filename, text: filename, url: uri.uri, dialogTitle: 'Save / Print / Share' });
    return;
  } catch (e) { console.warn('share fallback', e); }
  if (blob instanceof Blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
export async function pdfSubsetLossless(origBytes, indices) {
  const { PDFDocument } = await import('pdf-lib');
  const src = await PDFDocument.load(origBytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const safe = (indices || []).filter(i => i >= 0 && i < src.getPageCount());
  const pages = await out.copyPages(src, safe.length ? safe : src.getPageIndices());
  pages.forEach(p => out.addPage(p));
  const bytes = await out.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}
export async function compressPdfLossless(arrayBuffer) {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
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
  const bytes = await out.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}
async function buildPdfFromPages(pages) {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (const url of pages) {
    let img = null;
    try { img = url.startsWith('data:image/png') ? await pdf.embedPng(url) : await pdf.embedJpg(url); }
    catch (err) { img = await pdf.embedJpg(await convertToJpg(url, 0.85)); }
    const ratio = (img.height || 842) / (img.width || 595);
    const wPt = 595.28, hPt = wPt * ratio;
    const page = pdf.addPage([wPt, hPt]);
    page.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
  }
  const bytes = await pdf.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}

export async function compressPdfToTarget(images, targetKB, onProgress, opts = {}, origBytes, indices) {
  const origSize = origBytes ? origBytes.byteLength : Infinity;
  const skipLossless = !!opts.gray;   // grayscale must re-encode, never return colour original
  if (!skipLossless && origBytes && !isFinite(targetKB)) { const s = await pdfSubsetLossless(origBytes, indices || []); onProgress && onProgress(100); return s.size <= origSize ? s : new Blob([origBytes], { type: 'application/pdf' }); }
  if (!skipLossless && origBytes) { const s = await pdfSubsetLossless(origBytes, indices || []); if (s.size <= targetKB * 1024) { onProgress && onProgress(100); return s; } }

  const n = Math.max(1, images.length);
  onProgress && onProgress(5);
  let per = await allocateBudgets(images, targetKB);
  onProgress && onProgress(20);
  let blob = null;
  for (let round = 0; round < 3; round++) {
    const pages = [];
    for (let i = 0; i < n; i++) {
      const r = await compressPageToTarget(images[i], per[i], opts);
      pages.push(r.url);
      onProgress && onProgress(20 + Math.round(((i + 1) / n) * 60) + round * 5);
    }
    blob = await buildPdfFromPages(pages);
    if (blob.size <= targetKB * 1024) { onProgress && onProgress(100); return blob; }
    const scale = (targetKB * 1024 * 0.94) / blob.size;
    per = per.map(p => Math.max(2, p * scale));
  }
  for (let guard = 0; guard < 3 && blob && blob.size > targetKB * 1024; guard++) {
    const tight = await allocateBudgets(images, targetKB * 0.9);
    const pages = [];
    for (let i = 0; i < n; i++) pages.push(await compressPageForce(images[i], tight[i], opts));
    blob = await buildPdfFromPages(pages);
  }
  if (!skipLossless && origBytes && blob && blob.size > origSize) blob = await pdfSubsetLossless(origBytes, indices || []);
  onProgress && onProgress(100);
  return blob;
}

/* ADVANCED: keep vector-text pages lossless (perfect quality + original alignment),
   spend the whole size budget only on scanned / image pages. */
export async function compressPdfSmart(entries, targetKB, onProgress, opts = {}) {
  const { PDFDocument } = await import('pdf-lib');
  const finite = isFinite(targetKB);
  const vectorEntries = entries.filter(e => e.kind === 'vector');
  const naturalRaster = entries.map((e, i) => e.kind === 'image' ? i : -1).filter(i => i >= 0);

  let vectorCost = 0;
  if (vectorEntries.length) {
    const tmp = await PDFDocument.create();
    for (const e of vectorEntries) {
      const src = await PDFDocument.load(e.bytes, { ignoreEncryption: true });
      const [pg] = await tmp.copyPages(src, [e.pageIdx]);
      tmp.addPage(pg);
    }
    vectorCost = (await tmp.save({ useObjectStreams: true })).size;
  }
  onProgress && onProgress(8);

  const buildOnce = async (forceRaster, budgetBytes) => {
    const useRaster = forceRaster ? entries.map((_, i) => i) : naturalRaster;
    const rasterUrls = useRaster.map(i => entries[i].dataUrl);
    let per = await allocateBudgets(rasterUrls, Math.max(1, budgetBytes / 1024));
    let blob = null;
    for (let round = 0; round < 3; round++) {
      const compressed = [];
      for (let r = 0; r < rasterUrls.length; r++) {
        const res = await compressPageToTarget(rasterUrls[r], per[r], opts);
        compressed.push(res.url);
        onProgress && onProgress(10 + Math.round(((r + 1) / Math.max(1, rasterUrls.length)) * 70) + round * 5);
      }
      const byEntry = new Map(); useRaster.forEach((ei, r) => byEntry.set(ei, compressed[r]));
      const out = await PDFDocument.create();
      const cache = new Map();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.kind === 'vector' && !forceRaster) {
          let m = cache.get(e.bytes);
          if (!m) { const src = await PDFDocument.load(e.bytes, { ignoreEncryption: true }); m = { src, map: {} }; cache.set(e.bytes, m); }
          if (m.map[e.pageIdx] == null) { const [pg] = await out.copyPages(m.src, [e.pageIdx]); m.map[e.pageIdx] = pg; }
          out.addPage(m.map[e.pageIdx]);
        } else {
          const url = byEntry.get(i);
          let img = null;
          try { img = url.startsWith('data:image/png') ? await out.embedPng(url) : await out.embedJpg(url); }
          catch (err) { img = await out.embedJpg(await convertToJpg(url, 0.85)); }
          const ratio = (img.height || 842) / (img.width || 595);
          const wPt = 595.28, hPt = wPt * ratio;
          const pg = out.addPage([wPt, hPt]);
          pg.drawImage(img, { x: 0, y: 0, width: wPt, height: hPt });
        }
      }
      blob = await out.save({ useObjectStreams: true });
      if (!finite || blob.size <= targetKB * 1024) return blob;
      const scale = (targetKB * 1024 * 0.94) / blob.size;
      per = per.map(p => Math.max(2, p * scale));
    }
    return blob;
  };

  let budgetBytes = finite ? targetKB * 1024 * 0.94 - vectorCost : Infinity;
  let forceRaster = finite && budgetBytes < naturalRaster.length * 3000;
  if (forceRaster) budgetBytes = targetKB * 1024 * 0.94;
  let blob = await buildOnce(forceRaster, budgetBytes);
  if (finite && blob.size > targetKB * 1024 && !forceRaster && vectorEntries.length) {
    blob = await buildOnce(true, targetKB * 1024 * 0.94);   // last resort: rasterize everything
  }
  onProgress && onProgress(100);
  return blob;
}
