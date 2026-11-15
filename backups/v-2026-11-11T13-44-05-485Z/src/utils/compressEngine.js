import { loadImage, dataUrlKB } from './imageUtils.js';

function encodeAt(img, width, q, gray, mime) {
  const w = Math.max(16, Math.round(width));
  const h = Math.max(16, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  if (gray) ctx.filter = 'grayscale(1) contrast(1.05)';
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const url = mime === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url) };
}

// READABLE-FIRST: keep width >= 1000px so letters stay legible; shrink quality first.
// forceExact (readable=false) may go below 1000px to hit a tiny target.
export async function compressImageToTarget(dataUrl, targetKB, mime = 'image/jpeg', onProgress, opts = {}) {
  const readable = opts.readable !== false;
  const gray = !!opts.gray || (readable && opts.autoGray !== false);
  const want = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const origKB = dataUrlKB(dataUrl);
  if (origKB <= targetKB && dataUrl.startsWith('data:' + want) && !gray) { onProgress && onProgress(100); return dataUrl; }
  const img = await loadImage(dataUrl);

  const widths = [1600, 1400, 1200, 1000];
  const quals = [0.8, 0.68, 0.56, 0.48];
  let last = null;
  let step = 0; const total = widths.length * quals.length;
  for (const w of widths) {
    for (const q of quals) {
      const r = encodeAt(img, Math.min(w, img.width), q, gray, want);
      last = r; step++;
      onProgress && onProgress(Math.min(90, Math.round((step / total) * 90)));
      if (r.kb <= targetKB) { onProgress && onProgress(100); return r.url; }
    }
  }
  if (readable) { onProgress && onProgress(100); return last.url; } // legible, may exceed tiny target

  // force-exact: go smaller
  const fw = [800, 600, 450, 320, 220];
  const fq = [0.5, 0.4, 0.3, 0.2];
  for (const w of fw) for (const q of fq) {
    const r = encodeAt(img, w, q, gray, want);
    last = r;
    if (r.kb <= targetKB) { onProgress && onProgress(100); return r.url; }
  }
  onProgress && onProgress(100);
  return last.url;
}
export async function compressToTarget(dataUrl, targetKB, onProgress) {
  return compressImageToTarget(dataUrl, targetKB, 'image/jpeg', onProgress, { readable: true });
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
export async function compressPdfToTarget(images, targetKB, onProgress, opts = {}) {
  const n = Math.max(1, images.length);
  let per = Math.max(3, Math.floor((targetKB * 0.92) / n));
  let blob = null;
  const rounds = opts.readable === false ? 3 : 1;
  for (let round = 0; round < rounds; round++) {
    const jpegs = [];
    for (let i = 0; i < images.length; i++) {
      jpegs.push(await compressImageToTarget(images[i], per, 'image/jpeg', null, opts));
      onProgress && onProgress(Math.min(85, Math.round(((i + 1) / images.length) * 70) + round * 8));
    }
    blob = await buildPdfFromJpegs(jpegs, 595.28, 841.89);
    if (blob.size <= targetKB * 1024) { onProgress && onProgress(100); return blob; }
    per = Math.max(2, Math.floor(per * ((targetKB * 1024) / blob.size) * 0.9));
  }
  onProgress && onProgress(100);
  return blob;
}
