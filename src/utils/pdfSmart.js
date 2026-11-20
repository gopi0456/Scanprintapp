import { loadImage } from './imageUtils.js';

/* ====================================================================
   Smart PDF shrink: re-encode ONLY the embedded pictures.
   Vector text, fonts and layout are copied untouched, so every word
   stays perfectly sharp at any zoom.

   compressPdfKeepText(bytes, targetKB, onProgress, gray = false)
     - targetKB = Infinity / <= 0  → original bytes returned untouched
     - iterates encode → measure → tighten until the REAL blob is under
       the target (max 4 passes), so "100 KB less than original" is hit
     - gray=true converts pictures to grayscale (much smaller scans)
     - longest image side is capped at 1600px (no readability loss on A4)
     - returns { impossible: true } when the text shell alone is bigger
       than the target — no silent failure
   ==================================================================== */

const u8FromDu = du => Uint8Array.from(atob(du.split(',')[1]), ch => ch.charCodeAt(0));
const duBytes = du => Math.round(du.split(',')[1].length * 0.75); // base64 → real byte size
const MAX_SIDE = 1600; // px — beyond this, A4 print/readability gains nothing

/* Turn any supported image stream into something drawable (img el or canvas).
   DCTDecode (JPEG) → browser decodes natively.
   FlateDecode 8-bit DeviceRGB / DeviceGray, no PNG predictor → decoded here.
   JPXDecode / CCITTFax / CMYK / Indexed → left untouched (returns null). */
