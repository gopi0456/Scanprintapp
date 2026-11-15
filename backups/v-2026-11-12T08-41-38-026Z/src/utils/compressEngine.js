import { loadImage, dataUrlKB } from './imageUtils.js';

// Per-page readability floors (KB). Below these, text is NOT legible.
export const FLOOR_DOC = 30;    // black & white text page
export const FLOOR_COLOR = 60;  // colour page / photo

async function analyze(img) {
  const c = document.createElement('canvas'); c.width = 48; c.height = 48;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 48, 48);
  const d = ctx.getImageData(0, 0, 48, 48).data;
  let sat = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const mx = Math.max(d[i], d[i + 1], d[i + 2]);
    const mn = Math.min(d[i], d[i + 1], d[i + 2]);
    sat += mx ? (mx - mn) / mx : 0; n++;
  }
  return { doc: (sat / n) < 0.12 };
}

function encodeAt(img, width, q, fx, mime) {
  const w = Math.max(24, Math.round(Math.min(width, img.width)));
  const h = Math.max(24, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  const f = [];
  if (fx.gray) f.push('grayscale(1)');
  if (fx.contrast) f.push('contrast(1.45)');
  if (f.length) ctx.filter = f.join(' ');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const url = mime === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url) };
}

function ladder(img, doc) {
  const out = [];
  let w = Math.min(img.width, doc ? 1500 : 1600);
  while (w >= 150) { out.push(Math.round(w)); w *= 0.8; }
  out.push(150);
  return out;
}

function bestQualityAtWidth(img, w, targetKB, fx, mime) {
  const minEnc = encodeAt(img, w, 0.15, fx, mime);
  if (minEnc.kb > targetKB) return null;
  let lo = 0.15, hi = 0.92, best = minEnc;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    const enc = encodeAt(img, w, mid, fx, mime);
    if (enc.kb <= targetKB) { best = enc; lo = mid; } else hi = mid;
  }
  return best;
}

export async function compressImageToTarget(dataUrl, targetKB, mime = 'image/jpeg', onProgress, opts = {}) {
  const readable = opts.readable !== false;
  const want = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const origKB = dataUrlKB(dataUrl);
  const img = await loadImage(dataUrl);
  const doc = opts.autoDoc !== false ? (await analyze(img)).doc : false;
  const fx = { gray: !!opts.gray || (readable && doc), contrast: readable && doc };
  const floor = doc ? FLOOR_DOC : FLOOR_COLOR;

  let effTarget = targetKB;
  if (readable && isFinite(targetKB) && targetKB < floor) effTarget = floor; // readability protection

  if (!isFinite(targetKB) || origKB <= effTarget) {
    if (dataUrl.startsWith('data:' + want) && !fx.gray && !fx.contrast) { onProgress && onProgress(100); return dataUrl; }
    const conv = encodeAt(img, img.width, 0.9, fx, want);
    onProgress && onProgress(100);
    return conv.kb <= origKB ? conv.url : dataUrl;
  }

  const widths = ladder(img, doc);
  let smallest = null;
  for (let i = 0; i < widths.length; i++) {
    onProgress && onProgress(Math.min(92, Math.round((i / widths.length) * 92)));
    if (want === 'image/png') {
      const enc = encodeAt(img, widths[i], 1, fx, 'image/png');
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= effTarget) { onProgress && onProgress(100); return enc.url; }
    } else {
      const fit = bestQualityAtWidth(img, widths[i], effTarget, fx, want);
      if (fit) { onProgress && onProgress(100); return fit.url; }
      const minEnc = encodeAt(img, widths[i], 0.15, fx, want);
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
  }
  onProgress && onProgress(100);
  return smallest && smallest.kb < origKB ? smallest.url : dataUrl;
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
async function buildPdfFromJpegs(jpegs, wPt, hPt) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'pt', format: [wPt, hPt], compress: true });
  for (let i = 0; i < jpegs.length; i++) { if (i > 0) pdf.addPage([wPt, hPt]); pdf.addImage(jpegs[i], 'JPEG', 0, 0, wPt, hPt, undefined, 'FAST'); }
  return pdf.output('blob');
}

export async function compressPdfToTarget(images, targetKB, onProgress, opts = {}, origBytes, indices) {
  const readable = opts.readable !== false;
  const origSize = origBytes ? origBytes.byteLength : Infinity;
  if (origBytes && !isFinite(targetKB)) {
    const s = await pdfSubsetLossless(origBytes, indices || []);
    onProgress && onProgress(100);
    return s.size <= origSize ? s : new Blob([origBytes], { type: 'application/pdf' });
  }
  if (origBytes) {
    const s = await pdfSubsetLossless(origBytes, indices || []);
    if (s.size <= targetKB * 1024) { onProgress && onProgress(100); return s; }
  }
  const n = Math.max(1, images.length);
  const per = readable ? Math.max(FLOOR_DOC, Math.floor((targetKB * 0.94) / n)) : Math.max(2, Math.floor((targetKB * 0.94) / n));
  let blob = null;
  const rounds = readable ? 1 : 5;
  let cur = per;
  for (let round = 0; round < rounds; round++) {
    const jpegs = [];
    for (let i = 0; i < images.length; i++) {
      jpegs.push(await compressImageToTarget(images[i], cur, 'image/jpeg', null, opts));
      onProgress && onProgress(Math.min(88, Math.round(((i + 1) / images.length) * 70) + round * 4));
    }
    blob = await buildPdfFromJpegs(jpegs, 595.28, 841.89);
    if (blob.size <= targetKB * 1024) break;
    if (readable) break; // floor protects readability; report achieved size
    cur = Math.max(2, Math.floor(cur * ((targetKB * 1024) / blob.size) * 0.95));
  }
  if (origBytes && blob.size > origSize) blob = await pdfSubsetLossless(origBytes, indices || []);
  onProgress && onProgress(100);
  return blob;
}
