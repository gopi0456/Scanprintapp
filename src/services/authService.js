import { supabase, TABLE } from '../supabaseClient.js';

/* ── SHA-256 (pure JS, matches sha256('scanprint::' + pw)) ── */
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
]);
const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
function sha256Hex(str) {
  const bytes = new TextEncoder().encode(String(str));
  const l = bytes.length;
  const blocks = Math.ceil((l + 9) / 64);
  const total = blocks * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes); buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = l * 8;
  dv.setUint32(total - 8, Math.floor(bits / 4294967296), false);
  dv.setUint32(total - 4, bits >>> 0, false);
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    const off = b * 64;
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(off + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15], y = w[t - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = H[0], b2 = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let t = 0; t < 64; t++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b2) ^ (a & c) ^ (b2 & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b2; b2 = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b2) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  return Array.from(H).map(x => x.toString(16).padStart(8, '0')).join('');
}
export function hashPassword(pw) { return sha256Hex('scanprint::' + pw); }

export const BOOTSTRAP_ADMIN = { username: 'admin', password: 'admin@123' };
const ADMIN_ALIASES = ['admin', 'admin@scanprint.app', 'administrator', 'superadmin', 'admin superuser'];
const SESSION_KEY = 'scanprint_session';
const SESSION_KEYS = ['scanprint_session', 'session', 'gfs_session', 'scanprint_session_v1'];
const DEVICE_KEY = 'scanprint_device';

const norm = v => String(v || '').trim();
const isAdminAlias = v => ADMIN_ALIASES.includes(norm(v).toLowerCase());
export function normalizeUsername(v) {
  const raw = String(v || '').trim().toLowerCase();
  if (!raw) return '';
  return raw.includes('@') ? raw : raw + '@scanprint.app';
}

function deviceId() {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) { d = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10); localStorage.setItem(DEVICE_KEY, d); }
    return d;
  } catch (e) { return 'dev_anon'; }
}
const token = () => 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 12);

function toSession(row, tok) {
  return {
    id: row.id, username: row.username, role: row.role || 'user',
    first_name: row.first_name || '', last_name: row.last_name || '',
    expiry_date: row.expiry_date || null,
    token: tok, session_token: tok
  };
}
function saveSession(s) {
  try {
    const raw = JSON.stringify(s);
    for (const k of SESSION_KEYS) localStorage.setItem(k, raw);
    if (s.role === 'admin') localStorage.setItem('gfs_upd_admin', '1');
    else localStorage.removeItem('gfs_upd_admin');
  } catch (e) {}
}
function readSession() {
  try {
    for (const k of SESSION_KEYS) {
      const raw = localStorage.getItem(k);
      if (raw) { try { const o = JSON.parse(raw); if (o && o.username) return o; } catch (e) {} }
    }
    return null;
  } catch (e) { return null; }
}
const expired = row => row && row.expiry_date && new Date(row.expiry_date) < new Date();

async function findAdminRow() {
  try { const { data } = await supabase.from(TABLE).select('*').eq('role', 'admin').limit(1).maybeSingle(); return data || null; }
  catch (e) { return null; }
}
async function findByName(name) {
  const raw = norm(name), low = raw.toLowerCase();
  const cands = [...new Set([raw, low, low + '@scanprint.app', normalizeUsername(raw)])].filter(Boolean);
  for (const cand of cands) {
    try {
      const { data } = await supabase.from(TABLE).select('*').eq('username', cand).limit(1).maybeSingle();
      if (data) return data;
    } catch (e) {}
  }
  try {
    const { data } = await supabase.from(TABLE).select('*').ilike('username', low + '%').limit(1).maybeSingle();
    if (data) return data;
  } catch (e) {}
  return null;
}

