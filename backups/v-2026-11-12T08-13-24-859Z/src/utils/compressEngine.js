import { loadImage, dataUrlKB } from './imageUtils.js';

// ---- document detection: mostly-white + low colour => text page ----
function detectDoc(img) {
  const s = 160;
  const c = document.createElement('canvas'); c.width = s; c.height = s;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, s, s);
  const d = ctx.getImageData(0, 0, s, s).data;
  let white = 0, satSum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 235) white++;
    satSum += (Math.max(r, g, b) - Math.min(r, g, b));
  }
  const n = d.length / 4;
  return (white / n) > 0.55 && (satSum / n) < 40;
}

// ---- bi-level (1-bit) render: pure black text on white = crisp at low KB ----
function bilevelPngAt(img, width) {
  const w = Math.max(24, Math.round(Math.min(width, img.width)));
  const h = Math.max(24, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const p = id.data;
  for (let i = 0; i < p.length; i += 4) {
    const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    const v = lum < 150 ? 0 : 255;
    p[i] = v; p[i + 1] = v; p[i + 2] = v; p[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  const url = c.toDataURL('image/png');
  return { url, kb: dataUrlKB(url) };
}

function jpegAt(img, width, q, gray, contrast) {
  const w = Math.max(24, Math.round(Math.min(width, img.width)));
  const h = Math.max(24, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  const f = [];
  if (gray) f.push('grayscale(1)');
  if (contrast) f.push('contrast(1.12)');
  if (f.length) ctx.filter = f.join(' ');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url) };
}

function ladder(img, cap) {
  const out = [];
  let w = Math.min(img.width, cap || 1600);
  while (w >= 150) { out.push(Math.round(w)); w *= 0.8; }
  out.push(150);
  return out;
}

function bestJpegAtWidth(img, w, targetKB, gray, contrast) {
  const minEnc = jpegAt(img, w, 0.15, gray, contrast);
  if (minEnc.kb > targetKB) return null;
  let lo = 0.15, hi = 0.92, best = minEnc;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    const enc = jpegAt(img, w, mid, gray, contrast);
    if (enc.kb <= targetKB) { best = enc; lo = mid; } else hi = mid;
  }
  return best;
}

// Per-page: text pages -> bi-level PNG ladder; photos -> JPEG ladder. Hard target.
export async function compressPageToTarget(dataUrl, targetKB, opts = {}) {
  const img = await loadImage(dataUrl);
  const doc = detectDoc(img);
  const gray = !!opts.gray, contrast = opts.readable !== false;
  let smallest = null;
  if (doc) {
    for (const w of ladder(img, 1600)) {
      const enc = bilevelPngAt(img, w);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) return { ...enc, doc };
    }
  } else {
    for (const w of ladder(img, 1600)) {
      const fit = bestJpegAtWidth(img, w, targetKB, gray, contrast);
      if (fit) return { ...fit, doc };
      const minEnc = jpegAt(img, w, 0.15, gray, contrast);
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
  }
  return { ...(smallest || { url: dataUrl, kb: dataUrlKB(dataUrl) }), doc };
}

export async function estimatePageKB(dataUrl) {
  const img = await loadImage(dataUrl);
  return detectDoc(img) ? 12 : 30;
}

export async function compressImageToTarget(dataUrl, targetKB, mime = 'image/jpeg', onProgress, opts = {}) {
  const gray = !!opts.gray, contrast = opts.readable !== false;
  const want = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const origKB = dataUrlKB(dataUrl);
  const img = await loadImage(dataUrl);
  if (!isFinite(targetKB) || origKB <= targetKB) {
    if (dataUrl.startsWith('data:' + want) && !gray && !contrast) { onProgress && onProgress(100); return dataUrl; }
    const conv = want === 'image/png' ? bilevelOrPng(img, gray) : jpegAt(img, img.width, 0.9, gray, contrast);
    onProgress && onProgress(100);
    return conv.kb <= origKB ? conv.url : dataUrl;
  }
  const doc = detectDoc(img);
  let smallest = null;
  const widths = ladder(img, 1600);
  for (let i = 0; i < widths.length; i++) {
    onProgress && onProgress(Math.min(92, Math.round((i / widths.length) * 92)));
    if (doc && want === 'image/png') {
      const enc = bilevelPngAt(img, widths[i]);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) { onProgress && onProgress(100); return enc.url; }
    } else if (doc && want === 'image/jpeg') {
      // crisp black/white then jpeg (sharper than grey blur for text)
      const bl = bilevelPngAt(img, widths[i]);
      const bimg = await loadImage(bl.url);
      const enc = jpegAt(bimg, bimg.width, 0.75, gray, false);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) { onProgress && onProgress(100); return enc.url; }
    } else {
      const fit = bestJpegAtWidth(img, widths[i], targetKB, gray, contrast);
      if (fit) { onProgress && onProgress(100); return fit.url; }
      const minEnc = jpegAt(img, widths[i], 0.15, gray, contrast);
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
  }
  onProgress && onProgress(100);
  return smallest ? smallest.url : dataUrl;
}
function bilevelOrPng(img, gray) {
  if (gray) return bilevelPngAt(img, img.width);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  const url = c.toDataURL('image/png');
  return { url, kb: dataUrlKB(url) };
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
    const fmt = pages[i].startsWith('data:image/png') ? 'PNG' : 'JPEG';
    pdf.addImage(pages[i], fmt, 0, 0, wPt, hPt, undefined, 'FAST');
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
  let per = Math.max(2, Math.floor((targetKB * 0.94) / n));
  let blob = null;
  for (let round = 0; round < 5; round++) {
    const pages = [];
    for (let i = 0; i < images.length; i++) {
      const r = await compressPageToTarget(images[i], per, opts);
      pages.push(r.url);
      onProgress && onProgress(Math.min(88, Math.round(((i + 1) / images.length) * 70) + round * 4));
    }
    blob = await buildPdfFromPages(pages, 595.28, 841.89);
    if (blob.size <= targetKB * 1024) break;
    per = Math.max(2, Math.floor(per * ((targetKB * 1024) / blob.size) * 0.95));
  }
  if (origBytes && blob.size > origSize) blob = await pdfSubsetLossless(origBytes, indices || []);
  onProgress && onProgress(100);
  return blob;
}
