-- =====================================================
-- MIA DARLING — RLS QUI FONCTIONNE VRAIMENT
-- =====================================================
-- À exécuter UNE FOIS dans Supabase > SQL Editor.
--
-- POURQUOI CE FICHIER
-- -------------------
-- Toutes les anciennes policies comparaient le token à :
--     current_setting('request.jwt.claims->session_token', true)
--     current_setting('request.headers->session_token', true)
-- Ces deux noms de réglage N'EXISTENT PAS (PostgREST expose
-- "request.jwt.claims" et "request.headers", qui sont des chaînes JSON ;
-- la flèche "->" n'est pas interprétée dans un nom de setting).
-- Avec le 2e argument à `true`, current_setting() renvoie donc NULL,
-- et « colonne = NULL » vaut NULL, c'est-à-dire FAUX pour une policy.
-- => dès que le RLS est activé, TOUT est refusé silencieusement
--    (0 ligne, sans message d'erreur).
--
-- LE PRINCIPE ICI
-- ---------------
-- L'entrée dans l'app se fait UNIQUEMENT via Google (welcome.html), donc
-- auth.uid() existe toujours. On relie auth.uid() -> session_token via
-- user_identities (déjà créée par google-auth.sql). C'est my_token().
--
-- ATTENTION : l'étape 5 SUPPRIME TOUTES les policies du schéma public
-- avant de recréer le jeu complet. C'est voulu (les anciennes sont mortes).
-- =====================================================


-- =====================================================
-- 1. HELPER : le session_token de l'utilisateur connecté
-- =====================================================
-- SECURITY DEFINER est OBLIGATOIRE : la fonction lit anonymous_sessions,
-- table elle-même protégée par une policy qui appelle cette fonction.
-- Sans SECURITY DEFINER on aurait une récursion infinie de policy.
CREATE OR REPLACE FUNCTION public.my_token()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        (SELECT i.session_token FROM user_identities i
          WHERE i.auth_user_id = auth.uid() LIMIT 1),
        (SELECT s.session_token FROM anonymous_sessions s
          WHERE s.auth_user_id = auth.uid() LIMIT 1)
    );
$$;

GRANT EXECUTE ON FUNCTION public.my_token() TO anon, authenticated;


DROP VIEW IF EXISTS public.public_profiles;