export async function ensureAdmin() {
  const existing = await findAdminRow();
  if (existing) {
    console.log('[auth] ensureAdmin: admin already exists with username', existing.username);
    return existing;  // NEVER overwrite — respect the password set in Supabase
  }
  console.log('[auth] ensureAdmin: no admin found, creating bootstrap admin');
  try {
    const { data } = await supabase.from(TABLE).insert({
      username: BOOTSTRAP_ADMIN.username,
      password_hash: hashPassword(BOOTSTRAP_ADMIN.password),
      first_name: 'Admin', last_name: 'SuperUser',
      role: 'admin', expiry_date: null, device_id: deviceId()
    }).select().maybeSingle();
    return data || null;
  } catch (e) { console.warn('ensureAdmin', e); return null; }
}

export async function login(usernameRaw, password) {
  const name = norm(usernameRaw), pw = String(password || '');
  if (!name || !pw) return { ok: false, msg: 'Enter username and password' };
  const hash = hashPassword(pw);

  let row = await findByName(name);
  if (!row && isAdminAlias(name)) row = await findAdminRow();

  if (row && row.password_hash === hash) {
    if (expired(row)) return { ok: false, msg: 'This account has expired. Contact the admin.' };
    const tok = token();
    try { await supabase.from(TABLE).update({ session_token: tok }).eq('id', row.id); } catch (e) {}
    const s = toSession(row, tok);
    saveSession(s);
    return { ok: true, session: s, user: s, msg: '' };
  }

  if (!row && isAdminAlias(name) && pw === BOOTSTRAP_ADMIN.password) {
    let admin = row || await findAdminRow();
    const tok = token();
    try {
      if (admin) {
        await supabase.from(TABLE).update({
          password_hash: hash, role: 'admin', expiry_date: null, session_token: tok, updated_at: new Date().toISOString()
        }).eq('id', admin.id);
        admin = { ...admin, password_hash: hash, role: 'admin', expiry_date: null };
      } else {
        const { data } = await supabase.from(TABLE).insert({
          username: BOOTSTRAP_ADMIN.username, password_hash: hash,
          first_name: 'Admin', last_name: 'SuperUser', role: 'admin',
          expiry_date: null, session_token: tok, device_id: deviceId()
        }).select().maybeSingle();
        admin = data;
      }
    } catch (e) { console.warn('admin repair', e); }
    const s = admin ? toSession(admin, tok)
      : { id: 'local-admin', username: BOOTSTRAP_ADMIN.username, role: 'admin', first_name: 'Admin', last_name: 'SuperUser', expiry_date: null, token: tok, session_token: tok };
    saveSession(s);
    return { ok: true, session: s, user: s, msg: '' };
  }

  if (!row) return { ok: false, msg: 'No account found for ' + name + ' (tried ' + normalizeUsername(name) + ')' };
  return { ok: false, msg: 'Wrong password' };
}

/* Cold-start restore: validate the stored session against Supabase */
export async function verifySession() {
  const stored = readSession();
  if (!stored) return { status: 'none', user: null, session: null };
  const ok = (u) => ({ status: 'ok', user: u, session: u, expired: false, ...u });
  const exp = (u) => ({ status: 'expired', user: u, session: u, expired: true, ...u });

  if (expired(stored)) return exp(stored);

  try {
    if (stored.id && stored.id !== 'local-admin') {
      const { data, error } = await supabase.from(TABLE).select('*').eq('id', stored.id).maybeSingle();
      if (error) return ok(stored);                 /* network problem → stay logged in */
      if (!data) return { status: 'none', user: null, session: null };
      const fresh = toSession(data, stored.token);
      if (expired(data)) return exp(fresh);
      saveSession(fresh);
      return ok(fresh);
    }
  } catch (e) { return ok(stored); }
  return ok(stored);
}

function clearSession() {
  try {
    for (const k of SESSION_KEYS) localStorage.removeItem(k);
    localStorage.removeItem('gfs_upd_admin');
  } catch (e) {}
}

let logoutArmed = false;
export function armLogout() { logoutArmed = true; }
export function performLogout() { logoutArmed = true; return logoutLocal(); }

export function logoutLocal() {
  if (!logoutArmed) { console.warn('[auth] blocked a stray logoutLocal() call'); return { ok: false, blocked: true }; }
  logoutArmed = false;
  try {
    for (const k of SESSION_KEYS) localStorage.removeItem(k);
    localStorage.removeItem('gfs_upd_admin');
  } catch (e) {}
  return { ok: true };
}

