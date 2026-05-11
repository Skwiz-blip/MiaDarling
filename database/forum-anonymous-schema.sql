CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
 

CREATE TABLE anonymous_sessions (
    session_token VARCHAR(64) PRIMARY KEY,
    anonymous_name VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    
    -- Compteurs pour détection de spam
    posts_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0
);

CREATE INDEX idx_sessions_last_activity ON anonymous_sessions(last_activity_at DESC);
CREATE INDEX idx_sessions_banned ON anonymous_sessions(is_banned) WHERE is_banned = TRUE;

CREATE TABLE posts (
    id BIGSERIAL PRIMARY KEY,
    session_token VARCHAR(64) NOT NULL,
    
    -- Contenu (anciennement thread.title + premier message)
    content TEXT NOT NULL CHECK (LENGTH(content) >= 10 AND LENGTH(content) <= 2000),
    
    -- Métadonnées
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_edited BOOLEAN DEFAULT FALSE,
    
    -- Statut
    status VARCHAR(20) DEFAULT 'published' CHECK (status IN ('draft', 'published', 'hidden', 'deleted')),
    
    -- Statistiques (dénormalisées pour performance)
    views_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    reactions_count INTEGER DEFAULT 0,
    
    -- Recherche full-text
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('french', content)) STORED,
    
    CONSTRAINT fk_post_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token) ON DELETE CASCADE
);

CREATE INDEX idx_posts_created_at ON posts(created_at DESC) WHERE status = 'published';
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_session ON posts(session_token);
CREATE INDEX idx_posts_search ON posts USING GIN(search_vector);
CREATE INDEX idx_posts_popular ON posts(reactions_count DESC, views_count DESC) WHERE status = 'published';

-- =====================================================
-- 3. COMMENTS (anciennement "messages")
-- =====================================================
-- Messages dans les fils, avec support des réponses imbriquées

CREATE TABLE comments (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL,
    parent_comment_id BIGINT,  -- Pour les réponses imbriquées
    session_token VARCHAR(64) NOT NULL,
    
    content TEXT NOT NULL CHECK (LENGTH(content) >= 1 AND LENGTH(content) <= 1000),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_edited BOOLEAN DEFAULT FALSE,
    
    status VARCHAR(20) DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
    
    -- Statistiques
    likes_count INTEGER DEFAULT 0,
    
    CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_parent FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token)
);

CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX idx_comments_session ON comments(session_token);

-- =====================================================
-- 4. RÉACTIONS EMOJI
-- =====================================================

CREATE TABLE reaction_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    emoji VARCHAR(10) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- Réactions initiales (😢 😔 ❤️)
INSERT INTO reaction_types (name, emoji, sort_order) VALUES
('cry', '😢', 1),
('sad', '😔', 2),
('heart', '❤️', 3);

CREATE TABLE post_reactions (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL,
    reaction_type_id INTEGER NOT NULL,
    session_token VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT unique_post_reaction UNIQUE (post_id, reaction_type_id, session_token),
    CONSTRAINT fk_post_reactions_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_post_reactions_type FOREIGN KEY (reaction_type_id) REFERENCES reaction_types(id),
    CONSTRAINT fk_post_reactions_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token)
);

CREATE INDEX idx_post_reactions_post ON post_reactions(post_id);

-- Compteurs agrégés (mis à jour par trigger)
CREATE TABLE reaction_counts (
    post_id BIGINT NOT NULL,
    reaction_type_id INTEGER NOT NULL,
    count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, reaction_type_id),
    CONSTRAINT fk_reaction_counts_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_reaction_counts_type FOREIGN KEY (reaction_type_id) REFERENCES reaction_types(id)
);

-- =====================================================
-- 5. LIKES SUR COMMENTAIRES
-- =====================================================

CREATE TABLE comment_likes (
    comment_id BIGINT NOT NULL,
    session_token VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (comment_id, session_token),
    CONSTRAINT fk_comment_likes_comment FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    CONSTRAINT fk_comment_likes_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token)
);

-- =====================================================
-- 6. BROUILLONS AUTO-SAUVEGARDÉS
-- =====================================================

CREATE TABLE drafts (
    id BIGSERIAL PRIMARY KEY,
    session_token VARCHAR(64) NOT NULL,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    auto_saved_at TIMESTAMPTZ,
    
    CONSTRAINT unique_draft_session UNIQUE (session_token),
    CONSTRAINT fk_drafts_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token) ON DELETE CASCADE
);

-- =====================================================
-- 7. VUES DES POSTS
-- =====================================================

CREATE TABLE post_views (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL,
    session_token VARCHAR(64),
    viewed_at TIMESTAMPTZ DEFAULT NOW(),
    
    CONSTRAINT fk_post_views_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_post_views_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token)
);

