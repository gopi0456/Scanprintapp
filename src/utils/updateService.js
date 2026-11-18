import { supabase } from '../supabaseClient.js';

export const supabaseConfigured = true;
export const APP_VERSION_FALLBACK = '1.0.0';
const TABLE = 'scanprintupdates';
const BUCKET = 'scanprintupload';

const getSupabase = () => supabase;
const race = (p, ms, label) => Promise.race([
  Promise.resolve(p),
  new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timed out')), ms))
]);

export const parseVer = v => String(v || '0').split('.').map(n => parseInt(n, 10) || 0);
export function cmpVer(a, b) {
  const x = parseVer(a), y = parseVer(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
  return 0;
}
export function isNewer(latest, current) { return cmpVer(latest, current) < 0; }
export function isNewerOrEqual(latest, current) { return cmpVer(latest, current) <= 0; }

export async function getAppVersionInfo() {
  try {
    const cap = typeof window !== 'undefined' ? window.Capacitor : null;
    const plug = cap && cap.Plugins && cap.Plugins.App;
    if (plug && typeof plug.getInfo === 'function') {
      const info = await plug.getInfo();
      if (info && info.version) return { version: info.version, exact: true };
    }
  } catch (e) {}
  try { const v = import.meta.env && import.meta.env.VITE_APP_VERSION; if (v) return { version: v, exact: true }; } catch (e) {}
  return { version: APP_VERSION_FALLBACK, exact: false };
}
export async function getCurrentVersion() { return (await getAppVersionInfo()).version; }

export async function fetchLatestUpdate() {
  try {
    const { data, error } = await race(
      supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(1), 9000, 'Update check');
    if (error || !data || !data.length) return null;
    return data[0];
  } catch (e) { return null; }
}

export async function listUpdates() {
  const { data, error } = await race(
    supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(80), 12000, 'Loading list');
  if (error) throw new Error(error.message);
  return data || [];
}

export async function deleteUpdates(ids) {
  const { error } = await race(supabase.from(TABLE).delete().in('id', ids), 12000, 'Delete');
  if (error) throw new Error(error.message);
  return true;
}

export async function restoreUpdates(rows) {
  const payload = rows.map(r => ({
    id: r.id, kind: r.kind, version: r.version, apk_url: r.apk_url,
    message: r.message, send_alert: r.send_alert, created_at: r.created_at
  }));
  const { error } = await race(supabase.from(TABLE).insert(payload), 12000, 'Undo');
  if (error) throw new Error(error.message);
  return true;
}

export async function publishUpdate({ kind, version, file, link, message, sendAlert, onProgress }) {
  let apkUrl = (link || '').trim();
  if (file) {
    const safe = file.name.replace(/[^\w.\-]/g, '_');
    const path = `update-${Date.now()}-${safe}`;
    const base = supabase.supabaseUrl || (supabase.storageUrl || '').replace('/storage/v1', '');
    const key = supabase.supabaseKey;
    if (base && key && typeof XMLHttpRequest !== 'undefined') {
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${base}/storage/v1/object/${BUCKET}/${path}`);
        xhr.setRequestHeader('apikey', key);
        xhr.setRequestHeader('Authorization', 'Bearer ' + key);
        xhr.setRequestHeader('x-upsert', 'false');
        xhr.setRequestHeader('Content-Type', 'application/vnd.android.package-archive');
        xhr.timeout = 300000;
        xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100)); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve()
          : reject(new Error(`Upload failed (${xhr.status}). ${String(xhr.responseText).slice(0, 140)}`));
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.ontimeout = () => reject(new Error('Upload timed out'));
        xhr.send(file);
      });
    } else {
      const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: 'application/vnd.android.package-archive',
        duplex: 'half' });
      if (up.error) throw new Error('APK upload failed: ' + up.error.message);
    }
    apkUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
  if (kind === 'update' && !apkUrl) throw new Error('Choose an APK file or paste a download link.');
  const { data, error } = await race(supabase.from(TABLE).insert([{
    kind, version: (version || '').trim(), apk_url: apkUrl,
    message: (message || '').trim(), send_alert: !!sendAlert
  }]).select(), 15000, 'Publish');
  if (error) throw new Error(error.message);
  return data[0];
}

export function openDownload(url) { try { window.open(url, '_blank'); } catch (e) { console.warn(e); } }

/* Bump updated_at + send_alert on the latest publish so every client re-shows it.
   Clients key their "seen" marker on version + updated_at, so a new timestamp = new alert. */
export async function realertUpdates() {
  const { data: latest, error: selErr } = await supabase
    .from(TABLE).select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (!latest) throw new Error('Nothing published yet — publish an update first.');
  const { data, error } = await supabase
    .from(TABLE)
    .update({ send_alert: true, updated_at: new Date().toISOString() })
    .eq('id', latest.id)
    .select();
  if (error) throw new Error(error.message);
  return data[0];
}
