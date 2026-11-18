import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { loadImage } from '../utils/imageUtils.js';
import { DEFAULT_ADJ } from '../utils/printEngine.js';

export const ANCHORS = {
  tl: [-0.5, -0.5], t: [0, -0.5], tr: [0.5, -0.5],
  l: [-0.5, 0], c: [0, 0], r: [0.5, 0],
  bl: [-0.5, 0.5], b: [0, 0.5], br: [0.5, 0.5]
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;

async function detectBounds(src) {
  const img = await loadImage(src);
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y += 2) for (let x = 0; x < c.width; x += 2) {
    const i = (y * c.width + x) * 4;
    if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return { x: 0, y: 0, w: 1, h: 1 };
  const pad = 6;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(c.width - 1, maxX + pad); maxY = Math.min(c.height - 1, maxY + pad);
  return { x: r2(minX / c.width), y: r2(minY / c.height), w: r2((maxX - minX + 1) / c.width), h: r2((maxY - minY + 1) / c.height) };
}

export default function EditModal({ open, onClose, adj, setAdj, anchor, setAnchor, source, preview, aspectW, aspectH }) {
  const [mode, setMode] = useState('size');
  const [dims, setDims] = useState({ w: 1, h: 1 });
  const boxRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => { if (open && source) loadImage(source).then(im => setDims({ w: im.width, h: im.height })).catch(() => {}); }, [open, source]);
  if (!open) return null;

  const set = (k, v) => setAdj(a => ({ ...a, [k]: v }));
  const applyZoom = (nz) => setAdj(a => {
    const z = clamp(nz, 0.2, 4); const [ax, ay] = ANCHORS[anchor];
    return { ...a, zoom: r2(z), x: Math.round(clamp(a.x + ax * (a.zoom - z) * 100, -60, 60)), y: Math.round(clamp(a.y + ay * (a.zoom - z) * 100, -60, 60)) };
  });
  const autoDetect = async () => { if (source) set('crop', await detectBounds(source)); };

  const down = (e) => {
    const box = boxRef.current?.getBoundingClientRect(); if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const handle = e.target.dataset.handle || (mode === 'size' ? 'pan' : 'move');
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    dragRef.current = { handle, box, cx, cy, sx: e.clientX, sy: e.clientY, start: { ...adj }, startCrop: { ...adj.crop }, dist: Math.hypot(e.clientX - cx, e.clientY - cy) || 1 };
  };
  const move = (e) => {
    const d = dragRef.current; if (!d) return;
    if (mode === 'size') {
      if (d.handle !== 'pan') {
        const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy) || 1;
        const nz = clamp(d.start.zoom * (dist / d.dist), 0.2, 4);
        const [ax, ay] = ANCHORS[anchor];
        setAdj(a => ({ ...a, zoom: r2(nz), x: Math.round(clamp(d.start.x + ax * (d.start.zoom - nz) * 100, -60, 60)), y: Math.round(clamp(d.start.y + ay * (d.start.zoom - nz) * 100, -60, 60)) }));
      } else {
        const dx = ((e.clientX - d.sx) / d.box.width) * 100, dy = ((e.clientY - d.sy) / d.box.height) * 100;
        setAdj(a => ({ ...a, x: Math.round(clamp(d.start.x + dx, -60, 60)), y: Math.round(clamp(d.start.y + dy, -60, 60)) }));
      }
    } else {
      const dx = (e.clientX - d.sx) / d.box.width, dy = (e.clientY - d.sy) / d.box.height;
      const s = d.startCrop; let { x, y, w, h } = s; const M = 0.05;
      if (d.handle === 'move') { x = clamp(s.x + dx, 0, 1 - s.w); y = clamp(s.y + dy, 0, 1 - s.h); }
      if (d.handle === 'se') { w = clamp(s.w + dx, M, 1 - s.x); h = clamp(s.h + dy, M, 1 - s.y); }
      if (d.handle === 'ne') { w = clamp(s.w + dx, M, 1 - s.x); const ny = clamp(s.y + dy, 0, s.y + s.h - M); h = s.h + (s.y - ny); y = ny; }
      if (d.handle === 'sw') { const nx = clamp(s.x + dx, 0, s.x + s.w - M); w = s.w + (s.x - nx); x = nx; h = clamp(s.h + dy, M, 1 - s.y); }
      if (d.handle === 'nw') { const nx = clamp(s.x + dx, 0, s.x + s.w - M); w = s.w + (s.x - nx); x = nx; const ny = clamp(s.y + dy, 0, s.y + s.h - M); h = s.h + (s.y - ny); y = ny; }
      set('crop', { x: r2(x), y: r2(y), w: r2(w), h: r2(h) });
    }
  };
  const up = () => { dragRef.current = null; };

  const step = (key, delta, min, max) => { if (key === 'zoom') return applyZoom(adj.zoom + delta); set(key, clamp(r2(adj[key] + delta), min, max)); };
  const control = (label, key, min, max, st, unit) => (
    <div className="em-row">
      <span className="em-label">{label}</span>
      <button className="em-step" onClick={() => step(key, -st, min, max)}>−</button>
      <input type="number" className="em-num" min={min} max={max} step={st} value={adj[key]} onChange={e => key === 'zoom' ? applyZoom(parseFloat(e.target.value) || min) : set(key, clamp(parseFloat(e.target.value) || 0, min, max))} />
      <button className="em-step" onClick={() => step(key, st, min, max)}>+</button>
      <span className="em-unit">{unit}</span>
      <input type="range" min={min} max={max} step={st} value={adj[key]} onChange={e => key === 'zoom' ? applyZoom(parseFloat(e.target.value)) : set(key, parseFloat(e.target.value))} />
    </div>
  );
  const cr = adj.crop;

  return createPortal(
    <div className="em-overlay">
      <div className="em-card">
        <div className="em-head">
          <span>🛠 Edit — applies to all pages</span>
          <button className="em-close" onClick={onClose}>✕</button>
        </div>
        <div className="em-tabs">
          {['preview', 'size', 'crop'].map(m => (
            <button key={m} className={'em-tab' + (mode === m ? ' on' : '')} onClick={() => setMode(m)}>{m === 'preview' ? '👁 Preview' : m === 'size' ? '🔍 Zoom' : '✂️ Crop area'}</button>
          ))}
        </div>
        <div className="em-mode-hint">{mode === 'crop' ? 'Drag the green box over the part you want to KEEP — only that area is saved, on every page.' : mode === 'size' ? 'Drag any corner to zoom the image bigger / smaller; drag inside to move it.' : 'This is exactly what will print / save.'}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button className="em-chip" onClick={() => setAdj(a => ({ ...a, fit: 'cover', zoom: 1, x: 0, y: 0 }))}>⤢ Fill frame</button>
                <button className="em-chip" onClick={() => setAdj(a => ({ ...a, fit: 'contain', zoom: 1, x: 0, y: 0 }))}>🖼 Fit inside frame</button>
                <button className="em-chip" onClick={() => setAdj(a => ({ ...a, zoom: 1, x: 0, y: 0, rot: 0 }))}>↺ Reset position</button>
              </div>
        <div className="em-stage" style={{ aspectRatio: mode === 'preview' ? (aspectW + ' / ' + aspectH) : (dims.w + ' / ' + dims.h) }}>
          {mode === 'preview' ? <img src={preview} alt="preview" /> : (
            <div className="em-box" ref={boxRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              <img src={source} alt="source" style={mode === 'size' ? { transform: `translate(${adj.x}%, ${adj.y}%) scale(${adj.zoom}) rotate(${adj.rot}deg)`, filter: `brightness(${adj.brightness}%) contrast(${adj.contrast}%)` } : {}} />
              {mode === 'size' ? (<>
                <span className="em-handle nw" data-handle="nw" /><span className="em-handle ne" data-handle="ne" />
                <span className="em-handle sw" data-handle="sw" /><span className="em-handle se" data-handle="se" />
                <span className="em-anchor-dot" style={{ left: (ANCHORS[anchor][0] + 0.5) * 100 + '%', top: (ANCHORS[anchor][1] + 0.5) * 100 + '%' }} />
              </>) : (
                <div className="em-crop" data-handle="move" style={{ left: cr.x * 100 + '%', top: cr.y * 100 + '%', width: cr.w * 100 + '%', height: cr.h * 100 + '%' }}>
                  <span className="em-handle nw" data-handle="nw" /><span className="em-handle ne" data-handle="ne" />
                  <span className="em-handle sw" data-handle="sw" /><span className="em-handle se" data-handle="se" />
                </div>
              )}
            </div>
          )}
        </div>
        {mode === 'crop' && (
          <div className="em-crop-actions">
            <button className="em-chip on" onClick={autoDetect}>🔍 Auto-detect document</button>
            <button className="em-chip" onClick={() => set('crop', { x: 0, y: 0, w: 1, h: 1 })}>Full page</button>
          </div>
        )}
        <div className="em-tools">
          <div className="em-block">
            <div className="em-block-title">Rotate</div>
            <div className="em-chips">{[0, 45, 90, 135, 180, 225, 270, 315, 360].map(d => <button key={d} className={'em-chip' + (adj.rot === d ? ' on' : '')} onClick={() => set('rot', d)}>{d}°</button>)}</div>
          </div>
          <div className="em-block">
            <div className="em-block-title">Fixed anchor (drag keeps this point still)</div>
            <div className="em-anchor-grid">{Object.keys(ANCHORS).map(k => <button key={k} className={'em-anchor' + (anchor === k ? ' on' : '')} onClick={() => setAnchor(k)} title={k} />)}</div>
          </div>
          {control('Zoom', 'zoom', 0.2, 4, 0.05, '×')}
          {control('Move X', 'x', -60, 60, 1, '%')}
          {control('Move Y', 'y', -60, 60, 1, '%')}
          {control('Rotate', 'rot', -180, 180, 1, '°')}
          {control('Bright', 'brightness', 50, 150, 1, '%')}
          {control('Contrast', 'contrast', 50, 150, 1, '%')}
          <div className="em-row">
            <span className="em-label">Fit</span>
            <select className="em-select" value={adj.fit} onChange={e => set('fit', e.target.value)}><option value="cover">Fill (crop)</option><option value="contain">Fit (no crop)</option></select>
            <button className="em-reset" onClick={() => setAdj({ ...DEFAULT_ADJ })}>Reset all</button>
          </div>
        </div>
        <div className="em-foot"><button className="em-apply" onClick={onClose}>✓ Apply to all pages</button></div>
      </div>
    </div>,
    document.body
  );
}
