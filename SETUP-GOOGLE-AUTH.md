# Connexion Google — mise en place

La « clé d'accès » anonyme (code de récupération) est remplacée par **Google**.
Côté membres l'app reste **100 % anonyme** ; côté admin, le dashboard affiche
le **vrai nom + email** de chaque utilisateur.

Le code est prêt. Il reste **3 étapes manuelles** (impossibles depuis le code) :

---

## 1. Exécuter la migration SQL

Dans **Supabase → SQL Editor**, exécuter une fois :

```
MiaDarlia/database/google-auth.sql
```

Elle :
- ajoute `auth_user_id` à `anonymous_sessions` (lien vers le compte Google) ;
- crée la table **`user_identities`** (vrai email/nom), **protégée par RLS** :
  lisible uniquement par son propriétaire et par les admins ;
- crée la vue `admin_identities_view` (pseudo ↔ vraie identité).

> ⚠️ **Ne jamais désactiver le RLS sur `user_identities`.** Cette table contient
> les vrais emails : RLS off = emails lisibles par tout le monde via la clé
> publique = anonymat cassé.

---

## 2. Créer les identifiants OAuth Google

Dans **Google Cloud Console** (console.cloud.google.com) :

1. *APIs & Services → Credentials → Create credentials → OAuth client ID*.
2. Type : **Web application**.
3. **Authorized redirect URI** (exactement) :
   ```
   https://yeawjdkyqjyjvpahlbmp.supabase.co/auth/v1/callback
   ```
4. Récupérer le **Client ID** et le **Client Secret**.

(Si l'écran de consentement n'est pas configuré, le faire : *OAuth consent screen*,
type *External*, ajouter ton email en test users tant que l'app n'est pas publiée.)

---

## 3. Activer Google dans Supabase

Dans **Supabase → Authentication** :

1. **Providers → Google** : *Enable*, coller le **Client ID** + **Client Secret**, *Save*.
2. **URL Configuration** :
   - **Site URL** : l'URL où tu héberges le site (ex. `https://mon-site.com`
     ou `http://localhost:8000` en local).
   - **Redirect URLs** : ajouter l'URL de `welcome.html`, par ex. :
     ```
     http://localhost:8000/welcome.html
     https://mon-site.com/welcome.html
     ```

---

## ⚠️ Important : servir le site en HTTP(S)

La connexion Google **ne marche pas en `file://`** (double-clic sur le fichier).
Il faut servir le dossier. En local :

```bash
python -m http.server 8000 --directory MiaDarlia
# puis ouvrir http://localhost:8000/welcome.html
```

---

## Comment ça marche (résumé technique)

- `welcome.html` → bouton **Continuer avec Google** (`signInWithOAuth`).
- Au retour, `SessionManager.bindAuthUser()` :
  - retrouve l'identité anonyme liée au compte (table `user_identities`), **ou**
  - en crée une (nouveau `session_token` + pseudo) au 1er login, et stocke le
    vrai email/nom dans `user_identities`.
- Tout le reste de l'app continue d'utiliser `session_token` → **rien d'autre
  à changer**, l'affichage public reste anonyme.
- Le dashboard admin lit `user_identities` (autorisé par RLS pour les admins) et
  affiche le vrai nom + email partout : Témoignages, Commentaires, Sessions
  (colonnes *Vrai nom* / *Email* + recherche), Bannis et Discussions.

## Données existantes

Les sessions anonymes déjà créées (avant Google) restent en base mais ne sont
plus accessibles (plus de code de récupération). Les nouveaux utilisateurs
repartent d'une identité fraîche liée à leur compte Google.
