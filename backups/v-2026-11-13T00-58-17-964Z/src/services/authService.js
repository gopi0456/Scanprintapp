import { supabase, TABLE } from '../supabaseClient.js';

const SESSION_KEY = 'scanprint_session';
const DEVICE_KEY = 'scanprint_device';

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
function sha256(message) {
  const KK = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes); padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15],7) ^ rotr(w[i-15],18) ^ (w[i-15] >>> 3);
      const s1 = rotr(w[i-2],17) ^ rotr(w[i-2],19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + KK[i] + w[i]) >>> 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
    H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
  }
  return H.map(x => x.toString(16).padStart(8, '0')).join('');
}

export function hashPassword(pw) { return sha256('scanprint::' + pw); }
export function normalizeUsername(u) { return u.trim().toLowerCase().split('@')[0] + '@scanprint.app'; }
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
export function getDeviceId() {
  let d = localStorage.getItem(DEVICE_KEY);
  if (!d) { d = uid(); localStorage.setItem(DEVICE_KEY, d); }
  return d;
}
export function isExpired(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr + 'T23:59:59').getTime() < Date.now();
}

export async function ensureAdmin() {
  const { data } = await supabase.from(TABLE).select('id').eq('username', 'admin@scanprint.app').maybeSingle();
  if (!data) {
    await supabase.from(TABLE).insert({
      username: 'admin@scanprint.app',
      password_hash: hashPassword('admin@123'),
      first_name: 'Admin', last_name: 'SuperUser',
      role: 'admin', expiry_date: null
    });
  }
}

export async function login(usernameRaw, password) {
  const username = normalizeUsername(usernameRaw);
  const hash = hashPassword(password);
  const { data, error } = await supabase.from(TABLE).select('*').eq('username', username).maybeSingle();
  if (error) throw error;
  if (!data || data.password_hash !== hash) return { ok: false, msg: 'Invalid username or password' };

  const expired = isExpired(data.expiry_date);
  const token = uid() + uid();
  const device = getDeviceId();
  await supabase.from(TABLE).update({ session_token: token, device_id: device, updated_at: new Date().toISOString() }).eq('id', data.id);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ username, token, device }));
  return { ok: true, user: { ...data, session_token: token }, expired };
}

export async function registerUser({ usernameRaw, password, firstName, lastName }) {
  const username = normalizeUsername(usernameRaw);
  const device = getDeviceId();
  const { data: existing } = await supabase.from(TABLE).select('username').eq('device_id', device).neq('role', 'admin').limit(1).maybeSingle();
  if (existing) return { ok: false, deviceLocked: true, lockedUsername: existing.username, msg: `Your device is already registered with username ${existing.username}. Please contact admin.` };
  const { data: dup } = await supabase.from(TABLE).select('id').eq('username', username).maybeSingle();
  if (dup) return { ok: false, msg: 'Username already exists' };
  const exp = new Date(); exp.setDate(exp.getDate() + 3);
  const expiryStr = exp.toISOString().split('T')[0];
  const token = uid() + uid();
  const { error } = await supabase.from(TABLE).insert({
    username, password_hash: hashPassword(password),
    first_name: firstName || '', last_name: lastName || '',
    role: 'user', expiry_date: expiryStr,
    session_token: token, device_id: device
  });
  if (error) return { ok: false, msg: error.message };
  localStorage.setItem(SESSION_KEY, JSON.stringify({ username, token, device }));
  const { data: fresh } = await supabase.from(TABLE).select('*').eq('username', username).maybeSingle();
  return { ok: true, user: fresh, expiry: expiryStr };
}

export async function verifySession() {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return { status: 'none' };
  let s; try { s = JSON.parse(raw); } catch { return { status: 'none' }; }
  if (!s || !s.username || !s.token) return { status: 'none' };
  const { data } = await supabase.from(TABLE).select('*').eq('username', s.username).maybeSingle();
  if (!data) return { status: 'none' };
  if (data.session_token !== s.token) return { status: 'other-device' };
  return { status: 'ok', user: data, expired: isExpired(data.expiry_date) };
}

export function logoutLocal() { localStorage.removeItem(SESSION_KEY); }