CREATE OR REPLACE FUNCTION public.resolve_names(tokens TEXT[])
RETURNS TABLE (session_token TEXT, anonymous_name TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT s.session_token::TEXT, s.anonymous_name::TEXT
      FROM anonymous_sessions s
     WHERE s.session_token = ANY(tokens)
     LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_names(TEXT[]) TO anon, authenticated;


-- =====================================================
-- 3. STATS GLOBALES (compte TOUTES les lignes, hors RLS)
-- =====================================================
-- StatsAPI.getGlobal() faisait un COUNT sur anonymous_sessions.
-- Avec un RLS correct ce COUNT vaudrait 1 (la ligne de l'appelant).
-- On passe par une fonction SECURITY DEFINER qui ne renvoie que des nombres.
CREATE OR REPLACE FUNCTION public.get_global_stats()
RETURNS TABLE (posts_count BIGINT, active_sessions BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        (SELECT COUNT(*) FROM posts WHERE status = 'published'),
        (SELECT COUNT(*) FROM anonymous_sessions
          WHERE last_activity_at >= NOW() - INTERVAL '30 days');
$$;

GRANT EXECUTE ON FUNCTION public.get_global_stats() TO anon, authenticated;


-- =====================================================
-- 3 bis. SUIS-JE ADMIN ?
-- =====================================================
-- admin_users identifie un admin de DEUX facons selon le point d'entree :
-- par session_token (GroupsAPI.isAdmin cote front) ou par email
-- (is_active_admin() de google-auth.sql). On couvre les deux.
-- SECURITY DEFINER : sans ca, la policy de admin_users bloquerait la
-- lecture faite depuis cette fonction.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM admin_users a
         WHERE a.is_active = TRUE
           AND (a.session_token = my_token()
                OR a.email = (auth.jwt() ->> 'email'))
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;


-- =====================================================
-- 4. TRIGGERS : passage en SECURITY DEFINER
-- =====================================================
-- Les triggers de compteurs tournent avec les droits de l'appelant et
-- SUBISSENT donc le RLS. Exemple concret : quand A réagit au témoignage
-- de B, le trigger fait « UPDATE posts SET reactions_count... » sur une
-- ligne qui n'appartient pas à A -> 0 ligne modifiée, compteur figé,
-- AUCUNE erreur affichée. SECURITY DEFINER règle tous ces cas.
DO $$
DECLARE f TEXT;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'update_updated_at_column()',
        'update_reaction_counts()',
        'update_comments_count()',
        'update_posts_count()',
        'update_comment_likes_count()',
        'update_tag_usage()',
        'update_post_views()',
        'notify_post_reaction()',
        'notify_comment()',
        'notify_comment_like()',
        'notify_group_message()'
    ] LOOP
        BEGIN
            EXECUTE format('ALTER FUNCTION public.%s SECURITY DEFINER', f);
            EXECUTE format('ALTER FUNCTION public.%s SET search_path = public', f);
        EXCEPTION WHEN undefined_function THEN
            RAISE NOTICE 'Fonction absente, ignorée : %', f;
        END;
    END LOOP;
END $$;


-- =====================================================
-- 5. increment_view_count : mauvais type de paramètre
-- =====================================================
-- posts.id est BIGSERIAL, mais la fonction déclarait « post_id UUID ».
-- D'où le 400 Bad Request sur /rpc/increment_view_count.
DROP FUNCTION IF EXISTS public.increment_view_count(UUID);
DROP FUNCTION IF EXISTS public.update_reaction_count(UUID, INT, BOOLEAN);

CREATE OR REPLACE FUNCTION public.increment_view_count(post_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE posts
       SET views_count = COALESCE(views_count, 0) + 1
     WHERE id = post_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_view_count(BIGINT) TO anon, authenticated;


-- =====================================================
-- 6. NETTOYAGE : on supprime TOUTES les anciennes policies
-- =====================================================
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT schemaname, tablename, policyname
               FROM pg_policies WHERE schemaname = 'public'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                       r.policyname, r.schemaname, r.tablename);
    END LOOP;
END $$;


-- =====================================================
-- 7. POLICIES CORRECTES
-- =====================================================
-- Les fichiers SQL du dépôt ont divergé de la base réelle (ex : `groups`
-- utilise `status` et non `is_active`). On passe donc par un petit
-- assistant qui :
--   - ignore proprement une table absente,
--   - transforme une colonne absente en AVERTISSEMENT au lieu d'un abandon
--     de tout le script.
-- Surveillez les WARNING : une policy ignorée laisse la table sous-protégée
-- (voire sans RLS du tout si c'était sa seule policy). La requête de
-- vérification de la section 9 liste le RLS et le nombre de policies par
-- table : toute ligne à 0 policy est à traiter.
CREATE OR REPLACE FUNCTION pg_temp.pol(tbl TEXT, pname TEXT, body TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $fn$
BEGIN
    IF to_regclass('public.' || tbl) IS NULL THEN
        RAISE NOTICE 'Table absente, ignorée : %', tbl;
        RETURN;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pname, tbl);
    EXECUTE format('CREATE POLICY %I ON public.%I %s', pname, tbl, body);

EXCEPTION WHEN undefined_column THEN
    RAISE WARNING 'POLICY IGNOREE  %.% : %', tbl, pname, SQLERRM;
END;
$fn$;


-- ---------- anonymous_sessions ----------
-- Sa propre ligne uniquement. Les pseudos des autres passent par
-- resolve_names() (étape 2).
SELECT pg_temp.pol('anonymous_sessions', 'sessions_select_own', $p$
    FOR SELECT TO authenticated
    USING (auth_user_id = auth.uid() OR session_token = my_token())$p$);

-- 1re connexion Google : la ligne doit être liée au compte qui la crée.
SELECT pg_temp.pol('anonymous_sessions', 'sessions_insert_own', $p$
    FOR INSERT TO authenticated
    WITH CHECK (auth_user_id = auth.uid())$p$);

SELECT pg_temp.pol('anonymous_sessions', 'sessions_update_own', $p$
    FOR UPDATE TO authenticated
    USING (auth_user_id = auth.uid() OR session_token = my_token())
    WITH CHECK (auth_user_id = auth.uid() OR session_token = my_token())$p$);


-- ---------- user_identities (email/nom réels) ----------
SELECT pg_temp.pol('user_identities', 'identities_select', $p$
    FOR SELECT TO authenticated
    USING (auth_user_id = auth.uid())$p$);

SELECT pg_temp.pol('user_identities', 'identities_insert', $p$
    FOR INSERT TO authenticated
    WITH CHECK (auth_user_id = auth.uid())$p$);

SELECT pg_temp.pol('user_identities', 'identities_update', $p$
    FOR UPDATE TO authenticated
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid())$p$);


-- ---------- posts ----------
SELECT pg_temp.pol('posts', 'posts_select', $p$
    FOR SELECT TO anon, authenticated
    USING (status = 'published' OR session_token = my_token())$p$);

SELECT pg_temp.pol('posts', 'posts_insert_own', $p$
    FOR INSERT TO authenticated
    WITH CHECK (session_token = my_token())$p$);

SELECT pg_temp.pol('posts', 'posts_update_own', $p$
    FOR UPDATE TO authenticated
    USING (session_token = my_token())
    WITH CHECK (session_token = my_token())$p$);

SELECT pg_temp.pol('posts', 'posts_delete_own', $p$
    FOR DELETE TO authenticated
    USING (session_token = my_token())$p$);


-- ---------- comments ----------
SELECT pg_temp.pol('comments', 'comments_select', $p$
    FOR SELECT TO anon, authenticated
    USING (status = 'visible' OR session_token = my_token())$p$);

SELECT pg_temp.pol('comments', 'comments_insert_own', $p$
    FOR INSERT TO authenticated
    WITH CHECK (session_token = my_token())$p$);

SELECT pg_temp.pol('comments', 'comments_update_own', $p$
    FOR UPDATE TO authenticated
    USING (session_token = my_token())
    WITH CHECK (session_token = my_token())$p$);

SELECT pg_temp.pol('comments', 'comments_delete_own', $p$
    FOR DELETE TO authenticated
    USING (session_token = my_token())$p$);


-- ---------- post_reactions ----------
SELECT pg_temp.pol('post_reactions', 'reactions_select', $p$
    FOR SELECT TO anon, authenticated USING (true)$p$);

SELECT pg_temp.pol('post_reactions', 'reactions_insert_own', $p$
    FOR INSERT TO authenticated
    WITH CHECK (session_token = my_token())$p$);

SELECT pg_temp.pol('post_reactions', 'reactions_delete_own', $p$
    FOR DELETE TO authenticated
    USING (session_token = my_token())$p$);


-- ---------- comment_likes ----------
SELECT pg_temp.pol('comment_likes', 'likes_select', $p$
    FOR SELECT TO anon, authenticated USING (true)$p$);

SELECT pg_temp.pol('comment_likes', 'likes_insert_own', $p$
    FOR INSERT TO authenticated
    WITH CHECK (session_token = my_token())$p$);

SELECT pg_temp.pol('comment_likes', 'likes_delete_own', $p$
    FOR DELETE TO authenticated
    USING (session_token = my_token())$p$);


-- ---------- drafts ----------
SELECT pg_temp.pol('drafts', 'drafts_own', $p$
    FOR ALL TO authenticated
    USING (session_token = my_token())
    WITH CHECK (session_token = my_token())$p$);


-- ---------- tables de liaison ----------
-- post_moods / post_tags : lisibles par tous (elles décrivent des
-- témoignages publiés), écrivables seulement par l'auteur du témoignage.
SELECT pg_temp.pol('post_moods', 'post_moods_select', $p$
    FOR SELECT TO anon, authenticated USING (true)$p$);

SELECT pg_temp.pol('post_moods', 'post_moods_write', $p$
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM posts p
                    WHERE p.id = post_moods.post_id AND p.session_token = my_token()))
    WITH CHECK (EXISTS (SELECT 1 FROM posts p
                    WHERE p.id = post_moods.post_id AND p.session_token = my_token()))$p$);

