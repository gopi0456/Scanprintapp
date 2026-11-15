import { loadImage, dataUrlKB } from './imageUtils.js';
export { dataUrlKB } from './imageUtils.js';

/* hc modes GUARANTEE the target (they keep descending until it fits).
   lc_hq protects readability and honestly reports if it exceeds the target. */
export const MODES = {
  hc_hq: { label: 'High compress + High quality', hint: 'Hits your target · best clarity that size allows', qMin: 0.50, minScale: 0.06, relax: true },
  hc_lq: { label: 'High compress + Low quality',  hint: 'Hits your target · smallest file, softer text',   qMin: 0.28, minScale: 0.06, relax: true },
  lc_hq: { label: 'Less compress + High quality', hint: 'Keeps text readable · may exceed your target',    qMin: 0.72, minScale: 0.45, relax: false }
};
const SCALES = [1, .88, .76, .66, .56, .48, .40, .34, .28, .24, .20, .17, .14, .12, .10, .085, .07, .06];
const RELAX_Q = [.44, .36, .30, .24, .19, .15, .12];

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
/* trim empty margins so the byte budget is spent on content, not blank paper */
function contentBox(img) {
  const s = 240;
  const c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, s, s); x.drawImage(img, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  let x0 = s, y0 = s, x1 = -1, y1 = -1;
  for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
    const i = (yy * s + xx) * 4;
    if (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2] < 238) {
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
  const s = 150; const c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  let white = 0, colored = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (.299 * r + .587 * g + .114 * b > 220) white++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 55) colored++;
  }
  const n = d.length / 4;
  return white / n > 0.45 && colored / n < 0.06;
}
/* soft grayscale JPEG — no thresholding (no fat black letters), no sharpen (no size blow-up) */
function jpegAt(img, width, q, gray, textMode) {
  const w = Math.max(40, Math.round(Math.min(width, img.width)));
  const h = Math.max(40, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  const f = [];
  if (gray || textMode) f.push('grayscale(1)');
  if (textMode) f.push('contrast(1.10)', 'brightness(1.03)');
  if (f.length) x.filter = f.join(' ');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url), px: w };
}
/* ONE compressor for preview AND save. Descends until the budget is met. */
export function compressRasterPage(img, budgetKB, mode = 'hc_hq', gray = false) {
  const cfg = MODES[mode] || MODES.hc_hq;
  const box = contentBox(img);
  const src = cropTo(img, box);
  const textMode = isTextPage(src);
  const budget = Math.max(0.5, budgetKB);
  let best = null;
  const keep = (e, s, q) => { if (!best || e.kb < best.kb) best = { ...e, box, scale: s, q, textMode }; };
  for (const s of SCALES) {
    if (s < cfg.minScale) break;
    const w = Math.max(40, src.width * s);
    const low = jpegAt(src, w, cfg.qMin, gray, textMode);
    keep(low, s, cfg.qMin);
    if (low.kb > budget) continue;
    let lo = cfg.qMin, hi = 0.94, fit = low, fq = cfg.qMin;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      const e = jpegAt(src, w, mid, gray, textMode);
      if (e.kb <= budget) { fit = e; fq = mid; lo = mid; } else hi = mid;
    }
    return { ...fit, box, scale: s, q: fq, textMode };
  }
  if (cfg.relax) {
    for (const s of [.20, .17, .14, .12, .10, .085, .07, .06]) {
      const w = Math.max(40, src.width * s);
      for (const q of RELAX_Q) {
        const e = jpegAt(src, w, q, gray, textMode);
        keep(e, s, q);
        if (e.kb <= budget) return { ...e, box, scale: s, q, textMode };
      }
    }
  }
  return best;
}
export function computeBudgets(count, targetKB, origKB) {
  const n = Math.max(1, count);
  const base = targetKB > 0 ? Math.min(targetKB, origKB || targetKB) : (origKB || 400);
  return Array.from({ length: n }, () => Math.max(0.5, (base * 0.95) / n));
}
export function readableMinimum(count) { return Math.round(Math.max(1, count) * 45); }
export function qualityBand(perPageKB) {
  if (perPageKB < 12) return { key: 'low', label: 'Low clarity', note: 'Text will be hard to read at this size.' };
  if (perPageKB < 26) return { key: 'mid', label: 'Medium clarity', note: 'Headings read; small table text is soft.' };
  if (perPageKB < 45) return { key: 'ok', label: 'Good clarity', note: 'Most table text stays readable.' };
  return { key: 'high', label: 'High clarity', note: 'Close to the original scan.' };
}
export async function pageImage(entry) {
  if (entry.bytes && entry.pageIdx != null) return renderPageCanvas(entry.bytes, entry.pageIdx, 3);
  return loadImage(entry.dataUrl);
}
export async function compressPdfWithMode(entries, targetKB, origKB, mode, gray, onProgress) {
  const { PDFDocument } = await import('pdf-lib');
  const finite = isFinite(targetKB) && targetKB > 0;
  const build = async (budgets) => {
    const out = await PDFDocument.create();
    const per = [];
    for (let i = 0; i < entries.length; i++) {
      const r = compressRasterPage(await pageImage(entries[i]), budgets[i], mode, gray);
      per.push({ kb: r.kb, px: r.px, q: r.q });
      const emb = await out.embedJpg(r.url);
      const W = entries[i].w || 595.28, H = entries[i].h || 841.89;
      const pg = out.addPage([W, H]);
      const b = r.box || { rx: 0, ry: 0, rw: 1, rh: 1 };
      pg.drawImage(emb, { x: b.rx * W, y: (1 - b.ry - b.rh) * H, width: b.rw * W, height: b.rh * H });
      onProgress && onProgress(Math.round(((i + 1) / entries.length) * 92));
    }
    const blob = new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
    return { blob, per };
  };
  let budgets = computeBudgets(entries.length, targetKB, origKB);
  let res = await build(budgets);
  const cfg = MODES[mode] || MODES.hc_hq;
  if (finite && cfg.relax && res.blob.size > targetKB * 1024) {
    const k = (targetKB * 1024 * 0.93) / res.blob.size;
    res = await build(budgets.map(b => Math.max(0.4, b * k)));
  }
  if (origKB && res.blob.size > origKB * 1024) {
    res = await build(computeBudgets(entries.length, origKB * 0.9, origKB));
  }
  onProgress && onProgress(100);
  return res;
}
export async function compressImageToTarget(dataUrl, targetKB, mime, mode, gray, onProgress) {
  const img = await loadImage(dataUrl);
  if (mime === 'image/png') {
    let s = 1, best = null;
    while (s >= 0.06) {
      const w = Math.max(40, Math.round(img.width * s)), h = Math.max(40, Math.round(img.height * s));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
      const url = c.toDataURL('image/png'); const kb = dataUrlKB(url);
      if (!targetKB || kb <= targetKB) { onProgress && onProgress(100); return url; }
      if (!best || kb < best.kb) best = { url, kb }; s *= 0.8;
    }
    onProgress && onProgress(100); return best ? best.url : dataUrl;
  }
  const r = compressRasterPage(img, targetKB || dataUrlKB(dataUrl), mode, gray);
  onProgress && onProgress(100); return r.url;
}
export async function convertToJpg(d, q = .92) { const i = await loadImage(d); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(i, 0, 0); return c.toDataURL('image/jpeg', q); }
export async function convertToPng(d) { const i = await loadImage(d); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; c.getContext('2d').drawImage(i, 0, 0); return c.toDataURL('image/png'); }
export async function dataUrlToBlob(d, n) { const r = await fetch(d); const b = await r.blob(); return new File([b], n, { type: b.type || 'application/octet-stream' }); }
export function blobToBase64(b) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); }); }
export async function shareBlob(blob, filename) {
  try { const { Share } = await import('@capacitor/share'); const { Filesystem, Directory } = await import('@capacitor/filesystem'); const b64 = await blobToBase64(blob); const uri = await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache, recursive: true }); await Share.share({ title: filename, text: filename, url: uri.uri, dialogTitle: 'Save / Share' }); return; } catch (e) { console.warn('share fallback', e); }
  if (blob instanceof Blob) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
}
