DROP POLICY IF EXISTS "Utilisateurs voient leurs posts" ON posts;
DROP POLICY IF EXISTS "Utilisateurs créent posts" ON posts;
DROP POLICY IF EXISTS "Utilisateurs modifient leurs posts" ON posts;
DROP POLICY IF EXISTS "Utilisateurs suppriment leurs posts" ON posts;
DROP POLICY IF EXISTS "Utilisateurs voient leurs commentaires" ON comments;
DROP POLICY IF EXISTS "Utilisateurs créent commentaires" ON comments;
DROP POLICY IF EXISTS "Utilisateurs modifient leurs commentaires" ON comments;
DROP POLICY IF EXISTS "Utilisateurs suppriment leurs commentaires" ON comments;
DROP POLICY IF EXISTS "Utilisateurs créent réactions" ON post_reactions;
DROP POLICY IF EXISTS "Utilisateurs suppriment réactions" ON post_reactions;
DROP POLICY IF EXISTS "Utilisateurs créent likes" ON comment_likes;
DROP POLICY IF EXISTS "Utilisateurs suppriment likes" ON comment_likes;
DROP POLICY IF EXISTS "Utilisateurs voient leurs brouillons" ON drafts;
DROP POLICY IF EXISTS "Utilisateurs créent brouillons" ON drafts;
DROP POLICY IF EXISTS "Utilisateurs modifient brouillons" ON drafts;
DROP POLICY IF EXISTS "Utilisateurs suppriment brouillons" ON drafts;
 
CREATE POLICY "Permettre création sessions anonymes" ON anonymous_sessions
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Permettre lecture propre session" ON anonymous_sessions
    FOR SELECT USING (session_token = current_setting('request.headers->session_token', true));

CREATE POLICY "Permettre mise à jour propre session" ON anonymous_sessions
    FOR UPDATE USING (session_token = current_setting('request.headers->session_token', true));

-- POSTS: Politiques basées sur session_token dans les données
CREATE POLICY "Créer posts avec session_token" ON posts
    FOR INSERT WITH CHECK (session_token IS NOT NULL);

CREATE POLICY "Voir ses propres posts" ON posts
    FOR SELECT USING (
        status = 'published' 
        OR session_token = current_setting('request.headers->session_token', true)
    );

CREATE POLICY "Modifier ses posts" ON posts
    FOR UPDATE USING (session_token = current_setting('request.headers->session_token', true));

CREATE POLICY "Supprimer ses posts" ON posts
    FOR DELETE USING (session_token = current_setting('request.headers->session_token', true));

-- COMMENTS: Politiques similaires
CREATE POLICY "Créer commentaires avec session_token" ON comments
    FOR INSERT WITH CHECK (session_token IS NOT NULL);

CREATE POLICY "Voir ses commentaires" ON comments
    FOR SELECT USING (
        status = 'visible' 
        OR session_token = current_setting('request.headers->session_token', true)
    );

CREATE POLICY "Modifier ses commentaires" ON comments
    FOR UPDATE USING (session_token = current_setting('request.headers->session_token', true));

CREATE POLICY "Supprimer ses commentaires" ON comments
    FOR DELETE USING (session_token = current_setting('request.headers->session_token', true));

-- POST_REACTIONS: Permettre les réactions anonymes
CREATE POLICY "Créer réactions avec session_token" ON post_reactions
    FOR INSERT WITH CHECK (session_token IS NOT NULL);

CREATE POLICY "Supprimer ses réactions" ON post_reactions
    FOR DELETE USING (session_token = current_setting('request.headers->session_token', true));

-- COMMENT_LIKES: Permettre les likes anonymes
CREATE POLICY "Créer likes avec session_token" ON comment_likes
    FOR INSERT WITH CHECK (session_token IS NOT NULL);

CREATE POLICY "Supprimer ses likes" ON comment_likes
    FOR DELETE USING (session_token = current_setting('request.headers->session_token', true));

-- DRAFTS: Politiques pour brouillons
CREATE POLICY "Créer brouillons avec session_token" ON drafts
    FOR INSERT WITH CHECK (session_token IS NOT NULL);

CREATE POLICY "Voir ses brouillons" ON drafts
    FOR SELECT USING (session_token = current_setting('request.headers->session_token', true));

CREATE POLICY "Modifier ses brouillons" ON drafts
    FOR UPDATE USING (session_token = current_setting('request.headers->session_token', true));

CREATE POLICY "Supprimer ses brouillons" ON drafts
    FOR DELETE USING (session_token = current_setting('request.headers->session_token', true));
 
CREATE POLICY "Enregistrer vues" ON post_views
    FOR INSERT WITH CHECK (true);

-- =====================================================
-- ALTERNATIVE: DÉSACTIVER RLS POUR DÉVELOPPEMENT
-- =====================================================
-- Désactiver RLS sur TOUTES les tables
ALTER TABLE IF EXISTS anonymous_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS post_reactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS comment_likes DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS drafts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS post_views DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS post_moods DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS post_tags DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tags DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS draft_moods DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS draft_tags DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reaction_counts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS moods DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS reaction_types DISABLE ROW LEVEL SECURITY;

-- Vérifier que RLS est désactivé
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
 