SELECT pg_temp.pol('post_tags', 'post_tags_select', $p$
    FOR SELECT TO anon, authenticated USING (true)$p$);

SELECT pg_temp.pol('post_tags', 'post_tags_write', $p$
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM posts p
                    WHERE p.id = post_tags.post_id AND p.session_token = my_token()))
    WITH CHECK (EXISTS (SELECT 1 FROM posts p
                    WHERE p.id = post_tags.post_id AND p.session_token = my_token()))$p$);

SELECT pg_temp.pol('draft_moods', 'draft_moods_own', $p$
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM drafts d
                    WHERE d.id = draft_moods.draft_id AND d.session_token = my_token()))
    WITH CHECK (EXISTS (SELECT 1 FROM drafts d
                    WHERE d.id = draft_moods.draft_id AND d.session_token = my_token()))$p$);

SELECT pg_temp.pol('draft_tags', 'draft_tags_own', $p$
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM drafts d
                    WHERE d.id = draft_tags.draft_id AND d.session_token = my_token()))
    WITH CHECK (EXISTS (SELECT 1 FROM drafts d
                    WHERE d.id = draft_tags.draft_id AND d.session_token = my_token()))$p$);


-- ---------- données de référence ----------
SELECT pg_temp.pol('moods', 'moods_select', $p$
    FOR SELECT TO anon, authenticated USING (true)$p$);

