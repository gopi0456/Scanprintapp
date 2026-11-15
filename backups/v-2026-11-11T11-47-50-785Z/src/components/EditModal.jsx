import { useState, useRef, useEffect } from 'react';
import { loadImage } from '../utils/imageUtils.js';
import { DEFAULT_ADJ } from '../utils/printEngine.js';

export const ANCHORS = {
  tl: [-0.5, -0.5], t: [0, -0.5], tr: [0.5, -0.5],
  l: [-0.5, 0], c: [0, 0], r: [0.5, 0],
  bl: [-0.5, 0.5], b: [0, 0.5], br: [0.5, 0.5]
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;

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

  const step = (key, delta, min, max) => {
    if (key === 'zoom') return applyZoom(adj.zoom + delta);
    set(key, clamp(r2(adj[key] + delta), min, max));
  };
  const control = (label, key, min, max, st, unit) => (
    <div className="em-row">
      <span className="em-label">{label}</span>
      <input type="range" min={min} max={max} step={st} value={adj[key]} onChange={e => key === 'zoom' ? applyZoom(parseFloat(e.target.value)) : set(key, parseFloat(e.target.value))} />
      <button className="em-step" onClick={() => step(key, -st, min, max)}>−</button>
      <input type="number" className="em-num" min={min} max={max} step={st} value={adj[key]} onChange={e => key === 'zoom' ? applyZoom(parseFloat(e.target.value) || min) : set(key, clamp(parseFloat(e.target.value) || 0, min, max))} />
      <button className="em-step" onClick={() => step(key, st, min, max)}>+</button>
      <span className="em-unit">{unit}</span>
    </div>
  );
  const cr = adj.crop;

  return (
    <div className="em-overlay" onClick={onClose}>
      <div className="em-card" onClick={e => e.stopPropagation()}>
        <div className="em-head">
          <span>🛠 Edit page — applies to all pages</span>
          <button className="em-close" onClick={onClose}>✕</button>
        </div>
        <div className="em-tabs">
          {['preview', 'size', 'crop'].map(m => (
            <button key={m} className={'em-tab' + (mode === m ? ' on' : '')} onClick={() => setMode(m)}>{m === 'preview' ? '👁 Preview' : m === 'size' ? '↔️ Size' : '✂️ Crop'}</button>
          ))}
        </div>
        <div className="em-stage" style={{ aspectRatio: mode === 'preview' ? (aspectW + ' / ' + aspectH) : (dims.w + ' / ' + dims.h) }}>
          {mode === 'preview' ? <img src={preview} alt="preview" /> : (
            <div className="em-box" ref={boxRef} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
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
        <div className="em-tools">
          <div className="em-block">
            <div className="em-block-title">Rotate</div>
            <div className="em-chips">
              {[0, 45, 135, 180].map(d => <button key={d} className={'em-chip' + (adj.rot === d ? ' on' : '')} onClick={() => set('rot', d)}>{d}°</button>)}
              <button className={'em-chip' + (adj.rot === 90 ? ' on' : '')} onClick={() => set('rot', 90)}>90°</button>
            </div>
          </div>
          <div className="em-block">
            <div className="em-block-title">Fixed anchor (drag keeps this point still)</div>
            <div className="em-anchor-grid">
              {Object.keys(ANCHORS).map(k => (
                <button key={k} className={'em-anchor' + (anchor === k ? ' on' : '')} onClick={() => setAnchor(k)} title={k} />
              ))}
            </div>
          </div>
          {control('Zoom', 'zoom', 0.2, 4, 0.05, '×')}
          {control('Move X', 'x', -60, 60, 1, '%')}
          {control('Move Y', 'y', -60, 60, 1, '%')}
          {control('Rotate', 'rot', -180, 180, 1, '°')}
          {control('Bright', 'brightness', 50, 150, 1, '%')}
          {control('Contrast', 'contrast', 50, 150, 1, '%')}
          <div className="em-row">
            <span className="em-label">Fit</span>
            <select className="em-select" value={adj.fit} onChange={e => set('fit', e.target.value)}>
              <option value="cover">Fill (crop)</option><option value="contain">Fit (no crop)</option>
            </select>
            <button className="em-reset" onClick={() => setAdj({ ...DEFAULT_ADJ })}>Reset all</button>
          </div>
        </div>
        <div className="em-foot">
          <button className="em-apply" onClick={onClose}>✓ Apply to all pages</button>
        </div>
      </div>
    </div>
  );
}
