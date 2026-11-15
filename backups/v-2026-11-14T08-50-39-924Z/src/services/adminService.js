import { supabase, TABLE } from '../supabaseClient.js';
import { hashPassword } from './authService.js';

export async function listUsers() {
  const { data, error } = await supabase.from(TABLE)
    .select('id,username,first_name,last_name,role,expiry_date,device_id,created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addUser({ usernameRaw, password, firstName, lastName, role, expiry }) {
  const username = usernameRaw.trim().toLowerCase().split('@')[0] + '@scanprint.app';
  const { error } = await supabase.from(TABLE).insert({
    username, password_hash: hashPassword(password),
    first_name: firstName || '', last_name: lastName || '',
    role: role || 'user', expiry_date: expiry || null
  });
  return { ok: !error, msg: error && error.message };
}

export async function deleteUser(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  return { ok: !error, msg: error && error.message };
}

export async function changePassword(id, newPw) {
  const { error } = await supabase.from(TABLE).update({ password_hash: hashPassword(newPw), session_token: null }).eq('id', id);
  return { ok: !error, msg: error && error.message };
}

export async function setExpiry(id, dateOrNull) {
  const { error } = await supabase.from(TABLE).update({ expiry_date: dateOrNull, updated_at: new Date().toISOString() }).eq('id', id);
  return { ok: !error, msg: error && error.message };
}

export async function updateUserDetails(id, firstName, lastName) {
  const { error } = await supabase.from(TABLE).update({ first_name: firstName, last_name: lastName, updated_at: new Date().toISOString() }).eq('id', id);
  return { ok: !error, msg: error && error.message };
}

export async function changeOwnPassword(username, currentPw, newPw) {
  const { data } = await supabase.from(TABLE).select('*').eq('username', username).maybeSingle();
  if (!data) return { ok: false, msg: 'User not found' };
  if (data.password_hash !== hashPassword(currentPw)) return { ok: false, msg: 'Current password is wrong' };
  const { error } = await supabase.from(TABLE).update({ password_hash: hashPassword(newPw), updated_at: new Date().toISOString() }).eq('id', data.id);
  return { ok: !error, msg: error && error.message };
}
