# Mia Darling - Plateforme de Témoignages Anonymes

Une plateforme web permettant aux utilisateurs de partager des témoignages de manière totalement anonyme, avec réactions, commentaires et gestion de brouillons.

## Structure du Projet

```
MiaDarlia/
|-- index.html              # Page d'accueil avec témoignages récents
|-- publier.html            # Page de publication de témoignages
|-- post.html               # Page de détail d'un témoignage
|-- mes-publications.html   # Page de gestion de ses publications
|-- shared.css              # Styles partagés
|-- js/
|   |-- supabase-config.js  # Configuration et API Supabase
|-- database/
    |-- schema.sql          # Schéma complet de la base de données
```

## Déploiement sur Supabase

### Étape 1 : Créer un projet Supabase

1. Allez sur [supabase.com](https://supabase.com)
2. Créez un nouveau projet
3. Notez l'URL du projet et la clé `anon`

### Étape 2 : Exécuter le schéma SQL

1. Dans votre projet Supabase, allez dans **SQL Editor**
2. Copiez le contenu de `database/schema.sql`
3. Exécutez le script pour créer toutes les tables

### Étape 3 : Configurer les clés API

Ouvrez `js/supabase-config.js` et remplacez :

```javascript
const SUPABASE_URL = 'https://yeawjdkyqjyjvpahlbmp.supabase.co';
const SUPABASE_ANON_KEY = 'VOTRE_ANON_KEY_ICI';
```

Pour trouver vos clés :
1. Dans Supabase, allez dans **Settings** > **API**
2. Copiez l'**URL** et la clé **anon public**

### Étape 4 : Configurer RLS (Row Level Security)

Le schéma SQL inclut déjà les politiques RLS. Assurez-vous qu'elles sont actives :

1. Dans Supabase, allez dans **Authentication** > **Policies**
2. Vérifiez que les politiques sont activées pour chaque table

### Étape 5 : Déployer le frontend

Vous pouvez déployer sur n'importe quel hébergeur statique :
- **Netlify** : Glissez-déposez le dossier
- **Vercel** : Connectez votre repo Git
- **GitHub Pages** : Activez dans les paramètres du repo

## Fonctionnalités

### Anonymat Garanti
- Aucune donnée personnelle stockée (pas d'email, nom, etc.)
- Sessions anonymes générées côté client
- Noms d'utilisateurs auto-générés (ex: "SilentVoyageur8634")

### Publications
- Création de témoignages (10-2000 caractères)
- Sélection d'humeurs (Triste, Épuisé, Anxieux, etc.)
- Ajout de tags (jusqu'à 5 par post)
- Sauvegarde automatique des brouillons

### Interactions
- Réactions emoji (cry, sad, heart)
- Commentaires avec réponses imbriquées
- Likes sur les commentaires
- Compteur de vues

### Gestion
- Liste de ses propres publications
- Filtrage (récents, populaires)
- Suppression de publications
- Statistiques personnelles

## Base de Données

### Tables Principales

| Table | Description |
|-------|-------------|
| `anonymous_sessions` | Sessions utilisateurs anonymes |
| `posts` | Témoignages publiés |
| `drafts` | Brouillons en cours |
| `comments` | Commentaires et réponses |
| `post_reactions` | Réactions sur les posts |
| `reaction_counts` | Compteurs agrégés |

### Sécurité

- **RLS activé** sur toutes les tables sensibles
- Les utilisateurs ne peuvent voir/modifier que leurs propres données
- Les posts publiés sont visibles par tous
- Les interactions sont liées aux sessions anonymes

## API JavaScript

L'API est accessible via `window.MiaDarling` :

```javascript
// Sessions
await MiaDarling.SessionManager.getOrCreateSession();

// Posts
await MiaDarling.PostsAPI.getRecent(20);
await MiaDarling.PostsAPI.create(content, moodIds, tagNames);
await MiaDarling.PostsAPI.delete(postId);

// Réactions
await MiaDarling.ReactionsAPI.toggle(postId, reactionTypeId);

// Commentaires
await MiaDarling.CommentsAPI.getForPost(postId);
await MiaDarling.CommentsAPI.create(postId, content, parentId);

// Brouillons
await MiaDarling.DraftsAPI.save(content, moodIds, tagIds);
await MiaDarling.DraftsAPI.getCurrent();

// Statistiques
await MiaDarling.StatsAPI.getGlobal();
await MiaDarling.StatsAPI.getMyStats();
```

## Développement Local

1. Clonez le projet
2. Ouvrez `index.html` dans un navigateur
3. Configurez vos clés Supabase dans `js/supabase-config.js`

Note : Certaines fonctionnalités nécessitent un serveur web pour fonctionner correctement (modules ES, cookies, etc.).

```bash
# Avec Python
python -m http.server 8000

# Avec Node.js
npx serve .
```

## Technologies Utilisées

- **Frontend** : HTML5, CSS3, JavaScript vanilla
- **Backend** : Supabase (PostgreSQL + Auth + API)
- **Styles** : CSS Variables, Glassmorphism
- **Animations** : CSS Transitions, Intersection Observer

## Licence

MIT - Utilisez librement pour vos projets.

---

Créé avec pour préserver l'anonymat et la sensibilité des témoignages.
