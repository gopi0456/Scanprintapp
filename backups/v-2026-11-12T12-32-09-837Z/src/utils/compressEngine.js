import { loadImage, dataUrlKB } from './imageUtils.js';

/* ---------- tiny PNG writer: 1-bit grayscale (fax-quality, extremely small) ---------- */
const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
async function zlibDeflate(bytes) {
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function b64(bytes) { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }

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
  const raw = new Uint8Array(h * (stride + 1));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x += 8) {
      const count = Math.min(8, w - x);
      let bits = 0;
      for (let b = 0; b < count; b++) {
        const i = (y * w + x + b) * 4;
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        bits = (bits << 1) | (lum < 150 ? 0 : 1);
      }
      raw[o++] = (bits << (8 - count)) | ((1 << (8 - count)) - 1);
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 1; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = await zlibDeflate(raw);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = new Uint8Array(sig.length + 12 + 13 + 12 + idat.length + 12);
  let p = 0;
  png.set(sig, p); p += sig.length;
  for (const ch of [pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))]) { png.set(ch, p); p += ch.length; }
  const url = 'data:image/png;base64,' + b64(png);
  return { url, kb: dataUrlKB(url) };
}

/* ---------- helpers ---------- */
function detectDoc(img) {
  const s = 160;
  const c = document.createElement('canvas'); c.width = s; c.height = s;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, s, s);
  const d = ctx.getImageData(0, 0, s, s).data;
  let white = 0, sat = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (0.299 * r + 0.587 * g + 0.114 * b > 235) white++;
    sat += (Math.max(r, g, b) - Math.min(r, g, b));
  }
  const n = d.length / 4;
  return (white / n) > 0.55 && (sat / n) < 40;
}
function jpegAt(img, width, q, gray, contrast) {
  const w = Math.max(16, Math.round(Math.min(width, img.width)));
  const h = Math.max(16, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  const f = []; if (gray) f.push('grayscale(1)'); if (contrast) f.push('contrast(1.12)');
  if (f.length) ctx.filter = f.join(' ');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url) };
}
function ladder(img, cap, floor) {
  const out = []; let w = Math.min(img.width, cap || 1600);
  while (w >= (floor || 120)) { out.push(Math.round(w)); w *= 0.8; }
  out.push(floor || 120);
  return out;
}
function bestJpegAtWidth(img, w, targetKB, gray, contrast) {
  const minEnc = jpegAt(img, w, 0.1, gray, contrast);
  if (minEnc.kb > targetKB) return null;
  let lo = 0.1, hi = 0.92, best = minEnc;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    const enc = jpegAt(img, w, mid, gray, contrast);
    if (enc.kb <= targetKB) { best = enc; lo = mid; } else hi = mid;
  }
  return best;
}
async function oneBitAt(img, w) {
  try { return await encode1bitPng(img, w); }
  catch (e) { // CompressionStream unavailable -> 8-bit fallback
    const cc = document.createElement('canvas'); cc.width = w; cc.height = Math.round(img.height * (w / img.width));
    const cx = cc.getContext('2d'); cx.drawImage(img, 0, 0, cc.width, cc.height);
    const url = cc.toDataURL('image/png'); return { url, kb: dataUrlKB(url) };
  }
}

/* ---------- per-page: text -> 1-bit PNG, photo -> JPEG; hard target ---------- */
export async function compressPageToTarget(dataUrl, targetKB, opts = {}) {
  const img = await loadImage(dataUrl);
  const doc = detectDoc(img);
  const gray = !!opts.gray, contrast = opts.readable !== false;
  let smallest = null;
  if (doc) {
    for (const w of ladder(img, 1600, 200)) {
      const enc = await oneBitAt(img, w);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) return { ...enc, doc };
    }
  } else {
    for (const w of ladder(img, 1600, 120)) {
      const fit = bestJpegAtWidth(img, w, targetKB, gray, contrast);
      if (fit) return { ...fit, doc };
      const minEnc = jpegAt(img, w, 0.1, gray, contrast);
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
  }
  return { ...(smallest || { url: dataUrl, kb: dataUrlKB(dataUrl) }), doc };
}

/* last-resort: force ANY page under budget using 1-bit at low res */
export async function compressPageForce(dataUrl, targetKB) {
  const img = await loadImage(dataUrl);
  for (const w of [900, 700, 550, 430, 340, 260, 200, 150, 120]) {
    const enc = await oneBitAt(img, w);
    if (enc.kb <= targetKB) return enc.url;
  }
  const last = await oneBitAt(img, 120);
  return last.url;
}

export async function estimatePageKB(dataUrl) {
  const img = await loadImage(dataUrl);
  return detectDoc(img) ? 8 : 30;
}

