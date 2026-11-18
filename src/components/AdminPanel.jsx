import AdminUpdatesPanel from './AdminUpdatesPanel.jsx';
import { useState, useEffect } from 'react';
import {
  listUsers, addUser, deleteUser, changePassword, setExpiry, updateUserDetails
} from '../services/adminService.js';
import { getConversation, listAdminConversations, sendMessage } from '../services/messageService.js';

export default function AdminPanel() {
  const [updOpen, setUpdOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ u: '', p: '', f: '', l: '', exp: '', role: 'user' });
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [convMessages, setConvMessages] = useState([]);
  const [adminReplyText, setAdminReplyText] = useState('');

  useEffect(() => {
    listUsers().then(setUsers).catch(() => {});
    listAdminConversations('admin@scanprint.app').then(setConversations).catch(() => {});
  }, []);

  const refreshUsers = () => listUsers().then(setUsers).catch(() => {});

  const adminAdd = async () => {
    if (!newUser.u || !newUser.p) return alert('Username and password required');
    const r = await addUser({ usernameRaw: newUser.u, password: newUser.p, firstName: newUser.f, lastName: newUser.l, role: newUser.role || 'user', expiry: newUser.exp || null });
    if (!r.ok) alert(r.msg); else { setNewUser({ u: '', p: '', f: '', l: '', exp: '', role: 'user' }); refreshUsers(); }
  };

  const adminPw = async (u) => {
    const pw = prompt('New password for ' + u.username + ':');
    if (!pw) return;
    const r = await changePassword(u.id, pw);
    alert(r.ok ? 'Password changed.' : r.msg);
  };

  const adminDetails = async (u) => {
    const f = prompt('First name:', u.first_name || ''); if (f === null) return;
    const l = prompt('Last name:', u.last_name || ''); if (l === null) return;
    const r = await updateUserDetails(u.id, f.trim(), l.trim());
    if (r.ok) refreshUsers(); else alert(r.msg);
  };

  const adminExp = async (u) => {
    const d = prompt('Expiry (YYYY-MM-DD, empty = never):', u.expiry_date || '');
    if (d === null) return;
    const r = await setExpiry(u.id, d.trim() || null);
    if (r.ok) refreshUsers(); else alert(r.msg);
  };

  const adminDel = async (u) => {
    if (u.role === 'admin') return alert('Admin accounts are protected');
    if (!confirm('Delete ' + u.username + ' ?')) return;
    const r = await deleteUser(u.id);
    if (r.ok) refreshUsers(); else alert(r.msg);
  };

  const openConv = async (username) => {
    setActiveConv(username);
    const msgs = await getConversation('admin@scanprint.app', username);
    setConvMessages(msgs);
  };

  const sendAdminReply = async () => {
    if (!adminReplyText.trim() || !activeConv) return;
    const r = await sendMessage('admin@scanprint.app', activeConv, adminReplyText);
    if (r.ok) {
      setAdminReplyText('');
      const m = await getConversation('admin@scanprint.app', activeConv);
      setConvMessages(m);
      listAdminConversations('admin@scanprint.app').then(setConversations);
    } else alert(r.msg);
  };

  return (
    <div className="panel">
      <button className="upd-menu-chip" style={{ width: '100%', justifyContent: 'center', padding: '12px', marginBottom: '10px' }} onClick={() => setUpdOpen(true)}>📢 App Updates — publish APK / news</button>
      {updOpen && <AdminUpdatesPanel onClose={() => setUpdOpen(false)} />}
      <div className="glass-frame">
        <div className="logo-chip">🛡️</div>
        <div className="main-card">
          <div className="header"><h2>Admin Panel</h2></div>
          <div className="admin-form">
            <input className="admin-input" placeholder="New username" value={newUser.u} onChange={(e) => setNewUser({ ...newUser, u: e.target.value })} />
            <input className="admin-input" placeholder="Password" value={newUser.p} onChange={(e) => setNewUser({ ...newUser, p: e.target.value })} />
            <input className="admin-input" placeholder="First name" value={newUser.f} onChange={(e) => setNewUser({ ...newUser, f: e.target.value })} />
            <input className="admin-input" placeholder="Last name" value={newUser.l} onChange={(e) => setNewUser({ ...newUser, l: e.target.value })} />
            <input className="admin-input" type="date" value={newUser.exp} onChange={(e) => setNewUser({ ...newUser, exp: e.target.value })} />
            <select className="admin-input" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
              <option value="user">Role: User</option>
              <option value="admin">Role: Admin</option>
            </select>
            <button className="admin-btn add" onClick={adminAdd}>➕ Add User</button>
          </div>
          <h3 style={{ fontSize: '13px', color: '#6b7280', margin: '6px 0 10px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Users ({users.filter(u => u.role !== 'admin').length})
          </h3>
          {users.filter(u => u.role !== 'admin').map((u) => (
            <div key={u.id} className="admin-user">
              <div className="admin-user-top">
                <span className="admin-user-name">{u.username}</span>
                <span className={`role-badge ${u.role === 'admin' ? '' : 'user'}`}>{u.role}</span>
              </div>
              <div className="admin-user-meta">{u.first_name} {u.last_name} • Expiry: {u.expiry_date || 'Never'}</div>
              <div className="admin-actions">
                <button className="admin-btn pw" onClick={() => adminPw(u)}>🔑 Password</button>
                <button className="admin-btn expiry" onClick={() => adminDetails(u)}>✏️ Details</button>
                <button className="admin-btn expiry" onClick={() => adminExp(u)}>📅 Expiry</button>
                <button className="admin-btn del" onClick={() => adminDel(u)}>🗑 Delete</button>
                <button className="admin-btn msg" onClick={() => openConv(u.username)}>💬 Msg</button>
              </div>
            </div>
          ))}

          {activeConv && (
            <div className="msg-conv">
              <div className="msg-conv-head">
                <button className="msg-back" onClick={() => { setActiveConv(null); setConvMessages([]); }}>← Back</button>
                <span>{activeConv}</span>
              </div>
              <div className="msg-thread">
                {convMessages.length === 0 && <div className="msg-empty">No messages yet</div>}
                {convMessages.map((m) => (
                  <div key={m.id} className={`msg-bubble ${m.from_user === 'admin@scanprint.app' ? 'mine' : 'theirs'}`}>
                    <div className="msg-text">{m.message}</div>
                    <div className="msg-time">{new Date(m.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div className="msg-compose">
                <input className="msg-input" placeholder="Reply..." value={adminReplyText} onChange={(e) => setAdminReplyText(e.target.value)} />
                <button className="msg-send" onClick={sendAdminReply}>➤</button>
              </div>
            </div>
          )}

          <div className="swipe-hint">← Swipe to change section →</div>
        </div>
      </div>
    </div>
  );
}