async function streamToDrawable(im, PDFName) {
  try {
    const filter = String(im.dict.get(PDFName.of('Filter')) ?? '');
    if (filter === '/DCTDecode') {
      const url = URL.createObjectURL(new Blob([im.bytes], { type: 'image/jpeg' }));
      try { return await loadImage(url); } finally { URL.revokeObjectURL(url); }
    }
    if (filter === '/FlateDecode') {
      const cs = String(im.dict.get(PDFName.of('ColorSpace')) ?? '');
      const bpc = Number(im.dict.get(PDFName.of('BitsPerComponent')) ?? 8);
      if (bpc !== 8 || !im.w || !im.h) return null;
      let comps = 0;
      if (cs === '/DeviceRGB') comps = 3;
      else if (cs === '/DeviceGray') comps = 1;
      else return null; // Indexed / CMYK → skip safely
      const parms = im.dict.get(PDFName.of('DecodeParms')) ?? im.dict.get(PDFName.of('DP'));
      const pred = parms ? Number(parms.get(PDFName.of('Predictor')) ?? 1) : 1;
      if (pred !== 1 && pred !== 10) return null; // PNG-predicted data not handled
      const raw = new Uint8Array(await new Response(
        new Blob([im.bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
      ).arrayBuffer());
      if (raw.length < im.w * im.h * comps) return null;
      const c = document.createElement('canvas'); c.width = im.w; c.height = im.h;
      const x = c.getContext('2d');
      const id = x.createImageData(im.w, im.h);
      for (let i = 0, j = 0; i < im.w * im.h; i++, j += comps) {
        id.data[i * 4] = raw[j];
        id.data[i * 4 + 1] = comps === 3 ? raw[j + 1] : raw[j];
        id.data[i * 4 + 2] = comps === 3 ? raw[j + 2] : raw[j];
        id.data[i * 4 + 3] = 255;
      }
      x.putImageData(id, 0, 0);
      return c;
    }
    return null;
  } catch (e) { return null; }
}

export async function compressPdfKeepText(bytes, targetKB, onProgress, gray = false) {
  const { PDFDocument, PDFName, PDFRawStream, PDFNumber } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;

  /* strip metadata — often tens of KB for free */
  try {
    doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
    doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
  } catch (e) {}

  /* collect every image XObject */
  const images = [];
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (String(d.get(PDFName.of('Subtype')) ?? '') !== '/Image') continue;
    const w = Number(d.get(PDFName.of('Width'))?.value ?? d.get(PDFName.of('Width')));
    const h = Number(d.get(PDFName.of('Height'))?.value ?? d.get(PDFName.of('Height')));
    if (!w || !h) continue;
    images.push({ ref, dict: d, bytes: obj.contents, w, h, size: obj.contents.length });
  }
  images.sort((a, b) => b.size - a.size);
  const imageBytes = images.reduce((s, i) => s + i.size, 0);
  const shellBytes = Math.max(0, bytes.byteLength - imageBytes);

  const save = async () => new Blob([await doc.save({ useObjectStreams: true, addDefaultPage: false })], { type: 'application/pdf' });
  const pack = async extra => ({ blob: await save(), images: images.length, imageBytes, shellBytes, textKept: true, ...extra });

  const finite = isFinite(targetKB) && targetKB > 0;

  /* nothing to shrink (no images) or no target asked → copy original bytes */
  if (!images.length || !finite) { onProgress && onProgress(100); return pack({ impossible: false }); }

  const targetBytes = targetKB * 1024;
  if (shellBytes >= targetBytes) {
    /* text + layout alone already exceed the target: pictures can't help */
    onProgress && onProgress(100);
    return pack({ impossible: true });
  }

  /* one pass: give each image its proportional share of picBudget */
  async function pass(picBudget, qFloor) {
    const totalPic = images.reduce((s, i) => s + i.size, 0);
    const ratio = Math.min(1, picBudget / Math.max(1, totalPic));
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      const allow = Math.max(400, Math.round(im.size * ratio));
      try {
        const src = await streamToDrawable(im, PDFName);
        if (!src) continue; // unsupported stream → leave untouched
        const sw = src.width || im.w, sh = src.height || im.h;
        /* start at full size (capped at MAX_SIDE) and shrink until it fits */
        const s0 = Math.min(1, MAX_SIDE / Math.max(sw, sh));
        let best = null;
        for (const s of [s0, s0 * .8, s0 * .62, s0 * .46, s0 * .32, s0 * .22]) {
          const w = Math.max(24, Math.round(sw * s)), h = Math.max(24, Math.round(sh * s));
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
          if (gray) x.filter = 'grayscale(1)';
          x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
          x.drawImage(src, 0, 0, w, h);
          /* binary-search the highest JPEG quality that fits this image's share */
          let lo = qFloor, hi = .9, fit = null;
          for (let k = 0; k < 7; k++) {
            const mid = (lo + hi) / 2;
            const du = c.toDataURL('image/jpeg', mid);
            const nb = duBytes(du);
            if (nb <= allow) { fit = { du, nb, w, h }; lo = mid; } else hi = mid;
          }
          if (fit) { best = fit; break; }
          const du = c.toDataURL('image/jpeg', qFloor);
          const nb = duBytes(du);
          if (!best || nb < best.nb) best = { du, nb, w, h };
          if (nb <= allow) break;
        }
        /* replace ONLY when the new stream is strictly smaller */
        if (best && best.nb < im.size) {
          const bin = u8FromDu(best.du);
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
          im.size = bin.length; im.bytes = bin;
        }
      } catch (e) { /* leave this image untouched */ }
      onProgress && onProgress(Math.round(((i + 1) / images.length) * 95));
    }
  }

  /* encode → measure REAL blob → tighten budget → repeat (max 4 passes) */
  let picBudget = Math.max(8000, targetBytes - shellBytes);
  for (let iter = 0; iter < 4; iter++) {
    await pass(picBudget, iter === 0 ? .12 : Math.max(.06, .12 - iter * .02));
    const blob = await save();
    if (blob.size <= targetBytes) {
      onProgress && onProgress(100);
      return { blob, images: images.length, imageBytes, shellBytes, textKept: true, impossible: false };
    }
    picBudget = Math.max(4000, Math.floor(picBudget / (blob.size / targetBytes) * 0.97));
  }
  const blob = await save();
  onProgress && onProgress(100);
  return { blob, images: images.length, imageBytes, shellBytes, textKept: true, impossible: blob.size > targetBytes };
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