CREATE INDEX idx_post_views_post ON post_views(post_id);

-- =====================================================
-- 8. FONCTIONS ET TRIGGERS
-- =====================================================

-- Fonction pour générer un nom anonyme
CREATE OR REPLACE FUNCTION generate_anonymous_name()
RETURNS TEXT AS $$
DECLARE
    adjectives TEXT[] := ARRAY['Silent', 'Hidden', 'Secret', 'Mystère', 'Ombre', 'Brume', 'Voile', 'Écho', 'Whisper', 'Shadow'];
    nouns TEXT[] := ARRAY['Voyageur', 'Rêveur', 'Penseur', 'Âme', 'Coeur', 'Esprit', 'Voix', 'Souffle', 'Walker', 'Soul'];
    adj TEXT;
    noun TEXT;
    num INTEGER;
BEGIN
    adj := adjectives[1 + floor(random() * array_length(adjectives, 1))::INTEGER];
    noun := nouns[1 + floor(random() * array_length(nouns, 1))::INTEGER];
    num := floor(random() * 9999)::INTEGER;
    RETURN adj || noun || num;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_comments_updated_at
    BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_drafts_updated_at
    BEFORE UPDATE ON drafts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger pour les compteurs de réactions
CREATE OR REPLACE FUNCTION update_reaction_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO reaction_counts (post_id, reaction_type_id, count, updated_at)
        VALUES (NEW.post_id, NEW.reaction_type_id, 1, NOW())
        ON CONFLICT (post_id, reaction_type_id) 
        DO UPDATE SET count = reaction_counts.count + 1, updated_at = NOW();
        
        UPDATE posts SET reactions_count = reactions_count + 1 WHERE id = NEW.post_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE reaction_counts SET count = GREATEST(count - 1, 0), updated_at = NOW()
        WHERE post_id = OLD.post_id AND reaction_type_id = OLD.reaction_type_id;
        
        UPDATE posts SET reactions_count = GREATEST(reactions_count - 1, 0) WHERE id = OLD.post_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_post_reactions_count
    AFTER INSERT OR DELETE ON post_reactions
    FOR EACH ROW EXECUTE FUNCTION update_reaction_counts();

-- Trigger pour les compteurs de commentaires
CREATE OR REPLACE FUNCTION update_comments_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
        UPDATE anonymous_sessions SET comments_count = comments_count + 1 WHERE session_token = NEW.session_token;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = OLD.post_id;
        UPDATE anonymous_sessions SET comments_count = GREATEST(comments_count - 1, 0) WHERE session_token = OLD.session_token;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_comments_count
    AFTER INSERT OR DELETE ON comments
    FOR EACH ROW EXECUTE FUNCTION update_comments_count();

-- Trigger pour les compteurs de posts
CREATE OR REPLACE FUNCTION update_posts_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
        UPDATE anonymous_sessions SET posts_count = posts_count + 1 WHERE session_token = NEW.session_token;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' AND OLD.status = 'published' THEN
        UPDATE anonymous_sessions SET posts_count = GREATEST(posts_count - 1, 0) WHERE session_token = OLD.session_token;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_posts_count
    AFTER INSERT OR DELETE ON posts
    FOR EACH ROW EXECUTE FUNCTION update_posts_count();

-- Trigger pour les likes de commentaires
CREATE OR REPLACE FUNCTION update_comment_likes_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE comments SET likes_count = likes_count + 1 WHERE id = NEW.comment_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE comments SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.comment_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_comment_likes_count
    AFTER INSERT OR DELETE ON comment_likes
    FOR EACH ROW EXECUTE FUNCTION update_comment_likes_count();

-- Trigger pour les vues
CREATE OR REPLACE FUNCTION update_post_views()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE posts SET views_count = views_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_post_views
    AFTER INSERT ON post_views
    FOR EACH ROW EXECUTE FUNCTION update_post_views();

-- =====================================================
-- 9. FONCTIONS RPC
-- =====================================================

-- Incrémenter le compteur de vues (appelé depuis le frontend)
CREATE OR REPLACE FUNCTION increment_view_count(post_id BIGINT)
RETURNS void AS $$
BEGIN
    UPDATE posts SET views_count = views_count + 1 WHERE id = post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recherche full-text
