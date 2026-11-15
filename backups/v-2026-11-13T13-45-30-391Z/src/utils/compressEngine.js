import { loadImage, dataUrlKB } from './imageUtils.js';

export const FLOOR_DOC = 15;
export const FLOOR_PHOTO = 40;
export const FLOOR_MIXED = 80;
export { dataUrlKB } from './imageUtils.js';

const CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function pngChunk(type, data) { const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer); dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); return out; }
async function zlibDeflate(bytes) { const cs = new CompressionStream('deflate'); const stream = new Blob([bytes]).stream().pipeThrough(cs); return new Uint8Array(await new Response(stream).arrayBuffer()); }
function b64(bytes) { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
const cl255 = v => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

function otsuThreshold(d) {
  const hist = new Float64Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++;
  const total = d.length / 4;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = -1, T = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; T = t; }
  }
  return T;
}

function enhance(src) {
  const w = src.width, h = src.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, w, h); const d = id.data;
  const hist = new Float64Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0]++;
  const total = d.length / 4;
  let acc = 0, med = 255;
  for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc >= total / 2) { med = t; break; } }
  if (med >= 240) return c;
  const T = otsuThreshold(d);
  const B = Math.max(0, Math.min(200, Math.round(T * 0.35)));
  const W = Math.max(T + 20, Math.min(255, Math.round(T + (255 - T) * 0.8)));
  const scale = 255 / (W - B);
  for (let i = 0; i < d.length; i += 4) { d[i] = cl255((d[i] - B) * scale); d[i + 1] = cl255((d[i + 1] - B) * scale); d[i + 2] = cl255((d[i + 2] - B) * scale); }
  ctx.putImageData(id, 0, 0);
  return c;
}

function filterCost(a) { let s = 0; for (let i = 0; i < a.length; i++) { const v = a[i]; s += v < 128 ? v : 256 - v; } return s; }
function applyFilter(t, row, prev) {
  const n = row.length; const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = i >= 1 ? row[i - 1] : 0, b = prev ? prev[i] : 0, c = (prev && i >= 1) ? prev[i - 1] : 0;
    let v = row[i];
    if (t === 1) v = row[i] - a; else if (t === 2) v = row[i] - b; else if (t === 3) v = row[i] - ((a + b) >> 1);
    else if (t === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); v = row[i] - pr; }
    out[i] = v & 0xFF;
  }
  return out;
}

async function packBiLevel(B, w, h) {
  const stride = Math.ceil(w / 8);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < w; x += 8) {
      const count = Math.min(8, w - x);
      let bits = 0;
      for (let b = 0; b < count; b++) bits = (bits << 1) | B[y * w + x + b];
      row[x >> 3] = (bits << (8 - count)) | ((1 << (8 - count)) - 1);
    }
    rows.push(row);
  }
  const raw = new Uint8Array(h * (stride + 1));
  let o = 0, prev = null;
  for (const row of rows) {
    let bestT = 0, bestArr = row, bestCost = filterCost(row);
    for (const t of [1, 2, 3, 4]) { const arr = applyFilter(t, row, prev); const cc = filterCost(arr); if (cc < bestCost) { bestCost = cc; bestT = t; bestArr = arr; } }
    raw[o++] = bestT; raw.set(bestArr, o); o += stride; prev = row;
  }
  const ihdr = new Uint8Array(13); const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 1; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = await zlibDeflate(raw);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = new Uint8Array(sig.length + 12 + 13 + 12 + idat.length + 12);
  let p = 0; png.set(sig, p); p += sig.length;
  for (const ch of [pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))]) { png.set(ch, p); p += ch.length; }
  const url = 'data:image/png;base64,' + b64(png);
  return { url, kb: dataUrlKB(url) };
}

function binarizeFull(img) {
  const w = img.width, h = img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, w, h).data;
  const T = otsuThreshold(d);
  const B = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) B[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) < T ? 0 : 1;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    if (B[p] === 0 && (B[p - 1] + B[p + 1] + B[p - w] + B[p + w] + B[p - w - 1] + B[p - w + 1] + B[p + w - 1] + B[p + w + 1]) === 8) B[p] = 1;
  }
  return { B, w, h };
}

function downscaleBi(src, w, h) {
  const w2 = Math.max(8, Math.floor(w / 2)), h2 = Math.max(8, Math.floor(h / 2));
  const B2 = new Uint8Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const sx = x * 2, sy = y * 2, sx1 = Math.min(w - 1, sx + 1), sy1 = Math.min(h - 1, sy + 1);
    B2[y * w2 + x] = (src[sy * w + sx] && src[sy * w + sx1] && src[sy1 * w + sx] && src[sy1 * w + sx1]) ? 1 : 0;
  }
  return { B: B2, w: w2, h: h2 };
}

