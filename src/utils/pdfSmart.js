import { loadImage, dataUrlKB } from './imageUtils.js';

/* Shrink ONLY the images inside a PDF. Vector text, fonts and layout are never touched. */
export async function compressPdfKeepText(bytes, targetKB, onProgress) {
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;

  const images = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (String(d.get(PDFName.of('Subtype'))) !== '/Image') continue;
    if (String(d.get(PDFName.of('Filter'))) !== '/DCTDecode') continue;
    const w = Number(d.get(PDFName.of('Width'))?.value ?? d.get(PDFName.of('Width')));
    const h = Number(d.get(PDFName.of('Height'))?.value ?? d.get(PDFName.of('Height')));
    if (!w || !h) continue;
    images.push({ ref, dict: d, bytes: obj.contents, w, h, size: obj.contents.length });
  }
  images.sort((a, b) => b.size - a.size);
  const imageBytes = images.reduce((s, i) => s + i.size, 0);
  const shellBytes = Math.max(20000, bytes.byteLength - imageBytes);

  const save = async () => new Blob([await doc.save({ useObjectStreams: true, addDefaultPage: false })], { type: 'application/pdf' });

  if (!images.length) { const blob = await save(); onProgress && onProgress(100); return { blob, images: 0, imageBytes: 0, shellBytes, textKept: true }; }

  // budget left for pictures after the text shell
  let picBudget = Math.max(8000, targetKB * 1024 - shellBytes);
  const totalPic = images.reduce((s, i) => s + i.size, 0);
  const ratio = Math.min(1, picBudget / Math.max(1, totalPic));

  for (let i = 0; i < images.length; i++) {
    const im = images[i];
    const allow = Math.max(1500, im.size * ratio);
    try {
      const url = URL.createObjectURL(new Blob([im.bytes], { type: 'image/jpeg' }));
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      let best = null;
      for (const s of [1, .8, .62, .48, .36, .26, .18]) {
        const w = Math.max(24, Math.round(img.width * s)), h = Math.max(24, Math.round(img.height * s));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
        x.drawImage(img, 0, 0, w, h);
        let lo = .12, hi = .9, fit = null;
        for (let k = 0; k < 6; k++) {
          const mid = (lo + hi) / 2;
          const du = c.toDataURL('image/jpeg', mid);
          const kb = dataUrlKB(du) * 1024;
          if (kb <= allow) { fit = { du, kb, w, h }; lo = mid; } else hi = mid;
        }
        if (fit) { best = fit; break; }
        const du = c.toDataURL('image/jpeg', .12);
        const kb = dataUrlKB(du) * 1024;
        if (!best || kb < best.kb) best = { du, kb, w, h };
        if (kb <= allow) break;
      }
      if (best && best.kb < im.size) {
        const bin = Uint8Array.from(atob(best.du.split(',')[1]), ch => ch.charCodeAt(0));
        const nd = ctx.obj({});
        nd.set(PDFName.of('Type'), PDFName.of('XObject'));
        nd.set(PDFName.of('Subtype'), PDFName.of('Image'));
        nd.set(PDFName.of('Width'), PDFNumber.of(best.w));
        nd.set(PDFName.of('Height'), PDFNumber.of(best.h));
        nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
        nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
        const smask = im.dict.get(PDFName.of('SMask'));
        if (smask) nd.set(PDFName.of('SMask'), smask);
        ctx.assign(im.ref, ctx.stream(bin, nd));
      }
    } catch (e) { /* leave this image untouched */ }
    onProgress && onProgress(Math.round(((i + 1) / images.length) * 95));
  }
  const blob = await save();
  onProgress && onProgress(100);
  return { blob, images: images.length, imageBytes, shellBytes, textKept: true };
}

/* Inspect a PDF: how much is text shell vs pictures */
export async function inspectPdf(bytes) {
  const { PDFDocument, PDFName, PDFRawStream } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  let imageBytes = 0, imageCount = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    if (String(obj.dict.get(PDFName.of('Subtype'))) !== '/Image') continue;
    imageCount++; imageBytes += obj.contents.length;
  }
  return { pages: doc.getPageCount(), imageCount, imageBytes, shellBytes: Math.max(0, bytes.byteLength - imageBytes) };
}
