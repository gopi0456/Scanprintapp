import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

// ISO-exact physical sizes: mm for A4/CR80 so the OS print dialog recognises them
export const PRINT_SIZES = {
  'ID Card (CR80)': { width: 1013, height: 638, cssWidth: '85.6mm', cssHeight: '54mm', isIdCard: true },
  'A4': { width: 2480, height: 3508, cssWidth: '210mm', cssHeight: '297mm' },
  '4x6 Photo': { width: 1200, height: 1800, cssWidth: '4in', cssHeight: '6in' },
  'Passport (2x2)': { width: 600, height: 600, cssWidth: '2in', cssHeight: '2in', isPassport: true }
};

export function cssToMm(v) {
  const n = parseFloat(v);
  if (/mm$/.test(v)) return n;
  if (/in$/.test(v)) return n * 25.4;
  return n;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

export function dataUrlKB(url) {
  return Math.ceil(((url.split(',')[1] || '').length * 3) / 4 / 1024);
}

// Auto-detect & crop empty white borders so content fills the target area
export function trimWhitespace(source, pad = 8) {
  const c = document.createElement('canvas');
  c.width = source.width; c.height = source.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y += 2)
    for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4;
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  if (maxX < 0) return c;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(c.width - 1, maxX + pad); maxY = Math.min(c.height - 1, maxY + pad);
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1; out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

export async function renderPdfToImages(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const out = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 3.0 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.height = viewport.height; canvas.width = viewport.width;
    await page.render({ canvasContext: ctx, viewport }).promise;
    out.push(canvas.toDataURL('image/jpeg', 0.92));
    if (onProgress) onProgress(Math.round((pageNum / pdf.numPages) * 100));
  }
  return out;
}

export function fitImageToSize(imageDataUrl, targetWidth, targetHeight) {
  return loadImage(imageDataUrl).then(img => {
    const c = document.createElement('canvas'); c.width = targetWidth; c.height = targetHeight;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const s = Math.max(c.width / img.width, c.height / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, c.width, c.height); ctx.clip();
    ctx.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh); ctx.restore();
    return c.toDataURL('image/png', 1.0);
  });
}
