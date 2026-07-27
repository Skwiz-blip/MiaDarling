/**
 * Badge de notifications non lues.
 * Ajoute une pastille avec le nombre de notifications non lues à côté du
 * lien "Notifications" de la barre de navigation (et de son équivalent dans
 * le menu mobile). À inclure APRÈS supabase-config.js et mobile-nav.js.
 */
(function () {
  function addBadge(count) {
    if (!count) return;
    document.querySelectorAll('a[href="notifications.html"]').forEach(a => {
      if (a.querySelector('.nav-notif-badge')) return;
      const b = document.createElement('span');
      b.className = 'nav-notif-badge';
      b.textContent = count > 9 ? '9+' : String(count);
      b.style.cssText =
        'display:inline-flex;align-items:center;justify-content:center;' +
        'min-width:17px;height:17px;padding:0 5px;margin-left:7px;' +
        'font-size:10px;font-weight:700;line-height:1;color:#fff;' +
        'background:#ff4d6d;border-radius:10px;vertical-align:middle;';
      a.appendChild(b);
    });
  }

  async function run(tries) {
    tries = tries || 0;
    const M = window.MiaDarling;
    if (!(M && M.NotificationsAPI && M.SessionManager)) {
      if (tries < 40) return setTimeout(() => run(tries + 1), 150);
      return;
    }
    if (!M.SessionManager.getToken()) return; // pas connecté
    try {
      const c = await M.NotificationsAPI.unreadCount();
      addBadge(c);
    } catch (e) { /* silencieux */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => run());
  } else {
    run();
  }
})();
