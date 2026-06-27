-- =====================================================
-- MIA DARLING — Réinitialiser les données ("à neuf")
-- =====================================================
-- Vide TOUTES les données utilisateur et remet les compteurs à zéro,
-- SANS toucher à la structure ni à tes accès admin.
--
-- ✅ SUPPRIME :
--    témoignages, commentaires, réactions, likes, brouillons, vues,
--    sessions anonymes, identités Google (user_identities),
--    messages de groupe, membres de groupe, logs & stats.
--
-- ✅ CONSERVE :
--    - la structure (tables, RLS, fonctions, triggers)
--    - les données de référence : moods, reaction_types, tags (compteurs remis à 0)
--    - les administrateurs (admin_users) ET leurs comptes de connexion (auth.users)
--    - les groupes (leurs messages/membres sont vidés, le groupe reste)
--
-- ⚠️ IRRÉVERSIBLE. Sauvegarde d'abord si besoin :
--    Supabase > Database > Backups.
-- À exécuter dans Supabase > SQL Editor.
-- =====================================================

DO $$
DECLARE
    t text;
    -- Tables à vider (uniquement si elles existent dans ta base)
    tables text[] := ARRAY[
        'user_identities',
        'anonymous_sessions',   -- CASCADE => vide posts, comments, réactions,
                                --            drafts, vues, likes, post_tags…
        'group_members',
        'group_messages',
        'moderation_logs',
        'daily_stats',
        'tag_stats'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        IF to_regclass(t) IS NOT NULL THEN
            EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
            RAISE NOTICE 'Vidée : %', t;
        END IF;
    END LOOP;
END $$;

-- Remettre les compteurs de référence à zéro
UPDATE tags   SET usage_count = 0, is_trending = FALSE WHERE TRUE;
UPDATE groups SET members_count = 0, messages_count = 0 WHERE TRUE;

-- =====================================================
-- OPTIONS (décommente si tu veux aller plus loin)
-- =====================================================

-- (A) Supprimer AUSSI les groupes eux-mêmes (l'admin les recréera) :
-- TRUNCATE TABLE groups RESTART IDENTITY CASCADE;

-- (B) Supprimer les comptes Google des UTILISATEURS finaux, en gardant les
--     comptes administrateurs (sinon tu ne pourrais plus te connecter au
--     back-office). À n'exécuter que si tu veux vraiment repartir de zéro
--     côté authentification :
-- DELETE FROM auth.users
-- WHERE email IS NULL
--    OR email NOT IN (SELECT email FROM admin_users WHERE is_active = TRUE);

-- =====================================================
-- Fin. Ta base est repartie à neuf.
-- =====================================================
