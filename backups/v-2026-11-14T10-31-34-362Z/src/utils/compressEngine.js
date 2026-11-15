import { loadImage, dataUrlKB } from './imageUtils.js';
export { dataUrlKB } from './imageUtils.js';

/* Text sharpness comes from PIXELS, not JPEG quality.
   Each mode picks the quality it spends, then we buy the maximum resolution that fits. */
export const MODES = {
  hc_hq: { label: 'High compress + High quality', hint: 'Most pixels for your size · balanced encoding', textQ: 0.30, photoQ: 0.55, icon: '⚖️' },
  hc_lq: { label: 'High compress + Low quality',  hint: 'Maximum pixels · coarser encoding, smallest file', textQ: 0.17, photoQ: 0.32, icon: '🗜️' },
  lc_hq: { label: 'Less compress + High quality', hint: 'Cleanest encoding · fewer pixels, larger file', textQ: 0.62, photoQ: 0.80, icon: '💎' }
};

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
export async function renderPageCanvas(bytes, pageIdx, scale = 2.6) {
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
function jpegAt(img, width, q, gray, textMode) {
  const w = Math.max(48, Math.round(Math.min(width, img.width)));
  const h = Math.max(48, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  const f = [];
  if (gray || textMode) f.push('grayscale(1)');
  if (textMode) f.push('contrast(1.16)', 'brightness(1.05)');
  if (f.length) x.filter = f.join(' ');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url), px: w, q };
}
/* Binary-search the LARGEST width that fits, then spend any remainder on quality. */
function encodeMaxResolution(src, budget, startQ, gray, textMode) {
  const MIN_W = 160;
  let lo = MIN_W, hi = src.width;
  let best = jpegAt(src, lo, startQ, gray, textMode);
  if (best.kb > budget) {
    for (const qq of [startQ * 0.75, startQ * 0.55, 0.14, 0.09]) {
      const e = jpegAt(src, lo, Math.max(0.06, qq), gray, textMode);
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
  for (const bump of [0.07, 0.15, 0.24, 0.34]) {
    const qq = Math.min(0.93, startQ + bump);
    const e = jpegAt(src, lo, qq, gray, textMode);
    if (e.kb <= budget) best = e; else break;
  }
  return best;
}
/* ONE encoder for preview and save — identical inputs produce identical bytes. */
export function compressRasterPage(img, budgetKB, mode = 'hc_hq', gray = false) {
  const cfg = MODES[mode] || MODES.hc_hq;
  const box = contentBox(img);
  const src = cropTo(img, box);
  const textMode = isTextPage(src);
  const q = textMode ? cfg.textQ : cfg.photoQ;
  const r = encodeMaxResolution(src, Math.max(0.4, budgetKB), q, gray, textMode);
  return { ...r, box, textMode };
}
export function computeBudgets(count, targetKB, origKB) {
  const n = Math.max(1, count);
  const base = targetKB > 0 ? Math.min(targetKB, origKB || targetKB) : (origKB || 400);
  return Array.from({ length: n }, () => Math.max(0.4, (base * 0.955) / n));
}
/* Predicted pixel width for a page at a given budget — shown before you commit. */
export function predictWidth(perPageKB, mode = 'hc_hq') {
  const cfg = MODES[mode] || MODES.hc_hq;
  const k = cfg.textQ < 0.25 ? 34 : cfg.textQ < 0.45 ? 27 : 19;
  return Math.round(Math.max(150, Math.min(1600, k * Math.sqrt(Math.max(1, perPageKB)) * 3.2)));
}
export function clarityFor(widthPx) {
  if (widthPx < 420) return { key: 'bad', label: 'Unreadable', note: 'Below ~420 px a dense table cannot be read. Raise the target or reduce pages.' };
  if (widthPx < 650) return { key: 'low', label: 'Barely legible', note: 'Headings read; fine print will be soft.' };
  if (widthPx < 950) return { key: 'ok', label: 'Readable', note: 'Most table text stays legible at this width.' };
  return { key: 'high', label: 'Sharp', note: 'Close to the original scan detail.' };
}
export function readableMinimum(count) { return Math.round(Math.max(1, count) * 62); }
export async function pageImage(entry) {
  if (entry.bytes && entry.pageIdx != null) return renderPageCanvas(entry.bytes, entry.pageIdx, 2.6);
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
  let res = await build(computeBudgets(entries.length, targetKB, origKB));
  if (finite && res.blob.size > targetKB * 1024) {
    const k = (targetKB * 1024 * 0.94) / res.blob.size;
    res = await build(computeBudgets(entries.length, targetKB, origKB).map(b => Math.max(0.3, b * k)));
  }
  if (origKB && res.blob.size > origKB * 1024) res = await build(computeBudgets(entries.length, origKB * 0.92, origKB));
  onProgress && onProgress(100);
  return res;
}
export async function compressImageToTarget(dataUrl, targetKB, mime, mode, gray, onProgress) {
  const img = await loadImage(dataUrl);
  if (mime === 'image/png') {
    let lo = 160, hi = img.width, best = null;
    const enc = w => { const c = document.createElement('canvas'); c.width = w; c.height = Math.max(48, Math.round(img.height * (w / img.width))); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); const url = c.toDataURL('image/png'); return { url, kb: dataUrlKB(url) }; };
    best = enc(lo);
    if (!targetKB || best.kb <= targetKB) {
      while (hi - lo > 20) { const mid = Math.round((lo + hi) / 2); const e = enc(mid); if (!targetKB || e.kb <= targetKB) { best = e; lo = mid; } else hi = mid; }
    }
    onProgress && onProgress(100); return best.url;
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
