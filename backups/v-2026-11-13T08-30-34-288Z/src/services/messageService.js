import { supabase } from '../supabaseClient.js';
const MSG = 'scanprintmessage';

export async function sendMessage(fromUser, toUser, text) {
  if (!text.trim()) return { ok: false, msg: 'Empty message' };
  const { error } = await supabase.from(MSG).insert({ from_user: fromUser, to_user: toUser, message: text.trim() });
  return { ok: !error, msg: error && error.message };
}

export async function getConversation(userA, userB) {
  const { data } = await supabase.from(MSG)
    .select('id,from_user,to_user,message,created_at')
    .or(`and(from_user.eq.${userA},to_user.eq.${userB}),and(from_user.eq.${userB},to_user.eq.${userA})`)
    .order('created_at', { ascending: true });
  return data || [];
}

export async function listAdminConversations(adminUser) {
  const { data } = await supabase.from(MSG).select('from_user,to_user,created_at').order('created_at', { ascending: false });
  if (!data) return [];
  const seen = new Set(); const users = [];
  for (const m of data) {
    const other = m.from_user === adminUser ? m.to_user : m.from_user;
    if (other !== adminUser && !seen.has(other)) { seen.add(other); users.push({ username: other, lastAt: m.created_at }); }
  }
  return users;
}

// ---- Unread notification helpers ----
function lastReadKey(me) { return 'scanprint_lastread_' + me; }
export function getLastRead(me) { return localStorage.getItem(lastReadKey(me)) || '1970-01-01T00:00:00Z'; }
export function markRead(me) { const now = new Date().toISOString(); localStorage.setItem(lastReadKey(me), now); return now; }
export async function getUnreadCount(me) {
  const since = getLastRead(me);
  const { count } = await supabase.from(MSG).select('id', { count: 'exact', head: true }).eq('to_user', me).gt('created_at', since);
  return count || 0;
}