const WT=['00110101','000111','0111','1000','1011','1100','1110','1111','10011','10100','00111','01000','001000','000011','110100','110101','101010','101011','0100111','0001100','0001000','0010111','0000011','0000100','0101000','0101011','0010011','0100100','0011000','00000010','00000011','00011010','00011011','00010010','00010011','00010100','00010101','00010110','00010111','00101000','00101001','00101010','00101011','00101100','00101101','00000100','00000101','00001010','00001011','01010010','01010011','01010100','01010101','00100100','00100101','01011000','01011001','01011010','01011011','01001010','01001011','00110010','00110011','00110100'];
const BT=['0000110111','010','11','10','011','0011','0010','00011','000101','000100','0000100','0000101','0000111','00000100','00000111','000011000','0000010111','0000011000','0000001000','00001100111','00001101000','00001101100','00000110111','00000101000','00000010111','00000011000','000011001010','000011001011','000011001100','000011001101','000001101000','000001101001','000001101010','000001101011','000011010010','000011010011','000011010100','000011010101','000011010110','000011010111','0000011010100','0000011010101','0000011010110','0000011010111','0000011011000','0000011011001','0000011011010','0000011011011','0000010100100','0000010100101','0000010100110','0000010100111','0000010101000','0000010101001','0000010101010','0000010101011','0000010110010','0000010110011','0000010110100','0000010110101','0000010110110','0000010110111','0000011001000','0000011001001'];
const WM={64:'11011',128:'10010',192:'010111',256:'0110111',320:'00110110',384:'00110111',448:'01100100',512:'01100101',576:'01101000',640:'01100111',704:'011001100',768:'011001101',832:'011010010',896:'011010011',960:'011010100',1024:'011010101',1088:'011010110',1152:'011010111',1216:'011011000',1280:'011011001',1344:'011011010',1408:'011011011',1472:'010011000',1536:'010011001',1600:'010011010',1664:'011000',1728:'010011011'};
const BM={64:'0000001111',128:'000011001000',192:'000011001001',256:'000000110011',320:'000000110100',384:'000000110101',448:'0000001101100',512:'0000001101101',576:'0000001101110',640:'0000001101111',704:'0000001001000',768:'0000001001001',832:'0000001001010',896:'0000001001011',960:'0000001001100',1024:'0000001001101',1088:'0000001001110',1152:'0000001001111',1216:'0000001010000',1280:'0000001010001',1344:'0000001010010',1408:'0000001010011',1472:'0000001010100',1536:'0000001010101',1600:'0000001010110',1664:'0000001010111',1728:'0000001011000'};
const XM={1792:'00000001000',1856:'00000001100',1920:'00000001101',1984:'000000010010',2048:'000000010011',2112:'000000010100',2176:'000000010101',2240:'000000010110',2304:'000000010111',2368:'000000011100',2432:'000000011101',2496:'000000011110',2560:'000000011111'};
const WMK=Object.keys(WM).map(Number).sort((a,b)=>b-a);
const BMK=Object.keys(BM).map(Number).sort((a,b)=>b-a);
const XMK=Object.keys(XM).map(Number).sort((a,b)=>b-a);

function BitW(){return{b:[],n:0,cur:0,put(s){for(const ch of s){this.cur=(this.cur<<1)|(ch==='1'?1:0);this.n++;if(this.n===8){this.b.push(this.cur);this.cur=0;this.n=0;}}},bytes(){if(this.n){this.b.push(this.cur<<(8-this.n));this.n=0;}return Uint8Array.from(this.b);}};}
function emitRun(bw,run,black){let r=run;while(r>=2624){bw.put(XM[2560]);r-=2560;}if(r>=1792){const m=XMK.find(k=>k<=r);bw.put(XM[m]);r-=m;}else if(r>=64){const ks=black?BMK:WMK,tbl=black?BM:WM;const m=ks.find(k=>k<=r);bw.put(tbl[m]);r-=m;}bw.put(black?BT[r]:WT[r]);}
function ceList(row,W){const ce=[];for(let x=1;x<W;x++)if(row[x]!==row[x-1])ce.push(x);return ce;}
const ceColor=i=>(i%2===0?1:0);
const findCE=(ce,after,color,zeroOk)=>{for(let i=0;i<ce.length;i++)if(ceColor(i)===color&&(ce[i]>after||(zeroOk&&ce[i]===0&&after===0)))return{pos:ce[i],i};return{pos:Infinity,i:ce.length};};