export async function compressImageToTarget(dataUrl, targetKB, mime = 'image/jpeg', onProgress, opts = {}) {
  const gray = !!opts.gray, contrast = opts.readable !== false;
  const want = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const origKB = dataUrlKB(dataUrl);
  const img = await loadImage(dataUrl);
  if (!isFinite(targetKB) || origKB <= targetKB) {
    if (dataUrl.startsWith('data:' + want) && !gray && !contrast) { onProgress && onProgress(100); return dataUrl; }
    const conv = (want === 'image/png' && detectDoc(img)) ? await oneBitAt(img, img.width) : jpegAt(img, img.width, 0.9, gray, contrast);
    onProgress && onProgress(100);
    return conv.kb <= origKB ? conv.url : dataUrl;
  }
  const doc = detectDoc(img);
  let smallest = null;
  const widths = ladder(img, 1600, 120);
  for (let i = 0; i < widths.length; i++) {
    onProgress && onProgress(Math.min(92, Math.round((i / widths.length) * 92)));
    if (doc && want === 'image/png') {
      const enc = await oneBitAt(img, widths[i]);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) { onProgress && onProgress(100); return enc.url; }
    } else if (doc) {
      const bl = await oneBitAt(img, widths[i]);
      const bimg = await loadImage(bl.url);
      const enc = jpegAt(bimg, bimg.width, 0.8, gray, false);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) { onProgress && onProgress(100); return enc.url; }
    } else {
      const fit = bestJpegAtWidth(img, widths[i], targetKB, gray, contrast);
      if (fit) { onProgress && onProgress(100); return fit.url; }
      const minEnc = jpegAt(img, widths[i], 0.1, gray, contrast);
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
  }
  onProgress && onProgress(100);
  return smallest ? smallest.url : dataUrl;
}
export async function compressToTarget(dataUrl, targetKB, onProgress) {
  return compressImageToTarget(dataUrl, targetKB, 'image/jpeg', onProgress, {});
}

export async function convertToPng(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0); return c.toDataURL('image/png');
}
export async function convertToJpg(dataUrl, q = 0.92) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0); return c.toDataURL('image/jpeg', q);
}
export async function dataUrlToBlob(dataUrl, name) {
  const res = await fetch(dataUrl); const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}
export function blobToBase64(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
}
export async function shareBlob(blob, filename) {
  try {
    const { Share } = await import('@capacitor/share');
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const b64 = await blobToBase64(blob);
    const uri = await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache, recursive: true });
    await Share.share({ title: filename, text: filename, url: uri.uri, dialogTitle: 'Save / Print / Share' });
    return;
  } catch (e) { console.warn('share fallback', e); }
  if (blob instanceof Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
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
async function buildPdfFromPages(pages, wPt, hPt) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: [wPt, hPt], compress: true });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage([wPt, hPt]);
    const isPng = pages[i].startsWith('data:image/png');
    try { pdf.addImage(pages[i], isPng ? 'PNG' : 'JPEG', 0, 0, wPt, hPt, undefined, 'FAST'); }
    catch (e) { const j = await convertToJpg(pages[i], 0.7); pdf.addImage(j, 'JPEG', 0, 0, wPt, hPt, undefined, 'FAST'); }
  }
  return pdf.output('blob');
}

export async function compressPdfToTarget(images, targetKB, onProgress, opts = {}, origBytes, indices) {
  const origSize = origBytes ? origBytes.byteLength : Infinity;
  if (origBytes && !isFinite(targetKB)) {
    const subset = await pdfSubsetLossless(origBytes, indices || []);
    onProgress && onProgress(100);
    return subset.size <= origSize ? subset : new Blob([origBytes], { type: 'application/pdf' });
  }
  if (origBytes) {
    const subset = await pdfSubsetLossless(origBytes, indices || []);
    if (subset.size <= targetKB * 1024) { onProgress && onProgress(100); return subset; }
  }
  const n = Math.max(1, images.length);
  let per = Math.max(1, Math.floor((targetKB * 0.94) / n));
  let blob = null;
  for (let round = 0; round < 4; round++) {
    const pages = [];
    for (let i = 0; i < images.length; i++) {
      const r = await compressPageToTarget(images[i], per, opts);
      pages.push(r.url);
      onProgress && onProgress(Math.min(80, Math.round(((i + 1) / images.length) * 60) + round * 5));
    }
    blob = await buildPdfFromPages(pages, 595.28, 841.89);
    if (blob.size <= targetKB * 1024) { onProgress && onProgress(100); return blob; }
    per = Math.max(1, Math.floor(per * ((targetKB * 1024) / blob.size) * 0.95));
  }
  // GUARANTEED pass: 1-bit every page until under target
  for (let guard = 0; guard < 3 && blob.size > targetKB * 1024; guard++) {
    const pages = [];
    const tight = Math.max(1, Math.floor((targetKB * 0.9) / n));
    for (let i = 0; i < images.length; i++) pages.push(await compressPageForce(images[i], tight));
    blob = await buildPdfFromPages(pages, 595.28, 841.89);
    onProgress && onProgress(85 + guard * 4);
  }
  if (origBytes && blob.size > origSize) blob = await pdfSubsetLossless(origBytes, indices || []);
  onProgress && onProgress(100);
  return blob;
}