CREATE OR REPLACE FUNCTION search_posts(search_query TEXT, limit_count INTEGER DEFAULT 20)
RETURNS TABLE (
    id BIGINT,
    content TEXT,
    session_token VARCHAR(64),
    created_at TIMESTAMPTZ,
    views_count INTEGER,
    comments_count INTEGER,
    reactions_count INTEGER,
    anonymous_name VARCHAR(50)
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.id,
        p.content,
        p.session_token,
        p.created_at,
        p.views_count,
        p.comments_count,
        p.reactions_count,
        s.anonymous_name
    FROM posts p
    JOIN anonymous_sessions s ON p.session_token = s.session_token
    WHERE p.status = 'published'
    AND p.search_vector @@ plainto_tsquery('french', search_query)
    ORDER BY ts_rank(p.search_vector, plainto_tsquery('french', search_query)) DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 10. VUES UTILES
-- =====================================================

CREATE OR REPLACE VIEW posts_with_author AS
SELECT 
    p.*,
    s.anonymous_name as author_name
FROM posts p
LEFT JOIN anonymous_sessions s ON p.session_token = s.session_token
WHERE p.status = 'published';

CREATE OR REPLACE VIEW comments_with_author AS
SELECT 
    c.*,
    s.anonymous_name as author_name
FROM comments c
LEFT JOIN anonymous_sessions s ON c.session_token = s.session_token
WHERE c.status = 'visible';

-- =====================================================
-- 11. DÉSACTIVER RLS POUR ACCÈS ANONYME
-- =====================================================
-- Important: Pour permettre l'accès anonyme sans authentification Supabase

ALTER TABLE anonymous_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE comments DISABLE ROW LEVEL SECURITY;
ALTER TABLE post_reactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE reaction_counts DISABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes DISABLE ROW LEVEL SECURITY;
ALTER TABLE drafts DISABLE ROW LEVEL SECURITY;
ALTER TABLE post_views DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- 12. GROUPES DE DISCUSSION
-- =====================================================
-- Groupes où les membres peuvent discuter, gérés par un admin back-office

CREATE TABLE groups (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by VARCHAR(64),  -- session_token du créateur (admin)
    is_active BOOLEAN DEFAULT TRUE,
    
    CONSTRAINT fk_group_creator FOREIGN KEY (created_by) REFERENCES anonymous_sessions(session_token)
);

CREATE INDEX idx_groups_active ON groups(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_groups_created ON groups(created_at DESC);

-- Membres des groupes
CREATE TABLE group_members (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL,
    session_token VARCHAR(64) NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    role VARCHAR(20) DEFAULT 'member' CHECK (role IN ('member', 'moderator', 'admin')),
    is_muted BOOLEAN DEFAULT FALSE,
    muted_until TIMESTAMPTZ,
    
    CONSTRAINT unique_group_member UNIQUE (group_id, session_token),
    CONSTRAINT fk_group_members_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_members_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token)
);

CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_session ON group_members(session_token);

-- Messages dans les groupes
CREATE TABLE group_messages (
    id BIGSERIAL PRIMARY KEY,
    group_id BIGINT NOT NULL,
    session_token VARCHAR(64) NOT NULL,
    content TEXT NOT NULL CHECK (LENGTH(content) >= 1 AND LENGTH(content) <= 2000),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_edited BOOLEAN DEFAULT FALSE,
    status VARCHAR(20) DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
    
    CONSTRAINT fk_group_messages_group FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
    CONSTRAINT fk_group_messages_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token)
);

CREATE INDEX idx_group_messages_group ON group_messages(group_id);
CREATE INDEX idx_group_messages_created ON group_messages(created_at DESC);

-- Table pour les admins back-office (identifiés par leur session_token)
CREATE TABLE backoffice_admins (
    id SERIAL PRIMARY KEY,
    session_token VARCHAR(64) NOT NULL UNIQUE,
    email VARCHAR(255),  -- optionnel, pour contact
    role VARCHAR(20) DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    
    CONSTRAINT fk_admin_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token)
);

-- Désactiver RLS pour les nouvelles tables
ALTER TABLE groups DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE group_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE backoffice_admins DISABLE ROW LEVEL SECURITY;

-- Vue pour les messages de groupe avec auteur
CREATE OR REPLACE VIEW group_messages_with_author AS
SELECT 
    gm.*,
    s.anonymous_name as author_name
FROM group_messages gm
LEFT JOIN anonymous_sessions s ON gm.session_token = s.session_token
WHERE gm.status = 'visible';

-- Vue pour les groupes avec nombre de membres
CREATE OR REPLACE VIEW groups_with_stats AS
SELECT 
    g.*,
    COUNT(DISTINCT gm.session_token) as members_count,
    s.anonymous_name as creator_name
FROM groups g
LEFT JOIN group_members gm ON g.id = gm.group_id
LEFT JOIN anonymous_sessions s ON g.created_by = s.session_token
WHERE g.is_active = TRUE
GROUP BY g.id, s.anonymous_name;
ALTER TABLE reaction_types DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- FIN DU SCHÉMA
-- =====================================================