export function g4Encode(P,W,H){
  const bw=BitW();let refCE=[];
  for(let y=0;y<H;y++){
    const row=P.subarray(y*W,(y+1)*W);const ce=ceList(row,W);
    let a0=0,a0col=0,started=false;
    for(;;){
      const A1=findCE(ce,a0,a0col^1,!started);const a1=A1.pos===Infinity?W:A1.pos;
      const a2=A1.i<ce.length?(ce[A1.i+1]??W):W;
      const B1=findCE(refCE,a0,a0col^1,!started);const b1=B1.pos===Infinity?W:B1.pos;
      const b2=B1.i<refCE.length?(refCE[B1.i+1]??W):W;
      if(b2<a1){bw.put('0001');a0=b2;a0col=(B1.i+1)%2===0?1:0;started=true;if(a0>=W)break;continue;}
      const d=a1-b1;
      if(Math.abs(d)<=3){bw.put(d===0?'1':d===1?'011':d===-1?'010':d===2?'000011':d===-2?'000010':d===3?'0000011':'0000010');a0=a1;a0col^=1;started=true;if(a0>=W)break;continue;}
      bw.put('001');emitRun(bw,a1-a0,a0col);emitRun(bw,(a2===W?W:a2)-a1,a0col^1);
      a0=a2;started=true;if(a0>=W)break;
    }
    refCE=ce;
  }
  bw.put('000000000001011111111110');
  return bw.bytes();
}

export function g4Decode(bytes,W,H){
  let bi=0,bb=7;
  const get=()=>{const v=(bytes[bi]>>bb)&1;bb--;if(bb<0){bb=7;bi++;}return v;};
  const match=s=>{let i=bi,b=bb;for(const ch of s){if(i>=bytes.length)return false;const v=(bytes[i]>>b)&1;if(v!==(ch==='1'?1:0))return false;b--;if(b<0){b=7;i++;}}return true;};
  const eat=s=>{for(let k=0;k<s.length;k++)get();};
  const readRun=black=>{let total=0;for(;;){let hit=null;const ks=black?BMK:WMK,tbl=black?BM:WM;for(const k of ks)if(match(tbl[k])){hit=k;eat(tbl[k]);break;}if(hit==null)for(const k of XMK)if(match(XM[k])){hit=k;eat(XM[k]);break;}if(hit==null)break;total+=hit;}const term=black?BT:WT;for(let r=0;r<64;r++)if(match(term[r])){eat(term[r]);return total+r;}return total;};
  const VC=[['1',0],['011',1],['010',-1],['000011',2],['000010',-2],['0000011',3],['0000010',-3]];
  const out=new Uint8Array(W*H);let refCE=[];
  for(let y=0;y<H;y++){
    const row=new Uint8Array(W);const ce=[];let a0=0,a0col=0,x=0,started=false;
    for(;;){
      if(match('000000000001011111111110'))break;
      if(match('0001')){eat('0001');const B1=findCE(refCE,a0,a0col^1,!started);const b2=B1.i<refCE.length?(refCE[B1.i+1]??W):W;for(let i=x;i<b2&&i<W;i++)row[i]=a0col;x=Math.max(x,b2);a0=b2;a0col=(B1.i+1)%2===0?1:0;started=true;if(a0>=W)break;continue;}
      if(match('001')){eat('001');const r1=readRun(a0col);const r2=readRun(a0col^1);for(let i=0;i<r1&&x<W;i++)row[x++]=a0col;const m1=x;for(let i=0;i<r2&&x<W;i++)row[x++]=a0col^1;if(r1>0)ce.push(m1);if(r2>0)ce.push(x);a0=x;started=true;if(a0>=W)break;continue;}
      let v=null;for(const[s,val]of VC)if(match(s)){v=val;eat(s);break;}
      if(v===null){get();continue;}
      const B1=findCE(refCE,a0,a0col^1,!started);const a1=(B1.pos===Infinity?W:B1.pos)+v;
      for(let i=x;i<a1&&i<W;i++)row[i]=a0col;
      if(a1<W)ce.push(a1);
      x=a1;a0=a1;a0col^=1;started=true;if(a0>=W)break;
    }
    out.set(row,y*W);refCE=ce;
  }
  return out;
}

