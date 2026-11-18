import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { APP_VERSION } from '../buildInfo.js';
import { fetchLatestUpdate, cmpVer } from '../utils/updateService.js';
import { downloadApk } from '../utils/nativeDownload.js';

let MOUNTED = false;
const forced = () => /#(testbanner|updates-test)/i.test(location.hash) || /[?&]banner=1/.test(location.search);
const snoozed = id => { try { return sessionStorage.getItem('gfs_upd_snooze_' + id) === '1'; } catch (e) { return false; } };

export default function UpdateBanner() {
  const [primary] = useState(() => { if (MOUNTED) return false; MOUNTED = true; return true; });
  const [upd, setUpd] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const barRef = useRef(null);
  const toastRef = useRef(null);
  const wrapRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => () => { MOUNTED = false; }, []);

  useEffect(() => {
    if (!primary) return;
    let alive = true;
    const load = async () => {
      const latest = await fetchLatestUpdate();
      if (!alive || !latest) return;
      const id = latest.version || latest.id;
      const isNews = latest.kind === 'news';
      const forceActive = latest.force_until ? new Date(latest.force_until).getTime() > Date.now() : false;
      if (!isNews && !forceActive && !forced() && latest.version && cmpVer(latest.version, APP_VERSION) >= 0) { setUpd(null); return; }
      if (isNews && !forced()) {
        let gone = false;
        try { gone = localStorage.getItem('gfs_upd_dismiss_' + id) === '1'; } catch (e) {}
        if (gone) { setUpd(null); return; }
      }
      if (snoozed(id) && !forceActive) { setUpd(null); return; }
      if (alive) { setUpd({ ...latest, isNews, id }); setHidden(false); }
    };
    load();
    const iv = setInterval(load, 45000);
    const onHash = () => load();
    const onForce = e => { if (e.key === 'gfs_force_check') load(); };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('storage', onForce);
    return () => { alive = false; clearInterval(iv); window.removeEventListener('hashchange', onHash); window.removeEventListener('storage', onForce); };
  }, [primary]);

  const pubDate = upd ? (() => { try { return new Date(upd.created_at).toLocaleDateString(); } catch (e) { return ''; } })() : '';
  const text = upd ? (upd.message || (upd.isNews ? 'News from admin' : `UPDATE v${upd.version} · published ${pubDate}`)) : '';
  const show = !!primary && !!upd && !hidden;

  /* reserve real space so the bar never covers the header and the toast never blocks controls */
  useLayoutEffect(() => {
    const bh = show && barRef.current ? barRef.current.offsetHeight : 0;
    const th = show && toastRef.current ? toastRef.current.offsetHeight : 0;
    document.body.style.paddingTop = bh ? bh + 'px' : '';
    document.body.style.paddingBottom = th ? (th + 14) + 'px' : '';
    document.documentElement.style.setProperty('--upx-bar-h', bh + 'px');
  });
  useEffect(() => () => {
    document.body.style.paddingTop = '';
    document.body.style.paddingBottom = '';
    document.documentElement.style.setProperty('--upx-bar-h', '0px');
  }, []);

  /* only scroll the message when it genuinely does not fit */
  useLayoutEffect(() => {
    const measure = () => {
      const wrap = wrapRef.current, txt = textRef.current;
      if (!wrap || !txt) { setOverflow(false); return; }
      setOverflow(txt.scrollWidth > wrap.clientWidth + 2);
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && wrapRef.current) {
      ro = new ResizeObserver(measure);
      ro.observe(wrapRef.current);
    }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [text, show]);

  if (!show) return null;

  const snooze = () => { try { sessionStorage.setItem('gfs_upd_snooze_' + upd.id, '1'); } catch (e) {} setHidden(true); };
  const dismissNews = () => { try { localStorage.setItem('gfs_upd_dismiss_' + upd.id, '1'); } catch (e) {} setHidden(true); };
  const close = upd.isNews ? dismissNews : snooze;
  const grab = () => downloadApk(upd.apk_url, 'scanprint-update.apk');

  return createPortal(
    <>
      <div className="upx-bar" ref={barRef}>
        <span className="upx-bar-tag">{upd.isNews ? 'NEWS' : 'NEW'}</span>
        <div className={'upx-marquee' + (overflow ? ' rolls' : '')} ref={wrapRef}>
          <div className="upx-marquee-track">
            <span ref={textRef}>{text}</span>
            {overflow && <span aria-hidden="true">{text}</span>}
          </div>
        </div>
        {upd.apk_url && <button className="upx-bar-dl" onClick={grab}>Download</button>}
        <button className="upx-bar-x" onClick={close} aria-label="Dismiss">×</button>
      </div>
      {upd.send_alert && (
        <div className="upx-toast" ref={toastRef}>
          <span className="upx-toast-ico">{upd.isNews ? '📰' : '⬇️'}</span>
          <div className="upx-toast-txt">
            <b>{upd.isNews ? 'News from admin' : `New update available (v${upd.version})`}</b>
            <i>{text}</i>
          </div>
          {upd.apk_url && <button className="upx-bar-dl" onClick={grab}>Get</button>}
          <button className="upx-bar-x" onClick={close} aria-label="Dismiss">×</button>
        </div>
      )}
    </>,
    document.body
  );
}
