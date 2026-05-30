/**
 * Menu de navigation mobile partagé pour Mia Darling.
 *
 * Sur mobile (<= 768px), les liens de la navbar (.nav-links) sont masqués.
 * Ce script injecte un bouton hamburger (visible uniquement sur mobile) qui
 * ouvre un panneau latéral (drawer) reprenant automatiquement les liens de la
 * navbar de la page + un bouton de déconnexion.
 *
 * Il suffit d'inclure ce fichier sur n'importe quelle page possédant une <nav>
 * avec une liste .nav-links :
 *   <script src="js/mobile-nav.js"></script>
 */
(function () {
  const css = `
    .mobile-menu-btn {
      display: none;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: transparent;
      border: none;
      color: rgba(255, 255, 255, 0.8);
      cursor: pointer;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }
    .mobile-menu-btn:hover {
      background: rgba(255, 255, 255, 0.1);
      color: #fff;
    }

    .mnav-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.55);
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.3s ease;
      z-index: 1990;
    }
    .mnav-overlay.active {
      opacity: 1;
      visibility: visible;
    }

    .mnav-drawer {
      position: fixed;
      top: 0;
      left: 0;
      width: 280px;
      max-width: 82%;
      height: 100vh;
      height: 100dvh;
      background: #000000;
      border-right: 1px solid rgba(255, 255, 255, 0.08);
      z-index: 2000;
      transform: translateX(-100%);
      transition: transform 0.3s ease;
      display: flex;
      flex-direction: column;
    }
    .mnav-drawer.active {
      transform: translateX(0);
    }

    .mnav-header {
      padding: 20px;
      background: #000000;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .mnav-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
    }
    .mnav-logo img {
      width: 36px;
      height: 36px;
      border-radius: 50%;
    }
    .mnav-logo span {
      font-family: 'Great Vibes', cursive;
      font-size: 1.4rem;
      color: #fff;
    }
    .mnav-logo span b {
      color: #C29AFF;
      font-weight: 400;
    }
    .mnav-close {
      width: 36px;
      height: 36px;
      border: none;
      background: transparent;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .mnav-close:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
    }

    .mnav-links {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px;
      flex: 1;
      overflow-y: auto;
    }
    .mnav-links a {
      padding: 14px 16px;
      border-radius: 12px;
      color: rgba(255, 255, 255, 0.7);
      text-decoration: none;
      font-size: 15px;
      font-weight: 500;
      transition: all 0.15s;
    }
    .mnav-links a:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #fff;
    }
    .mnav-links a.active {
      background: rgba(166, 108, 255, 0.15);
      color: #C29AFF;
    }

    .mnav-footer {
      padding: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }
    .mnav-logout {
      width: 100%;
      padding: 14px;
      border-radius: 12px;
      background: rgba(255, 80, 80, 0.1);
      border: 1px solid rgba(255, 80, 80, 0.2);
      color: #ff6b6b;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .mnav-logout:hover {
      background: rgba(255, 80, 80, 0.2);
    }

    @media (max-width: 768px) {
      .mobile-menu-btn {
        display: flex;
        margin-right: 10px;
      }
      /* Garde le logo collé au bouton à gauche, le reste poussé à droite */
      nav .nav-logo {
        margin-right: auto;
      }
    }
  `;

  function init() {
    const nav = document.querySelector('nav');
    // Pas de navbar, ou drawer déjà injecté -> on ne fait rien
    if (!nav || document.querySelector('.mnav-drawer')) return;

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // Définit une déconnexion par défaut si la page n'en fournit pas.
    // (corrige aussi les boutons "Déconnexion" des pages qui appellent
    //  logout() sans l'avoir défini)
    if (typeof window.logout !== 'function') {
      window.logout = function () {
        if (confirm('Se déconnecter ?')) {
          localStorage.removeItem('mia_darling_session');
          localStorage.removeItem('mia_darling_recovery');
          window.location.href = 'welcome.html';
        }
      };
    }

    // Reprendre les liens existants de la navbar
    let linksHTML = '';
    nav.querySelectorAll('.nav-links a').forEach(a => {
      const active = a.classList.contains('active') ? ' class="active"' : '';
      linksHTML += `<a href="${a.getAttribute('href')}"${active}>${a.textContent.trim()}</a>`;
    });
    // Repli si la page n'a pas de .nav-links
    if (!linksHTML) {
      linksHTML =
        '<a href="index.html">Accueil</a>' +
        '<a href="groupes.html">Groupes</a>' +
        '<a href="recents.html">Explorer</a>' +
        '<a href="mes-publications.html">Mes publications</a>';
    }

    const overlay = document.createElement('div');
    overlay.className = 'mnav-overlay';

    const drawer = document.createElement('nav');
    drawer.className = 'mnav-drawer';
    drawer.setAttribute('aria-label', 'Navigation');
    drawer.innerHTML =
      '<div class="mnav-header">' +
        '<a class="mnav-logo" href="index.html">' +
          '<img src="assets/logo.png" alt="Mia Darling">' +
          '<span>Mia <b>Darling</b></span>' +
        '</a>' +
        '<button class="mnav-close" type="button" aria-label="Fermer">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="mnav-links">' + linksHTML + '</div>' +
      '<div class="mnav-footer">' +
        '<button class="mnav-logout" type="button">' +
          '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
          'Déconnexion' +
        '</button>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    // Bouton hamburger (placé à droite, à côté de la déconnexion ou en tête de nav)
    const btn = document.createElement('button');
    btn.className = 'mobile-menu-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Ouvrir le menu');
    btn.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';

    // Bouton à gauche : tout premier élément de la navbar
    nav.insertBefore(btn, nav.firstChild);

    const open = () => {
      drawer.classList.add('active');
      overlay.classList.add('active');
    };
    const close = () => {
      drawer.classList.remove('active');
      overlay.classList.remove('active');
    };

    btn.addEventListener('click', open);
    overlay.addEventListener('click', close);
    drawer.querySelector('.mnav-close').addEventListener('click', close);
    drawer.querySelector('.mnav-logout').addEventListener('click', () => window.logout());
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