export async function compressTextPage(img,targetKB,ultra,lock){
  const levels=[binarizeFull(img)];
  const maxDown=ultra?2:1;
  for(let i=1;i<=maxDown;i++)levels.push(downscaleBi(levels[i-1].B,levels[i-1].w,levels[i-1].h));
  let pngSmall=null,g4Small=null;
  for(const L of levels){
    const P=new Uint8Array(L.B.length);for(let i=0;i<L.B.length;i++)P[i]=L.B[i]?0:1;
    let g4=null,g4kb=Infinity,ok=false;
    try{g4=g4Encode(P,L.w,L.h);g4kb=Math.ceil(g4.length/1024);const dec=g4Decode(g4,L.w,L.h);ok=dec.length===P.length;if(ok)for(let i=0;i<P.length;i++)if(dec[i]!==P[i]){ok=false;break;}}catch(e){ok=false;}
    if(ok&&g4kb<=targetKB)return{url:null,kb:g4kb,g4:{bytes:g4,W:L.w,H:L.h}};
    const png=await packBiLevel(L.B,L.w,L.h);
    if(png.kb<=targetKB)return{url:png.url,kb:png.kb};
    if(!pngSmall||png.kb<pngSmall.kb)pngSmall=png;
    if(ok&&g4kb<(g4Small?g4Small.kb:Infinity))g4Small={kb:g4kb,g4:{bytes:g4,W:L.w,H:L.h}};
  }
  if(lock&&levels.length>1){
    const L=levels[1];const P=new Uint8Array(L.B.length);for(let i=0;i<L.B.length;i++)P[i]=L.B[i]?0:1;
    try{const g4=g4Encode(P,L.w,L.h);const dec=g4Decode(g4,L.w,L.h);let ok=dec.length===P.length;if(ok)for(let i=0;i<P.length;i++)if(dec[i]!==P[i]){ok=false;break;}if(ok)return{url:null,kb:Math.ceil(g4.length/1024),g4:{bytes:g4,W:L.w,H:L.h}};}catch(e){}
    const png=await packBiLevel(L.B,L.w,L.h);return{url:png.url,kb:png.kb};
  }
  if(g4Small&&(!pngSmall||g4Small.kb<pngSmall.kb))return{url:null,kb:g4Small.kb,g4:g4Small.g4};
  return pngSmall||{url:null,kb:0};
}

async function encode1bitPng(img, width) {
  const w = Math.max(16, Math.round(Math.min(width, img.width)));
  const h = Math.max(16, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(enhance(img), 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const T = otsuThreshold(d);
  const B = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) B[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) < T ? 0 : 1;
  return packBiLevel(B, w, h);
}
async function oneBitAt(img, w) {
  try { return await encode1bitPng(img, w); }
  catch (e) { const cc = document.createElement('canvas'); cc.width = w; cc.height = Math.round(img.height * (w / img.width)); cc.getContext('2d').drawImage(img, 0, 0, cc.width, cc.height); const url = cc.toDataURL('image/png'); return { url, kb: dataUrlKB(url) }; }
}

function classify(img) {
  const s = 200;
  const c = document.createElement('canvas'); c.width = s; c.height = s;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, s, s);
  const d = ctx.getImageData(0, 0, s, s).data;
  const T = otsuThreshold(d);
  let bg = 0, dark = 0, darkColored = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > T) bg++;
    else { dark++; if (Math.max(r, g, b) - Math.min(r, g, b) > 60) darkColored++; }
  }
  const n = d.length / 4, bgF = bg / n, colAmongDark = dark ? darkColored / dark : 0;
  if (bgF > 0.6 && colAmongDark < 0.15) return 'text';
  if (bgF > 0.35) return 'mixed';
  return 'photo';
}
async function classifyAll(urls) { const out = []; for (const u of urls) { const img = await loadImage(u); out.push(classify(img)); } return out; }
const WEIGHTS = { text: 1, mixed: 8, photo: 4 };
export async function allocateBudgets(urls, targetKB) {
  const cls = await classifyAll(urls);
  const ws = cls.map(c => WEIGHTS[c]);
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  return ws.map(w => Math.max(2, (w / sum) * targetKB * 0.98));
}