SELECT pg_temp.pol('reaction_types', 'reaction_types_select', $p$
    FOR SELECT TO anon, authenticated USING (true)$p$);

-- reaction_counts : lecture seule côté client.
-- L'écriture passe par le trigger update_reaction_counts (SECURITY DEFINER).
SELECT pg_temp.pol('reaction_counts', 'reaction_counts_select', $p$
    FOR SELECT TO anon, authenticated USING (true)$p$);

-- tags : lecture publique + création (TagsAPI.getOrCreateTag).
-- Le compteur usage_count est mis à jour par un trigger, pas par le client.
SELECT pg_temp.pol('tags', 'tags_select', $p$
    FOR SELECT TO anon, authenticated USING (true)$p$);

SELECT pg_temp.pol('tags', 'tags_insert', $p$
    FOR INSERT TO authenticated WITH CHECK (true)$p$);


-- ---------- post_views ----------
-- On ne lit QUE ses propres vues (le client vérifie « ai-je déjà vu ce
-- témoignage ? »). Personne ne doit pouvoir lister qui a lu quoi.
SELECT pg_temp.pol('post_views', 'views_select_own', $p$
    FOR SELECT TO authenticated
    USING (session_token = my_token())$p$);

SELECT pg_temp.pol('post_views', 'views_insert_own', $p$
    FOR INSERT TO authenticated
    WITH CHECK (session_token = my_token())$p$);


-- ---------- notifications ----------
-- Avant : « notif_all FOR ALL USING (true) » => n'importe qui pouvait lire
-- les notifications de tout le monde. Ici : seulement les siennes.
-- Les triggers notify_* étant SECURITY DEFINER (étape 4), aucune policy
-- INSERT n'est nécessaire pour le client.
SELECT pg_temp.pol('notifications', 'notif_select_own', $p$
    FOR SELECT TO authenticated
    USING (recipient_token = my_token())$p$);

SELECT pg_temp.pol('notifications', 'notif_update_own', $p$
    FOR UPDATE TO authenticated
    USING (recipient_token = my_token())
    WITH CHECK (recipient_token = my_token())$p$);

SELECT pg_temp.pol('notifications', 'notif_delete_own', $p$
    FOR DELETE TO authenticated
    USING (recipient_token = my_token())$p$);


-- ---------- groupes ----------
-- Le drapeau « groupe actif » n'a pas le même nom selon la version du
-- schéma : `status = 'active'` dans la base actuelle, `is_active` dans
-- forum-anonymous-schema.sql. On détecte la colonne réellement présente.
DO $$
DECLARE pred TEXT;
BEGIN
    IF to_regclass('public.groups') IS NULL THEN
        RAISE NOTICE 'Table absente, ignorée : groups';
        RETURN;
    END IF;

    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'groups'
                        AND column_name = 'status')
            THEN $x$status = 'active'$x$
        WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'groups'
                        AND column_name = 'is_active')
            THEN 'is_active = TRUE'
        ELSE 'true'
    END INTO pred;

    RAISE NOTICE 'groups : predicat de visibilite = %', pred;

    PERFORM pg_temp.pol('groups', 'groups_select',
        format('FOR SELECT TO anon, authenticated USING (%s)', pred));
END $$;

-- Creation / archivage de groupe : admins uniquement
-- (GroupsAPI.create est branche sur le bouton « Nouveau groupe » de
--  groupes.html, visible seulement si isAdmin() est vrai).
SELECT pg_temp.pol('groups', 'groups_insert_admin', $p$
    FOR INSERT TO authenticated
    WITH CHECK (is_admin())$p$);

