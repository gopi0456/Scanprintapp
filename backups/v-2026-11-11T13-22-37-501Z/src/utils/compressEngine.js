import { loadImage, dataUrlKB } from './imageUtils.js';

function scaledCanvas(img, scale, gray) {
  const w = Math.max(32, Math.round(img.width * scale));
  const h = Math.max(32, Math.round(img.height * scale));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  if (gray) ctx.filter = 'grayscale(1) contrast(1.06)';
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

// Clarity-first: keep JPEG quality >= floor (letters stay crisp) and shrink RESOLUTION instead.
export async function compressImageToTarget(dataUrl, targetKB, mime = 'image/jpeg', onProgress, opts = {}) {
  const sharp = opts.sharp !== false;
  const gray = !!opts.gray;
  const want = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const origKB = dataUrlKB(dataUrl);
  if (origKB <= targetKB && dataUrl.startsWith('data:' + want) && !gray) { onProgress && onProgress(100); return dataUrl; }
  const img = await loadImage(dataUrl);
  const qFloor = sharp ? 0.55 : 0.05;
  let scale = Math.min(1, Math.sqrt(targetKB / Math.max(1, origKB)) * (sharp ? 1.2 : 1.6));
  scale = Math.max(0.08, scale);
  let best = null;
  for (let round = 0; round < 8; round++) {
    const c = scaledCanvas(img, scale, gray);
    if (want === 'image/png') {
      const url = c.toDataURL('image/png'); const kb = dataUrlKB(url);
      if (kb <= targetKB) { onProgress && onProgress(100); return url; }
      if (!best || kb < best.kb) best = { url, kb };
      scale *= Math.max(0.5, Math.sqrt(targetKB / Math.max(1, kb)));
    } else {
      let lo = qFloor, hi = 0.92, cand = null;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        const url = c.toDataURL('image/jpeg', mid); const kb = dataUrlKB(url);
        if (kb <= targetKB) { cand = { url, kb }; lo = mid; } else hi = mid;
      }
      if (cand) { onProgress && onProgress(100); return cand.url; }
      const floorUrl = c.toDataURL('image/jpeg', qFloor); const fkb = dataUrlKB(floorUrl);
      if (!best || fkb < best.kb) best = { url: floorUrl, kb: fkb };
      scale *= Math.max(0.5, Math.sqrt(targetKB / Math.max(1, fkb)) * 0.95);
    }
    scale = Math.max(0.06, scale);
    onProgress && onProgress(Math.min(90, (round + 1) * 11));
  }
  if (best && best.kb > targetKB) {
    const img2 = await loadImage(best.url);
    const c = scaledCanvas(img2, 1, gray);
    let lo = 0.1, hi = qFloor, cand = null;
    for (let k = 0; k < 6; k++) { const mid = (lo + hi) / 2; const url = c.toDataURL('image/jpeg', mid); const kb = dataUrlKB(url); if (kb <= targetKB) { cand = { url, kb }; lo = mid; } else hi = mid; }
    if (cand) best = cand;
  }
  onProgress && onProgress(100);
  return best ? best.url : dataUrl;
}
export async function compressToTarget(dataUrl, targetKB, onProgress) {
  return compressImageToTarget(dataUrl, targetKB, 'image/jpeg', onProgress, { sharp: true });
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
  for (let round = 0; round < 3; round++) {
    const jpegs = [];
    for (let i = 0; i < images.length; i++) {
      jpegs.push(await compressImageToTarget(images[i], per, 'image/jpeg', null, opts));
      onProgress && onProgress(Math.min(80, Math.round(((i + 1) / images.length) * 60) + round * 10));
    }
    blob = await buildPdfFromJpegs(jpegs, 595.28, 841.89);
    if (blob.size <= targetKB * 1024) { onProgress && onProgress(100); return blob; }
    per = Math.max(2, Math.floor(per * ((targetKB * 1024) / blob.size) * 0.9));
  }
  onProgress && onProgress(100);
  return blob;
}
