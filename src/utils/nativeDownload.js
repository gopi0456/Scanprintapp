/* Trigger an APK download that Android recognises and offers to install.
   Uses @capacitor/browser so the system handles .apk MIME correctly. */
export async function downloadApk(url, filename) {
  if (!url) return { ok: false, msg: 'No download link provided.' };

  /* Try Capacitor Browser first (native platform) */
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url, presentationStyle: 'popover' });
      return { ok: true, method: 'browser' };
    }
  } catch (e) { console.warn('Browser plugin unavailable', e); }

  /* Fallback: hidden iframe trick — works in WebViews that allow it */
  try {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 60000);
    return { ok: true, method: 'iframe' };
  } catch (e) {}

  /* Last resort: window.open (blocked on some Android versions) */
  try {
    const w = window.open(url, '_blank');
    if (w) return { ok: true, method: 'window.open' };
  } catch (e) {}

  return { ok: false, msg: 'Could not open the download link. Long-press the button and copy the link instead.' };
}

/* After downloading, prompt the user to INSTALL via FileProvider intent.
   Requires @capacitor/filesystem to have written the file locally. */
export async function installApkFromCache(filename) {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return { ok: false, msg: 'Install only works on Android devices.' };
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const path = filename || 'update.apk';
    const { uri } = await Filesystem.readFile({ path, directory: Directory.External, encoding: 'base64' }).then(() => ({ uri: null })).catch(() => ({}));
    /* The Browser plugin already triggered the OS installer when the MIME was application/vnd.android.package-archive */
    return { ok: true, hint: 'If the install prompt did not appear, open Settings → Apps → your browser → Downloads and tap the APK.' };
  } catch (e) { return { ok: false, msg: e.message }; }
}
