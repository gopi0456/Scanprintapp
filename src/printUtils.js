import * as pdfjsLib from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

export const PRINT_SIZES = {
  'ID Card (CR80)': { width: 1013, height: 638, cssWidth: '3.375in', cssHeight: '2.125in', isIdCard: true },
  'A4': { width: 2480, height: 3508, cssWidth: '8.27in', cssHeight: '11.69in' },
  '4x6 Photo': { width: 1200, height: 1800, cssWidth: '4in', cssHeight: '6in' },
  'Passport (2x2)': { width: 600, height: 600, cssWidth: '2in', cssHeight: '2in', isPassport: true }
};

function loadImage(src) { 
  return new Promise((resolve, reject) => { 
    const img = new Image(); 
    img.onload = () => resolve(img); 
    img.onerror = () => reject(new Error('Failed to load image')); 
    img.src = src; 
  }); 
}

function trimWhitespace(source, pad = 12) {
  const c = document.createElement('canvas'); 
  c.width = source.width; c.height = source.height;
  const ctx = c.getContext('2d', { willReadFrequently: true }); 
  ctx.drawImage(source, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y += 2) 
    for (let x = 0; x < c.width; x += 2) {
      const i = (y * c.width + x) * 4;
      if (data[i] < 245 || data[i+1] < 245 || data[i+2] < 245) { 
        if (x<minX) minX=x; if (x>maxX) maxX=x; 
        if (y<minY) minY=y; if (y>maxY) maxY=y; 
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

export function dataUrlKB(url) { 
  return Math.ceil(((url.split(',')[1] || '').length * 3) / 4 / 1024); 
}

// MUCH BETTER COMPRESSION: scale down FIRST, then binary search quality
export async function compressToTarget(dataUrl, targetKB, onProgress) {
  const originalKB = dataUrlKB(dataUrl);
  if (originalKB <= targetKB) { if (onProgress) onProgress(100); return dataUrl; }

  const img = await loadImage(dataUrl);
  let scale = Math.min(1, Math.sqrt(targetKB / originalKB) * 2);
  let bestUrl = null;
  let bestKB = Infinity;

  for (let i = 0; i < 16; i++) {
    if (onProgress) onProgress(Math.min(95, Math.round(((i + 1) / 16) * 100)));
    const w = Math.max(64, Math.round(img.width * scale));
    const h = Math.max(64, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const qualities = [0.85, 0.7, 0.55, 0.4, 0.3, 0.2, 0.12, 0.06];
    for (const q of qualities) {
      const url = canvas.toDataURL('image/jpeg', q);
      const kb = dataUrlKB(url);
      if (kb < bestKB) { bestKB = kb; bestUrl = url; }
      if (kb <= targetKB) { if (onProgress) onProgress(100); return url; }
    }
    scale *= 0.72;
    if (scale < 0.02) break;
  }
  if (onProgress) onProgress(100);
  return bestUrl || dataUrl;
}

export async function convertToPng(dataUrl) { 
  const img = await loadImage(dataUrl); 
  const c = document.createElement('canvas'); 
  c.width = img.width; c.height = img.height; 
  const ctx = c.getContext('2d'); 
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height); 
  ctx.drawImage(img,0,0); 
  return c.toDataURL('image/png'); 
}

export async function convertToJpg(dataUrl, quality = 0.92) { 
  const img = await loadImage(dataUrl); 
  const c = document.createElement('canvas'); 
  c.width = img.width; c.height = img.height; 
  const ctx = c.getContext('2d'); 
  ctx.fillStyle = '#fff'; ctx.fillRect(0,0,c.width,c.height); 
  ctx.drawImage(img,0,0); 
  return c.toDataURL('image/jpeg', quality); 
}

export async function dataUrlToBlob(dataUrl, name) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'application/octet-stream' });
}

export async function renderPdfToImages(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const out = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.5 });
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
  return new Promise((resolve, reject) => {
    const img = new Image(); 
    img.onload = () => {
      const canvas = document.createElement('canvas'); 
      canvas.width = targetWidth; canvas.height = targetHeight;
      const ctx = canvas.getContext('2d'); 
      ctx.fillStyle = 'white'; ctx.fillRect(0,0,canvas.width,canvas.height);
      const scale = Math.max(canvas.width/img.width, canvas.height/img.height);
      const drawW = img.width*scale, drawH = img.height*scale;
      const drawX = (canvas.width-drawW)/2, drawY = (canvas.height-drawH)/2;
      ctx.save(); ctx.beginPath(); ctx.rect(0,0,canvas.width,canvas.height); ctx.clip();
      ctx.drawImage(img, drawX, drawY, drawW, drawH); ctx.restore();
      resolve(canvas.toDataURL('image/png', 1.0));
    }; 
    img.onerror = () => reject(new Error('Failed to load image')); 
    img.src = imageDataUrl;
  });
}

