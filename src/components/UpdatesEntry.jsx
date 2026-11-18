import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import UpdateBanner from './UpdateBanner.jsx';
import AdminUpdatesPanel from './AdminUpdatesPanel.jsx';

const hashWants = () => /#(updates|admin-updates)/i.test(location.hash) || /[?&]updates=1/.test(location.search);
export function isAdminNow() { try { return localStorage.getItem('gfs_upd_admin') === '1'; } catch (e) { return false; } }

export default function UpdatesEntry({ isAdmin }) {
  const [open, setOpen] = useState(() => hashWants());
  const admin = isAdmin === undefined ? isAdminNow() : !!isAdmin;

  useEffect(() => {
    if (isAdmin) { try { localStorage.setItem('gfs_upd_admin', '1'); } catch (e) {} }
    const onHash = () => { if (hashWants()) setOpen(true); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [isAdmin]);

  return (
    <>
      <UpdateBanner />
      {admin && !open && createPortal(
        <button className="upx-fab" onClick={() => setOpen(true)} aria-label="App updates">📢</button>,
        document.body
      )}
      {open && <AdminUpdatesPanel onClose={() => setOpen(false)} />}
    </>
  );
}