SELECT pg_temp.pol('groups', 'groups_update_admin', $p$
    FOR UPDATE TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin())$p$);

-- lecture ouverte : la liste des membres d'un groupe est affichée
SELECT pg_temp.pol('group_members', 'group_members_select', $p$
    FOR SELECT TO anon, authenticated USING (true)$p$);

SELECT pg_temp.pol('group_members', 'group_members_join', $p$
    FOR INSERT TO authenticated
    WITH CHECK (session_token = my_token())$p$);

-- « leave » pour soi-meme, exclusion d'un membre pour un admin
-- (GroupsAPI.adminBanMember).
SELECT pg_temp.pol('group_members', 'group_members_leave', $p$
    FOR DELETE TO authenticated
    USING (session_token = my_token() OR is_admin())$p$);

SELECT pg_temp.pol('group_messages', 'group_messages_select', $p$
    FOR SELECT TO anon, authenticated
    USING (status = 'visible' OR session_token = my_token())$p$);

SELECT pg_temp.pol('group_messages', 'group_messages_insert_own', $p$
    FOR INSERT TO authenticated
    WITH CHECK (session_token = my_token())$p$);

-- un admin peut masquer n'importe quel message (adminDeleteMessage)
SELECT pg_temp.pol('group_messages', 'group_messages_update_own', $p$
    FOR UPDATE TO authenticated
    USING (session_token = my_token() OR is_admin())
    WITH CHECK (session_token = my_token() OR is_admin())$p$);

SELECT pg_temp.pol('group_messages', 'group_messages_delete_own', $p$
    FOR DELETE TO authenticated
    USING (session_token = my_token())$p$);


-- ---------- admins ----------
-- L'app appelle GroupsAPI.isAdmin() : « suis-je admin ? ».
-- On ne laisse donc lire que sa propre ligne.
SELECT pg_temp.pol('admin_users', 'admins_select_own', $p$
    FOR SELECT TO authenticated
    USING (session_token = my_token()
           OR email = (auth.jwt() ->> 'email'))$p$);

SELECT pg_temp.pol('backoffice_admins', 'admins_select_own', $p$
    FOR SELECT TO authenticated
    USING (session_token = my_token())$p$);


-- ---------- tables purement internes ----------
-- RLS activé, AUCUNE policy => inaccessible depuis la clé anon.
-- C'est volontaire : seules les clés service_role / le SQL editor y accèdent.
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['moderation_logs', 'daily_stats', 'tag_stats'] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        END IF;
    END LOOP;
END $$;


-- =====================================================
-- 8. VUES DÉRIVÉES : respecter le RLS de l'appelant
-- =====================================================
-- posts_with_reactions & co exposent posts + anonymous_sessions.
-- security_invoker = true (PG 15+) les fait passer par les policies
-- ci-dessus au lieu des droits du propriétaire.
DO $$
DECLARE v TEXT;
BEGIN
    FOREACH v IN ARRAY ARRAY[
        'posts_with_reactions', 'popular_posts', 'recent_posts',
        'posts_with_author', 'comments_with_author',
        'group_messages_with_author', 'groups_with_stats'
    ] LOOP
        IF to_regclass('public.' || v) IS NOT NULL THEN
            BEGIN
                EXECUTE format('ALTER VIEW public.%I SET (security_invoker = true)', v);
            EXCEPTION WHEN OTHERS THEN
                -- security_invoker demande PostgreSQL 15+
                RAISE NOTICE 'security_invoker impossible sur la vue % : %', v, SQLERRM;
            END;
        END IF;
    END LOOP;
END $$;


-- =====================================================
-- 9. VÉRIFICATION
-- =====================================================
-- (a) Aucune table du schéma public ne doit rester sans RLS.
SELECT tablename,
       rowsecurity AS rls_active,
       (SELECT COUNT(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = t.tablename) AS nb_policies
  FROM pg_tables t
 WHERE schemaname = 'public'
 ORDER BY rowsecurity, tablename;

-- (b) Plus aucune policy ne doit contenir l'ancienne expression cassée.
SELECT tablename, policyname, qual
  FROM pg_policies
 WHERE schemaname = 'public'
   AND (qual LIKE '%request.jwt.claims->%' OR qual LIKE '%request.headers->%');
-- ^ doit renvoyer 0 ligne.

-- =====================================================
-- Fin.
-- =====================================================
