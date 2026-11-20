import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { APP_VERSION, APP_BUILD_DATE } from '../buildInfo.js';
import { fetchLatestUpdate, cmpVer } from '../utils/updateService.js';
import { downloadApk } from '../utils/nativeDownload.js';

let MOUNTED = false;
const forced = () => /#testbanner/i.test(location.hash);

export default function UpdateBanner() {
  const [primary] = useState(() => { if (MOUNTED) return false; MOUNTED = true; return true; });
  const [upd, setUpd] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const barRef = useRef(null), toastRef = useRef(null), wrapRef = useRef(null), textRef = useRef(null);

  useEffect(() => () => { MOUNTED = false; }, []);

  useEffect(() => {
    if (!primary) return;
    let alive = true;
    const load = async () => {
      const latest = await fetchLatestUpdate();
      if (!alive || !latest) { if (alive) setUpd(null); return; }
      const id = latest.version || latest.id;
      const isNews = latest.kind === 'news';

      if (!isNews && latest.version) {
        /* installed build is the same or newer → up to date, always hide,
           even if an admin re-alert window is still open */
        if (!forced() && cmpVer(latest.version, APP_VERSION) >= 0) {
          try {
            localStorage.setItem('gfs_update_installed', latest.version);
            sessionStorage.removeItem('gfs_upd_snooze_' + id);
          } catch (e) {}
          setUpd(null); return;
        }
        /* same version but a rebuild published later — the build stamp settles it */
        if (!forced() && latest.version === APP_VERSION && APP_BUILD_DATE) { setUpd(null); return; }
      }
      if (isNews && !forced()) {
        let gone = false;
        try { gone = localStorage.getItem('gfs_upd_dismiss_' + id) === '1'; } catch (e) {}
        if (gone) { setUpd(null); return; }
      }
      let snoozed = false;
      try { snoozed = sessionStorage.getItem('gfs_upd_snooze_' + id) === '1'; } catch (e) {}
      if (snoozed) { setUpd(null); return; }
      if (alive) { setUpd({ ...latest, isNews, id }); setHidden(false); }
    };
    load();
    const iv = setInterval(load, 45000);
    const onForce = e => { if (e.key === 'gfs_force_check') load(); };
    window.addEventListener('storage', onForce);
    window.addEventListener('hashchange', load);
    return () => { alive = false; clearInterval(iv); window.removeEventListener('storage', onForce); window.removeEventListener('hashchange', load); };
  }, [primary]);

  const text = upd ? (upd.message || (upd.isNews ? 'News from admin' : `UPDATE v${upd.version}`)) : '';
  const show = !!primary && !!upd && !hidden;

  useLayoutEffect(() => {
    const bh = show && barRef.current ? barRef.current.offsetHeight : 0;
    const th = show && toastRef.current ? toastRef.current.offsetHeight : 0;
    const top = bh ? bh + 'px' : '';
    const bot = th ? (th + 14) + 'px' : '';
    if (document.body.style.paddingTop !== top) document.body.style.paddingTop = top;
    if (document.body.style.paddingBottom !== bot) document.body.style.paddingBottom = bot;
  });
  useEffect(() => () => { document.body.style.paddingTop = ''; document.body.style.paddingBottom = ''; }, []);

  useLayoutEffect(() => {
    const measure = () => {
      const w = wrapRef.current, t = textRef.current;
      if (!w || !t) { setOverflow(false); return; }
      setOverflow(t.scrollWidth > w.clientWidth + 2);
    };
    measure();
    let ro = null;
    if (typeof ResizeObserver !== 'undefined' && wrapRef.current) { ro = new ResizeObserver(measure); ro.observe(wrapRef.current); }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [text, show]);

  if (!show) return null;
  const close = () => {
    try {
      if (upd.isNews) localStorage.setItem('gfs_upd_dismiss_' + upd.id, '1');
      else sessionStorage.setItem('gfs_upd_snooze_' + upd.id, '1');
    } catch (e) {}
    setHidden(true);
  };
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
          <div className="upx-toast-txt"><b>{upd.isNews ? 'News from admin' : `New update (v${upd.version})`}</b><i>{text}</i></div>
          {upd.apk_url && <button className="upx-bar-dl" onClick={grab}>Get</button>}
          <button className="upx-bar-x" onClick={close} aria-label="Dismiss">×</button>
        </div>
      )}
    </>,
    document.body
  );
}
