-- =====================================================
-- MIA DARLING — Identifiant public opaque pour les témoignages
-- =====================================================
-- Remplace l'ID séquentiel visible dans l'URL (post.html?id=16) par un
-- identifiant ALÉATOIRE non énumérable (post.html?p=<uuid>).
-- Les liens ne révèlent plus le numéro ni le nombre de publications.
--
-- À exécuter UNE FOIS dans Supabase > SQL Editor.
-- =====================================================

-- gen_random_uuid() vient de pgcrypto (déjà activé par schema.sql)
ALTER TABLE posts ADD COLUMN IF NOT EXISTS public_id UUID DEFAULT gen_random_uuid();

-- Renseigner les témoignages existants
UPDATE posts SET public_id = gen_random_uuid() WHERE public_id IS NULL;

-- Rendre obligatoire + unique
ALTER TABLE posts ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_public_id ON posts(public_id);

-- =====================================================
-- Fin. Les nouveaux témoignages reçoivent automatiquement un public_id.
-- =====================================================