function sharpen(img, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h); const p = d.data;
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
  const out = new Uint8ClampedArray(p.length);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) for (let ch = 0; ch < 3; ch++) {
    let sum = 0, ki = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) sum += p[((y + ky) * w + (x + kx)) * 4 + ch] * kernel[ki++];
    out[(y * w + x) * 4 + ch] = Math.max(0, Math.min(255, sum));
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  ctx.putImageData(new ImageData(out, w, h), 0, 0);
  return c;
}
function jpegAt(img, width, q, gray, contrast, docMode) {
  const w = Math.max(16, Math.round(Math.min(width, img.width)));
  const h = Math.max(16, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  const f = []; if (gray) f.push('grayscale(1)'); if (contrast) f.push('contrast(1.08)');
  if (f.length) ctx.filter = f.join(' ');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const base = enhance(img);
  if (docMode) ctx.drawImage(sharpen(base, w, h), 0, 0); else ctx.drawImage(base, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url) };
}
function pngAt(img, width) {
  const w = Math.max(16, Math.round(Math.min(width, img.width)));
  const h = Math.max(16, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high'; ctx.drawImage(enhance(img), 0, 0, w, h);
  const url = c.toDataURL('image/png');
  return { url, kb: dataUrlKB(url) };
}
function ladder(img, cap, floor) { const out = []; let w = Math.min(img.width, cap || 1600); while (w >= (floor || 120)) { out.push(Math.round(w)); w *= 0.8; } out.push(floor || 120); return out; }
function bestJpegAtWidth(img, w, targetKB, gray, contrast, docMode, minQ = 0.12) {
  const minEnc = jpegAt(img, w, minQ, gray, contrast, docMode);
  if (minEnc.kb > targetKB) return null;
  let lo = minQ, hi = 0.92, best = minEnc;
  for (let i = 0; i < 6; i++) { const mid = (lo + hi) / 2; const enc = jpegAt(img, w, mid, gray, contrast, docMode); if (enc.kb <= targetKB) { best = enc; lo = mid; } else hi = mid; }
  return best;
}

export async function compressPageToTarget(dataUrl, targetKB, opts = {}, imgOverride = null) {
  const img = imgOverride || (await loadImage(dataUrl));
  const cls = classify(img);
  const gray = !!opts.gray;
  const contrast = opts.readable !== false;
  const ultra = !!opts.ultra;
  let smallest = null;
  if (cls === 'text') {
    const enc = await compressTextPage(img, targetKB, ultra, !!opts.lock);
    if (enc && (enc.url || enc.g4)) return { ...enc, doc: true, cls };
  } else {
    if (opts.lock) {
      for (const w of ladder(img, 1600, 900)) {
        const fit = bestJpegAtWidth(img, w, targetKB, gray, contrast, cls === 'mixed', 0.45);
        if (fit) return { ...fit, doc: false, cls };
      }
      return { ...jpegAt(img, 900, 0.45, gray, contrast, cls === 'mixed'), doc: false, cls };
    }
    const qMin = ultra ? 0.25 : 0.35;
    for (const w of ladder(img, 1600, ultra ? 800 : 1000)) {
      const fit = bestJpegAtWidth(img, w, targetKB, gray, contrast, cls === 'mixed', qMin);
      if (fit) return { ...fit, doc: false, cls };
      const minEnc = jpegAt(img, w, qMin, gray, contrast, cls === 'mixed');
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
    for (const w of ladder(img, ultra ? 700 : 900, ultra ? 350 : 500)) {
      const fit = bestJpegAtWidth(img, w, targetKB, gray, contrast, false, ultra ? 0.2 : 0.25);
      if (fit) return { ...fit, doc: false, cls };
      const minEnc = jpegAt(img, w, ultra ? 0.2 : 0.25, gray, contrast, false);
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
  }
  return { ...(smallest || { url: dataUrl, kb: dataUrlKB(dataUrl) }), doc: cls === 'text', cls };
}

export async function compressPageForce(dataUrl, targetKB, opts = {}) {
  const img = await loadImage(dataUrl);
  const cls = classify(img);
  const gray = !!opts.gray;
  if (cls === 'text') { const enc = await compressTextPage(img, targetKB, true, false); return enc.url || enc.g4; }
  let last = null;
  for (const w of [800, 600, 450, 340, 260, 200, 150]) { const enc = jpegAt(img, w, 0.3, gray, true, cls === 'mixed'); last = enc; if (enc.kb <= targetKB) return enc.url; }
  return last.url;
}

export async function estimatePageKB(dataUrl, ultra = false) {
  const img = await loadImage(dataUrl);
  const cls = classify(img);
  if (cls === 'text') return ultra ? 8 : FLOOR_DOC;
  if (cls === 'mixed') return ultra ? 40 : FLOOR_MIXED;
  return ultra ? 20 : FLOOR_PHOTO;
}

export async function compressImageToTarget(dataUrl, targetKB, mime = 'image/jpeg', onProgress, opts = {}) {
  const gray = !!opts.gray, contrast = opts.readable !== false, ultra = !!opts.ultra;
  const want = mime === 'image/png' ? 'image/png' : 'image/jpeg';
  const origKB = dataUrlKB(dataUrl);
  const img = await loadImage(dataUrl);
  const cls = classify(img);
  if (cls === 'text' && isFinite(targetKB) && origKB > targetKB) {
    const encSmart = await compressTextPage(img, targetKB, ultra, false);
    onProgress && onProgress(100);
    if (want === 'image/png') return encSmart.url;
    if (encSmart.url) {
      const bimg = await loadImage(encSmart.url);
      const j = jpegAt(bimg, bimg.width, 0.85, gray, false, false);
      return j.kb <= targetKB ? j.url : encSmart.url;
    }
    return encSmart.url;
  }
  if (!isFinite(targetKB) || origKB <= targetKB) {
    if (dataUrl.startsWith('data:' + want) && !gray && !contrast) { onProgress && onProgress(100); return dataUrl; }
    const conv = (want === 'image/png' && cls === 'text') ? await oneBitAt(img, img.width) : (want === 'image/png' ? pngAt(img, img.width) : jpegAt(img, img.width, 0.9, gray, contrast, cls === 'mixed'));
    onProgress && onProgress(100);
    return conv.kb <= origKB ? conv.url : dataUrl;
  }
  let smallest = null;
  const qMin = ultra ? 0.25 : 0.35;
  const widths = ladder(img, 1600, cls === 'text' ? (ultra ? 300 : 600) : (ultra ? 600 : 1000));
  for (let i = 0; i < widths.length; i++) {
    onProgress && onProgress(Math.min(92, Math.round((i / widths.length) * 92)));
    if (cls === 'text' && want === 'image/png') {
      const enc = await oneBitAt(img, widths[i]);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) { onProgress && onProgress(100); return enc.url; }
    } else if (want === 'image/png') {
      const enc = pngAt(img, widths[i]);
      if (!smallest || enc.kb < smallest.kb) smallest = enc;
      if (enc.kb <= targetKB) { onProgress && onProgress(100); return enc.url; }
    } else {
      const fit = bestJpegAtWidth(img, widths[i], targetKB, gray && cls !== 'mixed', contrast, cls === 'mixed', qMin);
      if (fit) { onProgress && onProgress(100); return fit.url; }
      const minEnc = jpegAt(img, widths[i], qMin, gray && cls !== 'mixed', contrast, cls === 'mixed');
      if (!smallest || minEnc.kb < smallest.kb) smallest = minEnc;
    }
  }
  onProgress && onProgress(100);
  return smallest ? smallest.url : dataUrl;
}
export async function compressToTarget(dataUrl, targetKB, onProgress) { return compressImageToTarget(dataUrl, targetKB, 'image/jpeg', onProgress, {}); }

export async function convertToPng(dataUrl) { const img = await loadImage(dataUrl); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0); return c.toDataURL('image/png'); }
export async function convertToJpg(dataUrl, q = 0.92) { const img = await loadImage(dataUrl); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0); return c.toDataURL('image/jpeg', q); }
export async function dataUrlToBlob(dataUrl, name) { const res = await fetch(dataUrl); const blob = await res.blob(); return new File([blob], name, { type: blob.type || 'application/octet-stream' }); }
export function blobToBase64(blob) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); }); }
export async function shareBlob(blob, filename) {
  try {
    const { Share } = await import('@capacitor/share');
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const b64 = await blobToBase64(blob);
    const uri = await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache, recursive: true });
    await Share.share({ title: filename, text: filename, url: uri.uri, dialogTitle: 'Save / Print / Share' });
    return;
  } catch (e) { console.warn('share fallback', e); }
  if (blob instanceof Blob) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
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
export async function pdfMergeLossless(entries) {
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (const en of entries) {
    if (!en.bytes) continue;
    const src = await PDFDocument.load(en.bytes, { ignoreEncryption: true });
    const safe = (en.indices || []).filter(i => i >= 0 && i < src.getPageCount());
    if (!safe.length) continue;
    const pages = await out.copyPages(src, safe);
    pages.forEach(p => out.addPage(p));
  }
  const bytes = await out.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}
