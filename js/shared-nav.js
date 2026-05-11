/**
 * Navigation partagée pour toutes les pages Mia Darling
 * Inclut la navbar avec le style uniforme
 */

// Styles de la navbar
const navStyles = `
  nav {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 72px;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 48px;
    z-index: 1000;
  }

  .nav-logo {
    display: flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
    transition: transform 0.2s ease;
  }

  .nav-logo:hover {
    transform: scale(1.02);
  }

  .nav-logo img {
    width: 42px;
    height: 42px;
    border-radius: 50%;
    box-shadow: 0 0 20px rgba(166, 108, 255, 0.4);
  }

  .nav-logo-text {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }

  .nav-logo .logo-m {
    font-family: 'Great Vibes', cursive;
    font-size: 26px;
    font-weight: 400;
    color: #FFFFFF;
    letter-spacing: 0.02em;
  }

  .nav-logo .logo-d {
    font-family: 'Great Vibes', cursive;
    font-size: 18px;
    font-weight: 400;
    color: #C29AFF;
    letter-spacing: 0.02em;
    margin-left: 2px;
  }

  .nav-links {
    display: flex;
    gap: 32px;
    list-style: none;
  }

  .nav-links a {
    color: rgba(255, 255, 255, 0.6);
    text-decoration: none;
    font-size: 14px;
    font-weight: 500;
    transition: color 0.2s;
  }

  .nav-links a:hover,
  .nav-links a.active {
    color: #A66CFF;
  }

  .nav-user {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .user-info {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .user-name {
    font-size: 14px;
    font-weight: 600;
    color: #FFFFFF;
  }

  .user-stats {
    font-size: 11px;
    color: rgba(255, 255, 255, 0.5);
  }

  .btn-logout {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .btn-logout:hover {
    background: rgba(255, 80, 80, 0.15);
    border-color: rgba(255, 80, 80, 0.3);
    color: #ff6b6b;
  }

  /* Responsive */
  @media (max-width: 900px) {
    nav {
      padding: 0 24px;
    }
    .nav-links {
      gap: 20px;
    }
  }

  @media (max-width: 700px) {
    .nav-links {
      display: none;
    }
    .user-stats {
      display: none;
    }
  }
`;

// HTML de la navbar
function getNavHTML(activePage = '') {
  const links = [
    { href: 'index.html', label: 'Accueil', id: 'accueil' },
    { href: 'groupes.html', label: 'Groupes', id: 'groupes' },
    { href: 'mes-publications.html', label: 'Mes publications', id: 'publications' }
  ];

  const linksHTML = links.map(l => 
    `<li><a href="${l.href}" class="${l.id === activePage ? 'active' : ''}">${l.label}</a></li>`
  ).join('\n      ');

  return `
  <nav>
    <a class="nav-logo" href="index.html">
      <img src="assets/logo.png" alt="Mia Darling">
      <span class="nav-logo-text">
        <span class="logo-m">Mia</span>
        <span class="logo-d">Darling</span>
      </span>
    </a>
    <ul class="nav-links">
      ${linksHTML}
    </ul>
    <div class="nav-user">
      <div class="user-info" id="userInfo">
        <span class="user-name" id="userName">Chargement...</span>
        <span class="user-stats" id="userStats"></span>
      </div>
      <button class="btn-logout" onclick="logout()" title="Changer de compte">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </div>
  </nav>`;
}

// Injecter les styles
function injectNavStyles() {
  const styleEl = document.createElement('style');
  styleEl.textContent = navStyles;
  document.head.appendChild(styleEl);
}

// Injecter la navbar
function injectNav(activePage = '') {
  // Injecter les styles si pas déjà fait
  if (!document.querySelector('style[data-nav-injected]')) {
    injectNavStyles();
    document.querySelector('style:last-of-type').setAttribute('data-nav-injected', 'true');
  }

  // Créer ou remplacer la navbar
  const existingNav = document.querySelector('nav');
  const navContainer = document.createElement('div');
  navContainer.innerHTML = getNavHTML(activePage);
  
  if (existingNav) {
    existingNav.replaceWith(navContainer.firstElementChild);
  } else {
    document.body.insertAdjacentElement('afterbegin', navContainer.firstElementChild);
  }
}

// Fonction de déconnexion
window.logout = function() {
  if (confirm('Se déconnecter ? Vous pourrez récupérer votre compte avec votre code de récupération.')) {
    localStorage.removeItem('mia_darling_session');
    localStorage.removeItem('mia_darling_recovery');
    window.location.href = 'welcome.html';
  }
};

// Initialiser la navbar avec les infos utilisateur
async function initNav(activePage = '') {
  injectNav(activePage);

  // Charger les infos utilisateur si MiaDarling est disponible
  if (window.MiaDarling) {
    const result = await MiaDarling.SessionManager.getOrCreateSession();
    if (result && result.session) {
      const userNameEl = document.getElementById('userName');
      const userStatsEl = document.getElementById('userStats');
      
      if (userNameEl) {
        userNameEl.textContent = result.session.anonymous_name || 'Anonyme';
      }
      
      if (userStatsEl && MiaDarling.StatsAPI) {
        MiaDarling.StatsAPI.getMyStats().then(stats => {
          if (userStatsEl) {
            userStatsEl.textContent = `${stats.postsCount} posts · ${stats.reactionsCount} réactions`;
          }
        });
      }
    }
  }
}

// Auto-initialisation
document.addEventListener('DOMContentLoaded', () => {
  // Détecter la page active depuis l'URL
  const path = window.location.pathname;
  let activePage = '';
  
  if (path.includes('index.html') || path.endsWith('/')) activePage = 'accueil';
  else if (path.includes('groupes.html')) activePage = 'groupes';
  else if (path.includes('mes-publications.html')) activePage = 'publications';
  
  // L'initialisation sera faite par la page elle-même si elle appelle initNav
});