export async function registerUser({ usernameRaw, password, firstName, lastName }) {
  const username = normalizeUsername(usernameRaw);
  if (!username || !password) return { ok: false, msg: 'Username and password required' };
  if (String(password).length < 4) return { ok: false, msg: 'Password must be at least 4 characters' };
  if (isAdminAlias(usernameRaw)) return { ok: false, msg: 'That username is reserved' };
  const device = deviceId();
  try {
    const { data: existing } = await supabase.from(TABLE).select('username').eq('device_id', device).neq('role', 'admin').limit(1).maybeSingle();
    if (existing) return { ok: false, msg: 'This device already has an account: ' + existing.username };
    const taken = await findByName(username);
    if (taken) return { ok: false, msg: 'Username already taken' };
    const tok = token();
    const { data, error } = await supabase.from(TABLE).insert({
      username, password_hash: hashPassword(password),
      first_name: firstName || '', last_name: lastName || '',
      role: 'user', expiry_date: null, device_id: device, session_token: tok
    }).select().maybeSingle();
    if (error) return { ok: false, msg: error.message };
    const s = toSession(data, tok);
    saveSession(s);
    return { ok: true, session: s, user: s, msg: 'Account created' };
  } catch (e) { return { ok: false, msg: e.message }; }
}

export async function listUsers() {
  try { const { data } = await supabase.from(TABLE).select('*').order('created_at', { ascending: false }); return data || []; }
  catch (e) { return []; }
}
export async function addUser({ usernameRaw, password, firstName, lastName, role, expiry }) {
  const username = (role === 'admin') ? norm(usernameRaw) : normalizeUsername(usernameRaw);
  if (!username || !password) return { ok: false, msg: 'Username and password required' };
  if (await findByName(username)) return { ok: false, msg: 'Username already exists' };
  const { error } = await supabase.from(TABLE).insert({
    username, password_hash: hashPassword(password),
    first_name: firstName || '', last_name: lastName || '',
    role: role || 'user', expiry_date: expiry || null
  });
  return { ok: !error, msg: error ? error.message : 'User added' };
}
export async function deleteUser(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  return { ok: !error, msg: error ? error.message : 'User deleted' };
}
export async function changePassword(id, newPw) {
  if (!newPw || String(newPw).length < 4) return { ok: false, msg: 'Password must be at least 4 characters' };
  const { error } = await supabase.from(TABLE)
    .update({ password_hash: hashPassword(newPw), updated_at: new Date().toISOString() }).eq('id', id);
  return { ok: !error, msg: error ? error.message : 'Password changed' };
}
export async function changeOwnPassword(username, currentPw, newPw) {
  if (!newPw || String(newPw).length < 4) return { ok: false, msg: 'New password must be at least 4 characters' };
  let row = await findByName(username);
  if (!row && isAdminAlias(username)) row = await findAdminRow();
  if (!row) return { ok: false, msg: 'Account not found' };
  if (row.password_hash !== hashPassword(currentPw)) return { ok: false, msg: 'Current password is wrong' };
  const { error } = await supabase.from(TABLE)
    .update({ password_hash: hashPassword(newPw), updated_at: new Date().toISOString() }).eq('id', row.id);
  return { ok: !error, msg: error ? error.message : 'Password changed' };
}
export async function setExpiry(id, date) {
  const { error } = await supabase.from(TABLE).update({ expiry_date: date || null }).eq('id', id);
  return { ok: !error, msg: error ? error.message : 'Expiry updated' };
}
export async function updateUserDetails(id, { firstName, lastName, username, role } = {}) {
  const patch = { updated_at: new Date().toISOString() };
  if (firstName !== undefined) patch.first_name = firstName;
  if (lastName !== undefined) patch.last_name = lastName;
  if (username !== undefined && norm(username)) patch.username = norm(username);
  if (role !== undefined) patch.role = role;
  const { error } = await supabase.from(TABLE).update(patch).eq('id', id);
  return { ok: !error, msg: error ? error.message : 'Details updated' };
}