export async function renderPageCanvas(bytes, pageIdx, scale = 3) {
  const pdfjs = await import('pdfjs-dist');
  const doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise;
  const page = await doc.getPage(pageIdx + 1);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  await doc.destroy();
  return canvas;
}

async function addG4Page(pdf, g4, Wpt, Hpt) {
  const { PDFName } = await import('pdf-lib');
  const page = pdf.addPage([Wpt, Hpt]);
  const dict = pdf.context.obj({ Type: 'XObject', Subtype: 'Image', Width: g4.W, Height: g4.H, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'CCITTFaxDecode', DecodeParms: { K: -1, BlackIs1: true, Columns: g4.W, Rows: g4.H, EndOfBlock: true } });
  const ref = pdf.context.register(pdf.context.stream(g4.bytes, dict));
  page.node.set(PDFName.of('Resources'), pdf.context.obj({ XObject: { Im0: ref } }));
  const c = new TextEncoder().encode('q ' + Wpt + ' 0 0 ' + Hpt + ' 0 0 cm /Im0 Do Q');
  page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.stream(c, pdf.context.obj({}))));
  return page;
}
async function embedPage(pdf, item, Wpt, Hpt) {
  if (item && item.g4) { await addG4Page(pdf, item.g4, Wpt || 595.28, Hpt || 841.89); return; }
  const url = typeof item === 'string' ? item : item.url;
  let img = null;
  try { img = url.startsWith('data:image/png') ? await pdf.embedPng(url) : await pdf.embedJpg(url); }
  catch (err) { img = await pdf.embedJpg(await convertToJpg(url, 0.85)); }
  const ratio = (img.height || 842) / (img.width || 595);
  const w = Wpt || 595.28, h = Hpt || w * ratio;
  const page = pdf.addPage([w, h]);
  page.drawImage(img, { x: 0, y: 0, width: w, height: h });
}

