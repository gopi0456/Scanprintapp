import { loadImage, dataUrlKB } from './imageUtils.js';

// ADVANCED: binary-search quality at multiple scales.
// Returns the LARGEST file that is <= target (as close to target as possible),
// guaranteeing it never exceeds the size you typed.
export async function compressToTarget(dataUrl, targetKB, onProgress) {
  const target = Math.max(1, Math.round(targetKB));
  const originalKB = dataUrlKB(dataUrl);
  if (originalKB <= target) { if (onProgress) onProgress(100); return dataUrl; }

  const img = await loadImage(dataUrl);
  let best = null; // {url, kb} where kb <= target, maximize kb

  const scales = [1, 0.85, 0.7, 0.6, 0.5, 0.4, 0.32, 0.25, 0.2, 0.16, 0.125, 0.1, 0.08, 0.0625, 0.05, 0.04, 0.03, 0.02, 0.015, 0.01];

  for (let s = 0; s < scales.length; s++) {
    const scale = scales[s];
    const w = Math.max(16, Math.round(img.width * scale));
    const h = Math.max(16, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    // Binary search quality for the biggest size that still fits under target
    let lo = 0.01, hi = 0.95, candidate = null;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      const url = canvas.toDataURL('image/jpeg', mid);
      const kb = dataUrlKB(url);
      if (kb <= target) { candidate = { url, kb }; lo = mid; }
      else { hi = mid; }
    }

    if (candidate && (!best || candidate.kb > best.kb)) best = candidate;
    if (best && best.kb >= target * 0.92) break; // within 8% of target: good enough

    if (onProgress) onProgress(Math.min(95, Math.round(((s + 1) / scales.length) * 100)));
  }

  if (onProgress) onProgress(100);
  if (best) return best.url;

  // Absolute last resort (target impossibly small): 16px @ q0.01
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  c.getContext('2d').drawImage(img, 0, 0, 16, 16);
  return c.toDataURL('image/jpeg', 0.01);
}

export async function convertToPng(dataUrl) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/png');
}

export async function convertToJpg(dataUrl, quality = 0.92) {
  const img = await loadImage(dataUrl);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/jpeg', quality);
}

export async function dataUrlToBlob(dataUrl, name) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

export function blobToBase64(blob) {
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.readAsDataURL(blob);
  });
}

// ===== LOSSLESS PDF COMPRESSION (keeps text selectable & formatting) =====
export async function compressPdfLossless(arrayBuffer) {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
  doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
  doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
  const bytes = await doc.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}

// Safe share/download for any blob (no createObjectURL crashes)
export async function shareBlob(blob, filename) {
  try {
    const { Share } = await import('@capacitor/share');
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const b64 = await blobToBase64(blob);
    const uri = await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache, recursive: true });
    await Share.share({ title: filename, text: filename, url: uri.uri, dialogTitle: 'Save / Print / Share' });
    return;
  } catch (e) { console.warn('share failed', e); }
  if (blob instanceof Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
