const fs = require('fs');
const must = (c, m) => { if (!c) { console.log('❌ ' + m); process.exit(1); } };

/* ═══ 1. printEngine: at zoom 0 the page maps exactly onto the sheet ═══ */
const pe = 'src/utils/printEngine.js';
let p = fs.readFileSync(pe, 'utf8');
const OLD_FIT = /function fitContainAdjusted\(dataUrl, cfg, adj\) \{[\s\S]*?\n\}/;
must(OLD_FIT.test(p), 'fitContainAdjusted not found');
const NEW_FIT = `function fitContainAdjusted(dataUrl, cfg, adj) {
  return loadImage(dataUrl).then(img => {
    const W = sc(cfg.width), H = sc(cfg.height);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const a = adj || {};
    const zoom = Math.max(0.2, a.zoom || 1);
    /* zoom 1 (= 0%) draws the source page edge-to-edge on the sheet, exactly as the original */
    const dw = W * zoom, dh = H * zoom;
    const dx = (W - dw) / 2 + ((a.x || 0) / 100) * W;
    const dy = (H - dh) / 2 + ((a.y || 0) / 100) * H;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(((a.rotate || 0) * Math.PI) / 180);
    ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
    return c.toDataURL('image/jpeg', 0.92);
  });
}`;
p = p.replace(OLD_FIT, NEW_FIT);
fs.writeFileSync(pe, p);
console.log('✅ zoom 0% now equals the original page, edge to edge');

/* ═══ 2. ScanPrintPanel ═══ */
const sp = 'src/components/ScanPrintPanel.jsx';
let s = fs.readFileSync(sp, 'utf8');

/* 2a. zoom control becomes a percent offset where 0 = original */
const ZOOM_CALL = /inlineControl\('Zoom'[^;]*;/;
if (ZOOM_CALL.test(s)) {
  s = s.replace(ZOOM_CALL, `<div className="adj-row">
      <span className="adj-label">Zoom</span>
      <input type="range" min="-80" max="200" step="5" value={Math.round((adj.zoom - 1) * 100)} onChange={e => setAdj(a => ({ ...a, zoom: Math.max(0.2, Math.min(3, 1 + parseFloat(e.target.value) / 100)) }))} />
      <button className="em-step" onClick={() => applyZoom(adj.zoom - 0.05)}>−</button>
      <input type="number" className="adj-num" min="-80" max="200" step="5" value={Math.round((adj.zoom - 1) * 100)} onChange={e => setAdj(a => ({ ...a, zoom: Math.max(0.2, Math.min(3, 1 + (parseFloat(e.target.value) || 0) / 100)) }))} />
      <button className="em-step" onClick={() => applyZoom(adj.zoom + 0.05)}>+</button>
      <span className="adj-unit">% · 0 = original</span>
      <button className="em-step" title="Reset to original" onClick={() => setAdj({ ...DEFAULT_ADJ })}>⟲</button>
    </div>`);
  console.log('✅ zoom shown as % with 0 = original + reset button');
} else console.log('ℹ️ zoom control shape differs — left as is');

/* 2b. lightweight thumbnails so the strip scrolls smoothly */
if (!s.includes('thumbCache')) {
  if (!/import \{[^}]*loadImage[^}]*\} from '\.\.\/utils\/imageUtils\.js'/.test(s)) {
    s = s.replace(/import \{([^}]*)\} from '\.\.\/utils\/imageUtils\.js';/, (m, n) => `import {${n}, loadImage } from '../utils/imageUtils.js';`);
  }
  const PI = '  const [previewTotal, setPreviewTotal] = useState(0);';
  must(s.includes(PI), 'previewTotal anchor');
  s = s.replace(PI, PI + `
  const thumbCache = useRef(new Map());
  const [thumbTick, setThumbTick] = useState(0);
  const makeThumb = (url) => loadImage(url).then(img => {
    const max = 260;
    const k = Math.min(max / img.width, max / img.height, 1);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  }).catch(() => url);
  const thumbOf = (u) => thumbCache.current.get(u) || u;`);

  const ADD = s.match(/const addImages = \(urls\) => \{[\s\S]*?\};/);
  must(ADD, 'addImages');
  s = s.replace(ADD[0], ADD[0].replace(/};\s*$/, `  Promise.all(urls.map(makeThumb)).then(ts => { urls.forEach((u, i) => thumbCache.current.set(u, ts[i])); setThumbTick(t => t + 1); });\n};`));
  console.log('✅ thumbnails generated on upload');

  /* swap the strip's full-res imgs for thumbs */
  const maps = [...s.matchAll(/printImages\.map\(/g)];
  let swapped = 0;
  for (const m of maps) {
    const seg = s.slice(m.index, m.index + 700);
    const img = seg.match(/<img[^>]*src=\{([^}]+)\}/);
    if (img && !img[1].includes('thumbOf')) {
      s = s.slice(0, m.index + img.index) + img[0].replace('src={' + img[1] + '}', 'src={thumbOf(' + img[1] + ')}') + s.slice(m.index + img.index + img[0].length);
      swapped++;
    }
  }
  console.log('✅ ' + swapped + ' thumbnail img(s) now use the small preview');
  s = s.replace(/const toggle = /, 'void thumbTick;\n  const toggle = ');
}

/* 2c. even / odd / all page presets */
if (!s.includes('parity-chips')) {
  const RANGE = s.match(/<input[^>]*placeholder="All pages \(e\.g\. 1-3, 5, 7-9\)"[^>]*\/>/);
  must(RANGE, 'range input');
  const CHIPS = RANGE[0] + `
                <div className="parity-chips">
                  <button className={'pc' + (rangeInput === '' ? ' on' : '')} onClick={() => setRangeInput('')}>All</button>
                  <button className="pc" onClick={() => setRangeInput(Array.from({ length: activeImages.length }, (_, i) => i + 1).filter(n => n % 2 === 1).join(','))}>Odd pages</button>
                  <button className="pc" onClick={() => setRangeInput(Array.from({ length: activeImages.length }, (_, i) => i + 1).filter(n => n % 2 === 0).join(','))}>Even pages</button>
                </div>`;
  s = s.replace(RANGE[0], CHIPS);
  console.log('✅ All / Odd / Even page presets added');
}

fs.writeFileSync(sp, s);