async function buildPdfFromPages(pages, dims) {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages.length; i++) {
    const d = dims && dims[i];
    await embedPage(pdf, pages[i], d ? d.w : undefined, d ? d.h : undefined);
  }
  const bytes = await pdf.save({ useObjectStreams: true });
  return new Blob([bytes], { type: 'application/pdf' });
}

async function fillToTarget(results, per, urls, targetKB, opts, blob, buildFn, overrides) {
  let remaining = targetKB * 1024 - blob.size;
  if (remaining < 2048) return blob;
  const upgraded = results.slice();
  let changed = false;
  for (let i = 0; i < results.length && remaining > 2048; i++) {
    const tryR = await compressPageToTarget(urls[i], per[i] + remaining / 1024, opts, overrides ? overrides[i] : null);
    const gain = (tryR.kb || 0) - (results[i].kb || 0);
    if (gain > 0 && gain * 1024 <= remaining) { remaining -= gain * 1024; upgraded[i] = tryR; changed = true; }
  }
  if (!changed) return blob;
  const b2 = await buildFn(upgraded);
  return (b2.size <= targetKB * 1024 && b2.size >= blob.size) ? b2 : blob;
}

export async function compressPdfToTarget(images, targetKB, onProgress, opts = {}, origBytes, indices) {
  const origSize = origBytes ? origBytes.byteLength : Infinity;
  const skipLossless = !!opts.gray;
  if (!skipLossless && origBytes && !isFinite(targetKB)) { const s = await pdfSubsetLossless(origBytes, indices || []); onProgress && onProgress(100); return s.size <= origSize ? s : new Blob([origBytes], { type: 'application/pdf' }); }
  if (!skipLossless && origBytes) { const s = await pdfSubsetLossless(origBytes, indices || []); if (s.size <= targetKB * 1024) { onProgress && onProgress(100); return s; } }
  const n = Math.max(1, images.length);
  onProgress && onProgress(5);
  let per = await allocateBudgets(images, targetKB);
  onProgress && onProgress(20);
  let blob = null;
  for (let round = 0; round < (opts.lock ? 1 : 4); round++) {
    const pages = [];
    for (let i = 0; i < n; i++) {
      const r = await compressPageToTarget(images[i], per[i], opts);
      pages.push(r);
      onProgress && onProgress(20 + Math.round(((i + 1) / n) * 60) + round * 5);
    }
    blob = await buildPdfFromPages(pages);
    if (blob.size <= targetKB * 1024) {
      blob = await fillToTarget(pages, per, images, targetKB, opts, blob, (res) => buildPdfFromPages(res), null);
      onProgress && onProgress(100); return blob;
    }
    per = per.map(p => Math.max(2, p * ((targetKB * 1024 * 0.98) / blob.size) * 0.95));
  }
  for (let guard = 0; guard < 3 && !opts.lock && blob && blob.size > targetKB * 1024; guard++) {
    const tight = await allocateBudgets(images, targetKB * 0.9);
    const pages = [];
    for (let i = 0; i < n; i++) pages.push({ url: await compressPageForce(images[i], tight[i], opts) });
    blob = await buildPdfFromPages(pages);
  }
  if (!skipLossless && origBytes && blob && blob.size > origSize) blob = await pdfSubsetLossless(origBytes, indices || []);
  onProgress && onProgress(100);
  return blob;
}