export function createIdCardLayout(f, b) {
  const a4W=2480,a4H=3508,cW=1013,cH=638,mX=150,mY=150,g=150;
  return new Promise((resolve,reject)=>Promise.all([loadImage(f),loadImage(b)]).then(([fi,bi])=>{
    const c=document.createElement('canvas');c.width=a4W;c.height=a4H;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,a4W,a4H);
    const draw=(img,x,y,w,h)=>{const s=Math.max(w/img.width,h/img.height);const dw=img.width*s,dh=img.height*s;const dx=x+(w-dw)/2,dy=y+(h-dh)/2;ctx.strokeStyle='#000';ctx.lineWidth=3;ctx.strokeRect(x,y,w,h);ctx.save();ctx.beginPath();ctx.rect(x,y,w,h);ctx.clip();ctx.drawImage(img,dx,dy,dw,dh);ctx.restore();};
    draw(fi,mX,mY,cW,cH); draw(bi,mX+cW+g,mY,cW,cH); resolve(c.toDataURL('image/png',1.0));
  }).catch(reject));
}

export function createCardGridLayout(urls, paperSizeKey) {
  const p=PRINT_SIZES[paperSizeKey];const cW=1013,cH=638,g=40,m=60;
  const cols=Math.max(1,Math.floor((p.width-2*m+g)/(cW+g)));const rows=Math.max(1,Math.floor((p.height-2*m+g)/(cH+g)));
  const ps=cols*rows;const sc=Math.ceil(urls.length/ps);
  return Promise.all(urls.map(loadImage)).then(imgs=>{
    const pages=[];
    for (let s=0;s<sc;s++){const c=document.createElement('canvas');c.width=p.width;c.height=p.height;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,p.width,p.height);
    imgs.slice(s*ps,(s+1)*ps).forEach((img,i)=>{const r=Math.floor(i/cols),co=i%cols;const x=m+co*(cW+g),y=m+r*(cH+g);const s=Math.max(cW/img.width,cH/img.height);const dw=img.width*s,dh=img.height*s;ctx.strokeStyle='#000';ctx.lineWidth=2;ctx.strokeRect(x,y,cW,cH);ctx.save();ctx.beginPath();ctx.rect(x,y,cW,cH);ctx.clip();ctx.drawImage(img,x+(cW-dw)/2,y+(cH-dh)/2,dw,dh);ctx.restore();});
    pages.push(c.toDataURL('image/png',1.0));}return pages;
  });
}

function tileTrimmed(trimmed, cols, rows, paper) {
  const g=12,m=20;const cW=(paper.width-2*m-(cols-1)*g)/cols;const cH=(paper.height-2*m-(rows-1)*g)/rows;
  const ps=cols*rows;const sc=Math.ceil(trimmed.length/ps);const pages=[];
  for (let s=0;s<sc;s++){const c=document.createElement('canvas');c.width=paper.width;c.height=paper.height;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,paper.width,paper.height);
  trimmed.slice(s*ps,(s+1)*ps).forEach((img,i)=>{const r=Math.floor(i/cols),co=i%cols;const x=m+co*(cW+g),y=m+r*(cH+g);const s=Math.min(cW/img.width,cH/img.height);const dw=img.width*s,dh=img.height*s;ctx.strokeStyle='#ddd';ctx.lineWidth=1;ctx.strokeRect(x,y,cW,cH);ctx.save();ctx.beginPath();ctx.rect(x,y,cW,cH);ctx.clip();ctx.drawImage(img,x+(cW-dw)/2,y+(cH-dh)/2,dw,dh);ctx.restore();});
  pages.push(c.toDataURL('image/png',1.0));}return pages;
}

export function createNUpLayout(urls,arg2,arg3){let pp,pk;if (typeof arg2==='number'){pp=arg2;pk=arg3;}else{pk=arg2;pp=arg3;}
  const g={1:[1,1],2:[1,2],4:[2,2],6:[2,3],8:[2,4],9:[3,3],16:[4,4]};const[c,r]=g[pp]||[1,1];
  return Promise.all(urls.map(loadImage)).then(imgs=>tileTrimmed(imgs.map(im=>trimWhitespace(im)),c,r,PRINT_SIZES[pk]||PRINT_SIZES['A4']));}

export function createFrontBackNUpSheets(urls,pp,pk){const p=PRINT_SIZES[pk]||PRINT_SIZES['A4'];const cols=2;const rows=Math.max(1,Math.round(pp/2));
  return Promise.all(urls.map(loadImage)).then(imgs=>tileTrimmed(imgs.map(im=>trimWhitespace(im)),cols,rows,p));}

