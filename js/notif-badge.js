/**
 * Badge de notifications non lues (temps réel).
 * Ajoute/maj une pastille avec le nombre de notifications non lues à côté du
 * lien "Notifications" de la barre de navigation. Se met à jour tout seul via
 * Supabase Realtime dès qu'une nouvelle notification arrive.
 * À inclure APRÈS supabase-config.js et mobile-nav.js.
 */
(function () {
  const BADGE_CSS =
    'display:inline-flex;align-items:center;justify-content:center;' +
    'min-width:17px;height:17px;padding:0 5px;margin-left:7px;' +
    'font-size:10px;font-weight:700;line-height:1;color:#fff;' +
    'background:#ff4d6d;border-radius:10px;vertical-align:middle;';

  // Crée / met à jour / retire la pastille sur tous les liens "Notifications"
  function setBadge(count) {
    document.querySelectorAll('a[href="notifications.html"]').forEach(a => {
      let b = a.querySelector('.nav-notif-badge');
      if (!count) { if (b) b.remove(); return; }
      if (!b) {
        b = document.createElement('span');
        b.className = 'nav-notif-badge';
        b.style.cssText = BADGE_CSS;
        a.appendChild(b);
      }
      b.textContent = count > 9 ? '9+' : String(count);
    });
  }

  async function refresh() {
    try {
      const c = await window.MiaDarling.NotificationsAPI.unreadCount();
      setBadge(c);
    } catch (e) { /* silencieux */ }
  }

  function subscribeRealtime(token) {
    const sb = window.MiaDarling.getSupabase();
    if (!sb || !token) return;
    sb.channel('notif-badge-' + token)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: 'recipient_token=eq.' + token
      }, () => { refresh(); })
      .subscribe();
  }

  async function run(tries) {
    tries = tries || 0;
    const M = window.MiaDarling;
    if (!(M && M.NotificationsAPI && M.SessionManager)) {
      if (tries < 40) return setTimeout(() => run(tries + 1), 150);
      return;
    }
    const token = M.SessionManager.getToken();
    if (!token) return; // pas connecté

    // Exposé pour que d'autres pages (ex: notifications.html) puissent
    // rafraîchir la pastille après "tout marquer comme lu".
    window.MiaNotifBadge = { refresh, setBadge };

    await refresh();
    subscribeRealtime(token);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => run());
  } else {
    run();
  }
})();
