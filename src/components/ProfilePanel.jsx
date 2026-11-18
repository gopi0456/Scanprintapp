import { useState, useEffect } from 'react';
import { changeOwnPassword } from '../services/adminService.js';
import { performLogout } from '../services/authService.js';

export default function ProfilePanel({ session, isAdmin, setView, adminMsgs, setAdminMsgs, isExpiredSession, msgText, setMsgText, scrollToTab, panelCount }) {
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (session && !isAdmin) {
      getConversation(session.username, 'admin@scanprint.app').then(setAdminMsgs);
    }
  }, [session, isAdmin]);

  const initials = ((session.first_name || 'U')[0] + (session.last_name || '')[0]).toUpperCase();

  const doChangePw = async () => {
    if (!pwCurrent || !pwNew) return alert('Please fill both password fields');
    if (pwNew.length < 4) return alert('New password must be at least 4 characters');
    setIsLoading(true);
    const r = await changeOwnPassword(session.username, pwCurrent, pwNew);
    setIsLoading(false);
    if (r.ok) { alert('Password changed successfully'); setPwCurrent(''); setPwNew(''); }
    else alert(r.msg);
  };

  const doLogout = () => { performLogout(); setView('login'); };

  const sendUserMsg = async () => {
    if (!msgText.trim()) return;
    const r = await sendMessage(session.username, 'admin@scanprint.app', msgText);
    if (r.ok) {
      setMsgText('');
      const m = await getConversation(session.username, 'admin@scanprint.app');
      setAdminMsgs(m);
    } else alert(r.msg);
  };

  const disabledOverlay = (isExpiredSession && !isAdmin) ? (
    <div className="disabled-overlay">
      <div className="disabled-card">
        <div className="disabled-icon">🔒</div>
        <div className="disabled-title">Account Expired</div>
        <div className="disabled-text">
          Your trial ended on <b>{session.expiry_date || '—'}</b>.<br />
          All features are locked until renewed.<br />
          Send a message to your admin below.
        </div>
        <button className="auth-btn" onClick={() => scrollToTab(panelCount - 1)}>💬 Contact Admin</button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="panel">
        <div className="glass-frame">
          <div className="logo-chip">👤</div>
          <div className="main-card">
            <div className="header"><h2>My Profile</h2></div>
            <div className="profile-card">
              <div className="profile-avatar">{initials}</div>
              <div className="profile-name">{session.first_name || ''} {session.last_name || ''}</div>
              <div className="profile-user">{session.username}</div>
            </div>
            <div className="profile-fields">
              <input className="admin-input" type="password" placeholder="Current password" value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} />
              <input className="admin-input" type="password" placeholder="New password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
            </div>
            <button className="print-btn active" onClick={doChangePw}>🔑 Change Password</button>
            <button className="print-btn" style={{ marginTop: '12px', color: '#dc2626', background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)', cursor: 'pointer' }} onClick={doLogout}>
              🚪 Logout
            </button>
            <div style={{ marginTop: '22px' }} className="header"><h2>Message to Admin</h2></div>
            <div className="msg-thread">
              {adminMsgs.length === 0 && <div className="msg-empty">No messages yet. Send your first message below.</div>}
              {adminMsgs.map((m) => (
                <div key={m.id} className={`msg-bubble ${m.from_user === session.username ? 'mine' : 'theirs'}`}>
                  <div className="msg-label">{m.from_user === session.username ? 'You' : 'Admin'}</div>
                  <div className="msg-text">{m.message}</div>
                  <div className="msg-time">{new Date(m.created_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
            <div className="msg-compose">
              <input className="msg-input" placeholder={isExpiredSession ? 'Ask admin to restore your account...' : 'Message admin...'} value={msgText} onChange={(e) => setMsgText(e.target.value)} />
              <button className="msg-send" onClick={sendUserMsg}>➤</button>
            </div>
            <div className="swipe-hint">← Swipe to change section →</div>
          </div>
        </div>
      </div>
      {disabledOverlay}
    </>
  );
}
