-- =====================================================
-- MIA DARLING - Migration "Connexion Google"
-- =====================================================
-- Objectif :
--   * Côté utilisateur : l'app reste 100% anonyme (on continue d'utiliser
--     session_token + anonymous_name partout).
--   * On lie chaque session anonyme à un compte Google (auth.users) pour
--     retrouver son identité sur n'importe quel appareil (remplace le code
--     de récupération).
--   * Les VRAIES identités (email + nom Google) sont stockées dans une table
--     SÉPARÉE et PROTÉGÉE (user_identities), lisible UNIQUEMENT par le
--     propriétaire et par les admins. La clé anon publique ne peut PAS la lire.
--
-- ⚠️ NE JAMAIS désactiver le RLS sur user_identities : ce serait exposer
--    publiquement les emails réels et casser l'anonymat de la plateforme.
--
-- À exécuter UNE FOIS dans l'éditeur SQL Supabase.
-- =====================================================


-- 1) Lier les sessions anonymes à un compte Google ------------------
ALTER TABLE anonymous_sessions
    ADD COLUMN IF NOT EXISTS auth_user_id UUID;

-- Un compte Google = une seule identité anonyme
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_auth_user
    ON anonymous_sessions(auth_user_id)
    WHERE auth_user_id IS NOT NULL;


-- 2) Table privée des vraies identités ------------------------------
CREATE TABLE IF NOT EXISTS user_identities (
    auth_user_id  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    session_token VARCHAR(64) NOT NULL,
    real_email    TEXT,
    real_name     TEXT,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at    TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_identity_session
        FOREIGN KEY (session_token)
        REFERENCES anonymous_sessions(session_token)
        ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_identities_session_token
    ON user_identities(session_token);
CREATE INDEX IF NOT EXISTS idx_identities_email
    ON user_identities(real_email);


-- 3) Sécurité : RLS strict sur user_identities ----------------------
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;

-- Helper : l'utilisateur courant (via Supabase Auth) est-il un admin actif ?
CREATE OR REPLACE FUNCTION is_active_admin()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM admin_users a
        WHERE a.email = (auth.jwt() ->> 'email')
          AND a.is_active = TRUE
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Lecture : le propriétaire voit la sienne, l'admin voit tout. Personne d'autre.
DROP POLICY IF EXISTS "identities_select" ON user_identities;
CREATE POLICY "identities_select" ON user_identities
    FOR SELECT
    USING (
        auth.uid() = auth_user_id
        OR is_active_admin()
    );

-- Création : uniquement sa propre ligne (au 1er login Google).
DROP POLICY IF EXISTS "identities_insert" ON user_identities;
CREATE POLICY "identities_insert" ON user_identities
    FOR INSERT
    WITH CHECK (auth.uid() = auth_user_id);

-- Mise à jour : sa propre ligne, ou un admin.
DROP POLICY IF EXISTS "identities_update" ON user_identities;
CREATE POLICY "identities_update" ON user_identities
    FOR UPDATE
    USING (auth.uid() = auth_user_id OR is_active_admin());


-- 4) Vue admin pratique : pseudo anonyme + vraie identité -----------
--    (security_invoker = true => respecte le RLS de l'appelant : seul un
--     admin connecté pourra en sortir les emails. Postgres 15+.)
DROP VIEW IF EXISTS admin_identities_view;
CREATE VIEW admin_identities_view
    WITH (security_invoker = true) AS
SELECT
    s.session_token,
    s.anonymous_name,
    s.posts_count,
    s.comments_count,
    s.is_banned,
    s.last_activity_at,
    s.created_at,
    i.real_name,
    i.real_email,
    i.avatar_url
FROM anonymous_sessions s
LEFT JOIN user_identities i ON i.session_token = s.session_token;

-- =====================================================
-- Fin de la migration.
-- Rappel des étapes Dashboard (hors SQL) :
--   Supabase > Authentication > Providers > Google : activer + Client ID/Secret
--   Supabase > Authentication > URL Configuration : Site URL + Redirect URLs
--   Google Cloud Console > OAuth : redirect =
--     https://<projet>.supabase.co/auth/v1/callback
-- =====================================================