export async function compressPdfSmart(entries, targetKB, onProgress, opts = {}) {
  const { PDFDocument } = await import('pdf-lib');
  const finite = isFinite(targetKB);
  const vectorEntries = entries.filter(e => e.kind === 'vector');
  const naturalRaster = entries.map((e, i) => e.kind === 'image' ? i : -1).filter(i => i >= 0);
  let vectorCost = 0;
  if (vectorEntries.length) {
    const tmp = await PDFDocument.create();
    for (const e of vectorEntries) { const src = await PDFDocument.load(e.bytes, { ignoreEncryption: true }); const [pg] = await tmp.copyPages(src, [e.pageIdx]); tmp.addPage(pg); }
    vectorCost = (await tmp.save({ useObjectStreams: true })).byteLength;
  }
  onProgress && onProgress(8);
  const hiCache = new Map();
  async function getHiResPage(bytes, pageIdx) {
    let m = hiCache.get(bytes); if (!m) { m = {}; hiCache.set(bytes, m); }
    if (!m[pageIdx]) m[pageIdx] = await renderPageCanvas(bytes, pageIdx, 3);
    return m[pageIdx];
  }
  const buildOnce = async (forceRaster, budgetBytes) => {
    const useRaster = forceRaster ? entries.map((_, i) => i) : naturalRaster;
    const rasterUrls = useRaster.map(i => entries[i].dataUrl);
    const overrides = [];
    for (let r = 0; r < useRaster.length; r++) {
      const e2 = entries[useRaster[r]];
      let ov = null;
      if (e2.bytes && e2.pageIdx != null) { try { ov = await getHiResPage(e2.bytes, e2.pageIdx); } catch (err) { ov = null; } }
      overrides.push(ov);
    }
    let per = await allocateBudgets(rasterUrls, Math.max(1, budgetBytes / 1024));
    const assemble = async (arr) => {
      const byEntry = new Map(); useRaster.forEach((ei, r) => byEntry.set(ei, arr[r]));
      const out = await PDFDocument.create();
      const cache = new Map();
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.kind === 'vector' && !forceRaster) {
          let m = cache.get(e.bytes);
          if (!m) { const src = await PDFDocument.load(e.bytes, { ignoreEncryption: true }); m = { src, map: {} }; cache.set(e.bytes, m); }
          if (m.map[e.pageIdx] == null) { const [pg] = await out.copyPages(m.src, [e.pageIdx]); m.map[e.pageIdx] = pg; }
          out.addPage(m.map[e.pageIdx]);
        } else {
          await embedPage(out, byEntry.get(i), e.w || 595.28, e.h || 841.89);
        }
      }
      return new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
    };
    let blob = null;
    for (let round = 0; round < (opts.lock ? 1 : 3); round++) {
      const compressed = [];
      for (let r = 0; r < useRaster.length; r++) {
        compressed.push(await compressPageToTarget(rasterUrls[r], per[r], opts, overrides[r]));
        onProgress && onProgress(10 + Math.round(((r + 1) / Math.max(1, useRaster.length)) * 70) + round * 5);
      }
      blob = await assemble(compressed);
      if (!finite || blob.size <= targetKB * 1024) {
        if (finite) blob = await fillToTarget(compressed, per, rasterUrls, targetKB, opts, blob, assemble, overrides);
        return blob;
      }
      per = per.map(p => Math.max(2, p * ((targetKB * 1024 * 0.98) / blob.size)));
    }
    return blob;
  };

  let budgetBytes = finite ? targetKB * 1024 * 0.94 - vectorCost : Infinity;
  let forceRaster = !!opts.allowRaster && finite && budgetBytes < naturalRaster.length * 3000;
  if (forceRaster) budgetBytes = targetKB * 1024 * 0.94;
  let blob = await buildOnce(forceRaster, budgetBytes);
  if (opts.allowRaster && finite && blob.size > targetKB * 1024 && !forceRaster && vectorEntries.length) blob = await buildOnce(true, targetKB * 1024 * 0.94);
  const seenB = new Set(); let origSize = 0;
  for (const en of entries) if (en.bytes && !seenB.has(en.bytes)) { seenB.add(en.bytes); origSize += en.bytes.byteLength; }
  if (origSize && blob && blob.size > origSize && !opts.allowRaster) {
    const groups = new Map();
    for (const en of entries) if (en.bytes && en.pageIdx != null) { if (!groups.has(en.bytes)) groups.set(en.bytes, []); groups.get(en.bytes).push(en.pageIdx); }
    blob = await pdfMergeLossless([...groups].map(([bytes, indices]) => ({ bytes, indices })));
  }
  onProgress && onProgress(100);
  return blob;
}