export function createPassportLayout(dataUrl, n, pk) {
  return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{
    const p=PRINT_SIZES[pk];const isA4=pk==='A4';const cols=isA4?4:2;const pW=540,pH=600,gx=40,gy=40;
    const mx=isA4?100:40,my=100;
    const rpp=Math.floor((p.height-2*my+gy)/(pH+gy));const mpp=cols*rpp;
    const tp=Math.ceil(n/mpp);const pages=[];
    for (let pg=0;pg<tp;pg++){const c=document.createElement('canvas');c.width=p.width;c.height=p.height;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,p.width,p.height);
    const on=Math.min(mpp,n-pg*mpp);
    for (let i=0;i<on;i++){const r=Math.floor(i/cols),co=i%cols;const x=mx+co*(pW+gx),y=my+r*(pH+gy);const s=Math.max(pW/img.width,pH/img.height);const dw=img.width*s,dh=img.height*s;ctx.strokeStyle='#aaa';ctx.lineWidth=2;ctx.setLineDash([10,5]);ctx.strokeRect(x,y,pW,pH);ctx.setLineDash([]);ctx.save();ctx.beginPath();ctx.rect(x,y,pW,pH);ctx.clip();ctx.drawImage(img,x+(pW-dw)/2,y+(pH-dh)/2,dw,dh);ctx.restore();}
    pages.push(c.toDataURL('image/png',1.0));}resolve(pages);};img.onerror=()=>reject(new Error('Failed to load'));img.src=dataUrl;});
}

export async function buildPdfBlob(pages, widthCSS, heightCSS) {
  const { jsPDF } = await import('jspdf');
  const wPt = parseFloat(widthCSS) * 72;
  const hPt = parseFloat(heightCSS) * 72;
  const pdf = new jsPDF({ unit: 'pt', format: [wPt, hPt] });
  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage([wPt, hPt]);
    const fmt = pages[i].startsWith('data:image/png') ? 'PNG' : 'JPEG';
    pdf.addImage(pages[i], fmt, 0, 0, wPt, hPt);
  }
  return pdf.output('blob');
}

// RELIABLE PRINT: iframe method (works in Android WebView + Capacitor + browser)
export function printImage(pages, widthCSS, heightCSS) {
  return new Promise(async (resolve, reject) => {
    try {
      // Build a standalone print document
      const pagesHtml = pages.map(p => `<div class="page"><img src="${p}" /></div>`).join('');
      const docHtml = `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: ${widthCSS} ${heightCSS}; margin: 0; }
  html, body { margin: 0; padding: 0; background: white; }
  .page { width: ${widthCSS}; height: ${heightCSS}; page-break-after: always; display: flex; align-items: center; justify-content: center; }
  .page:last-child { page-break-after: auto; }
  .page img { width: 100%; height: 100%; object-fit: contain; }
</style>
</head><body>${pagesHtml}</body></html>`;

      // Try window.open first (works in browsers)
      const printWin = window.open('', '_blank', 'width=900,height=700');
      if (printWin && !printWin.closed) {
        printWin.document.open();
        printWin.document.write(docHtml);
        printWin.document.close();
        printWin.onload = () => {
          setTimeout(() => {
            try { printWin.focus(); printWin.print(); } catch (e) {}
          }, 500);
        };
        resolve();
        return;
      }

      // Fallback: hidden iframe (works in all WebViews including Capacitor)
      const existing = document.getElementById('scanprint-print-frame');
      if (existing) existing.remove();

      const iframe = document.createElement('iframe');
      iframe.id = 'scanprint-print-frame';
      iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;visibility:hidden;';
      document.body.appendChild(iframe);

      const iDoc = iframe.contentDocument || iframe.contentWindow.document;
      iDoc.open();
      iDoc.write(docHtml);
      iDoc.close();

      // Wait for images to load, then trigger print
      const triggerPrint = () => {
        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) {
            console.error('Print trigger failed:', e);
          }
          // Clean up after a delay
          setTimeout(() => {
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          }, 5000);
          resolve();
        }, 800);
      };

      // Wait for all images in the iframe to load
      const imgs = iDoc.querySelectorAll('img');
      let loaded = 0;
      if (imgs.length === 0) { triggerPrint(); return; }
      imgs.forEach(img => {
        if (img.complete) { loaded++; if (loaded === imgs.length) triggerPrint(); }
        else {
          img.onload = () => { loaded++; if (loaded === imgs.length) triggerPrint(); };
          img.onerror = () => { loaded++; if (loaded === imgs.length) triggerPrint(); };
        }
      });
      // Timeout fallback
      setTimeout(triggerPrint, 2000);
    } catch (e) {
      reject(e);
    }
  });
}
