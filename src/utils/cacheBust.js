import { APP_BUILD_DATE, APP_VERSION } from '../buildInfo.js';

const KEY = 'gfs_build_stamp';
try {
  const prev = localStorage.getItem(KEY);
  if (prev !== APP_BUILD_DATE) {
    localStorage.setItem(KEY, APP_BUILD_DATE);
    localStorage.setItem('gfs_app_version', APP_VERSION);
    if (prev) {
      /* a genuine upgrade: clear Cache Storage, then reload once for fresh modules */
      if ('caches' in window) {
        caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
      }
      if (!sessionStorage.getItem('gfs_cb_done')) {
        sessionStorage.setItem('gfs_cb_done', '1');
        location.reload();
      }
    }
  }
} catch (e) { /* storage unavailable — ignore */ }
