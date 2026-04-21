-- =====================================================
-- MIA DARLING - Schéma de Base de Données
-- Plateforme de témoignages anonymes
-- Compatible Supabase (PostgreSQL)
-- =====================================================

-- Activer les extensions nécessaires
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- 1. SESSIONS ANONYMES
-- =====================================================
-- Gère les sessions anonymes pour retrouver "ses" publications
-- sans révéler l'identité de l'utilisateur

CREATE TABLE anonymous_sessions (
    session_token VARCHAR(64) PRIMARY KEY DEFAULT encode(gen_random_bytes(32), 'hex'),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    is_banned BOOLEAN DEFAULT FALSE,
    ban_reason TEXT,
    metadata_hash VARCHAR(128),  -- Hash pour détection d'abus (IP, user-agent hashés)
    anonymous_name VARCHAR(50),  -- Nom affiché ex: "Anonyme_8634"
    
    -- Compteurs pour détection de spam
    posts_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_sessions_last_activity ON anonymous_sessions(last_activity_at DESC);
CREATE INDEX idx_sessions_banned ON anonymous_sessions(is_banned) WHERE is_banned = TRUE;

-- =====================================================
-- 2. HUMEURS (MOODS)
-- =====================================================

CREATE TABLE moods (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    emoji VARCHAR(10) NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Données initiales des humeurs
INSERT INTO moods (name, emoji, sort_order) VALUES
('Triste', ' sorrow', 1),
('Épuisé', ' tired', 2),
('Anxieux', ' anxious', 3),
('En colère', ' angry', 4),
('Soulagé', ' relieved', 5),
('Espoir', ' hopeful', 6),
('Perdu', ' lost', 7),
('Gratitude', ' grateful', 8);


CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(30) NOT NULL UNIQUE,
    slug VARCHAR(30) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    usage_count INTEGER DEFAULT 0,
    is_trending BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_tags_usage ON tags(usage_count DESC);
CREATE INDEX idx_tags_trending ON tags(is_trending) WHERE is_trending = TRUE;

-- Tags initiaux
INSERT INTO tags (name, slug) VALUES
('Triste', 'triste'),
('Émotions', 'emotions'),
('Espoir', 'espoir'),
('Liberté', 'liberte'),
('Limites', 'limites'),
('Masque', 'masque'),
('SilenceIntérieur', 'silence-interieur');


CREATE TABLE posts (
    id BIGSERIAL PRIMARY KEY,
    session_token VARCHAR(64) NOT NULL,
    
    -- Contenu
    content TEXT NOT NULL CHECK (LENGTH(content) >= 10 AND LENGTH(content) <= 2000),
    content_hash VARCHAR(64),  -- Pour détection de doublons
    
    -- Métadonnées
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_edited BOOLEAN DEFAULT FALSE,
    
    -- Statut
    status VARCHAR(20) DEFAULT 'published' CHECK (status IN ('draft', 'published', 'hidden', 'deleted')),
    is_pinned BOOLEAN DEFAULT FALSE,
    
    -- Modération
    is_flagged BOOLEAN DEFAULT FALSE,
    flagged_reason TEXT,
    moderated_at TIMESTAMPTZ,
    moderated_by VARCHAR(64),
    
    -- Statistiques (dénormalisées pour performance)
    views_count INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    reactions_count INTEGER DEFAULT 0,
    
    -- Recherche full-text
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('french', content)) STORED,
    
    CONSTRAINT fk_post_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token) ON DELETE CASCADE
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_posts_created_at ON posts(created_at DESC) WHERE status = 'published';
CREATE INDEX idx_posts_status ON posts(status);
CREATE INDEX idx_posts_session ON posts(session_token);
CREATE INDEX idx_posts_search ON posts USING GIN(search_vector);
CREATE INDEX idx_posts_flagged ON posts(is_flagged) WHERE is_flagged = TRUE;
CREATE INDEX idx_posts_popular ON posts(reactions_count DESC, views_count DESC) WHERE status = 'published';

CREATE TABLE post_moods (
    post_id BIGINT NOT NULL,
    mood_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, mood_id),
    CONSTRAINT fk_post_moods_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_post_moods_mood FOREIGN KEY (mood_id) REFERENCES moods(id) ON DELETE CASCADE
);
 

CREATE TABLE post_tags (
    post_id BIGINT NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, tag_id),
    CONSTRAINT fk_post_tags_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_post_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX idx_post_tags_tag ON post_tags(tag_id); 

CREATE TABLE reaction_types (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    emoji VARCHAR(10) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE
);

-- Réactions initiales
INSERT INTO reaction_types (name, emoji, sort_order) VALUES
('cry', ' sorrow', 1),
('sad', ' tired', 2),
('heart', ' grateful', 3); 

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
CREATE INDEX idx_post_reactions_session ON post_reactions(session_token);
 

CREATE TABLE reaction_counts (
    post_id BIGINT NOT NULL,
    reaction_type_id INTEGER NOT NULL,
    count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (post_id, reaction_type_id),
    CONSTRAINT fk_reaction_counts_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_reaction_counts_type FOREIGN KEY (reaction_type_id) REFERENCES reaction_types(id)
);

CREATE INDEX idx_reaction_counts_post ON reaction_counts(post_id);
 

CREATE TABLE comments (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL,
    parent_comment_id BIGINT,
    session_token VARCHAR(64) NOT NULL,
    
    content TEXT NOT NULL CHECK (LENGTH(content) >= 1 AND LENGTH(content) <= 1000),
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_edited BOOLEAN DEFAULT FALSE,
    
    -- Statut
    status VARCHAR(20) DEFAULT 'visible' CHECK (status IN ('visible', 'hidden', 'deleted')),
    
    -- Modération
    is_flagged BOOLEAN DEFAULT FALSE,
    flagged_reason TEXT,
    
    -- Statistiques
    likes_count INTEGER DEFAULT 0,
    
    CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_parent FOREIGN KEY (parent_comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    CONSTRAINT fk_comments_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token)
);

CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX idx_comments_tree ON comments(post_id, parent_comment_id NULLS FIRST);
CREATE INDEX idx_comments_session ON comments(session_token);
 

CREATE TABLE comment_likes (
    comment_id BIGINT NOT NULL,
    session_token VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (comment_id, session_token),
    CONSTRAINT fk_comment_likes_comment FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    CONSTRAINT fk_comment_likes_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token)
);
 

CREATE TABLE drafts (
    id BIGSERIAL PRIMARY KEY,
    session_token VARCHAR(64) NOT NULL,
    content TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    auto_saved_at TIMESTAMPTZ,
    
    -- Un seul brouillon actif par session
    CONSTRAINT unique_draft_session UNIQUE (session_token),
    CONSTRAINT fk_drafts_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token) ON DELETE CASCADE
);
 

CREATE TABLE draft_moods (
    draft_id BIGINT NOT NULL,
    mood_id INTEGER NOT NULL,
    PRIMARY KEY (draft_id, mood_id),
    CONSTRAINT fk_draft_moods_draft FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
    CONSTRAINT fk_draft_moods_mood FOREIGN KEY (mood_id) REFERENCES moods(id) ON DELETE CASCADE
);
 

CREATE TABLE draft_tags (
    draft_id BIGINT NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (draft_id, tag_id),
    CONSTRAINT fk_draft_tags_draft FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
    CONSTRAINT fk_draft_tags_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
 

CREATE TABLE post_views (
    id BIGSERIAL PRIMARY KEY,
    post_id BIGINT NOT NULL,
    session_token VARCHAR(64),
    viewed_at TIMESTAMPTZ DEFAULT NOW(),
    view_duration_seconds INTEGER,
    
    CONSTRAINT fk_post_views_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT fk_post_views_session FOREIGN KEY (session_token) REFERENCES anonymous_sessions(session_token)
);

CREATE INDEX idx_post_views_post ON post_views(post_id);
CREATE INDEX idx_post_views_date ON post_views(viewed_at);
 

CREATE TABLE moderation_logs (
    id BIGSERIAL PRIMARY KEY,
    
    -- Cible de la modération
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('post', 'comment', 'session')),
    target_id BIGINT,
    target_session_token VARCHAR(64),
    
    -- Action
    action VARCHAR(20) NOT NULL CHECK (action IN ('hide', 'delete', 'warn', 'ban', 'unban')),
    reason TEXT,
    
    -- Modérateur
    moderator_session_token VARCHAR(64),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_moderation_target ON moderation_logs(target_type, target_id);
 

CREATE TABLE daily_stats (
    stat_date DATE PRIMARY KEY,
    
    -- Compteurs
    posts_published INTEGER DEFAULT 0,
    posts_drafts INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    new_sessions INTEGER DEFAULT 0,
    active_sessions INTEGER DEFAULT 0,
    
    -- Réactions
    total_reactions INTEGER DEFAULT 0,
    reactions_by_type JSONB DEFAULT '{}',
    
    -- Engagement
    total_views INTEGER DEFAULT 0,
    avg_view_duration_seconds INTEGER,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);
 

CREATE TABLE tag_stats (
    tag_id INTEGER PRIMARY KEY,
    posts_count INTEGER DEFAULT 0,
    reactions_count INTEGER DEFAULT 0,
    views_count INTEGER DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    
    CONSTRAINT fk_tag_stats_tag FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
 
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger pour posts.updated_at
CREATE TRIGGER trigger_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger pour comments.updated_at
CREATE TRIGGER trigger_comments_updated_at
    BEFORE UPDATE ON comments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger pour drafts.updated_at
CREATE TRIGGER trigger_drafts_updated_at
    BEFORE UPDATE ON drafts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
 
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
    FOR EACH ROW
    EXECUTE FUNCTION update_reaction_counts();
 
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
    FOR EACH ROW
    EXECUTE FUNCTION update_comments_count(); 
CREATE OR REPLACE FUNCTION update_posts_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
        UPDATE anonymous_sessions SET posts_count = posts_count + 1 WHERE session_token = NEW.session_token;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' AND OLD.status = 'published' THEN
        UPDATE anonymous_sessions SET posts_count = GREATEST(posts_count - 1, 0) WHERE session_token = OLD.session_token;
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'draft' AND NEW.status = 'published' THEN
            UPDATE anonymous_sessions SET posts_count = posts_count + 1 WHERE session_token = NEW.session_token;
        ELSIF OLD.status = 'published' AND NEW.status = 'deleted' THEN
            UPDATE anonymous_sessions SET posts_count = GREATEST(posts_count - 1, 0) WHERE session_token = NEW.session_token;
        END IF;
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_posts_count
    AFTER INSERT OR DELETE OR UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION update_posts_count();
 
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
    FOR EACH ROW
    EXECUTE FUNCTION update_comment_likes_count();
 

CREATE OR REPLACE FUNCTION update_tag_usage()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE tags SET usage_count = usage_count + 1 WHERE id = NEW.tag_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE tags SET usage_count = GREATEST(usage_count - 1, 0) WHERE id = OLD.tag_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tag_usage
    AFTER INSERT OR DELETE ON post_tags
    FOR EACH ROW
    EXECUTE FUNCTION update_tag_usage(); 

CREATE OR REPLACE FUNCTION update_post_views()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE posts SET views_count = views_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_post_views
    AFTER INSERT ON post_views
    FOR EACH ROW
    EXECUTE FUNCTION update_post_views();

CREATE OR REPLACE FUNCTION generate_anonymous_name()
RETURNS TEXT AS $$
DECLARE
    adjectives TEXT[] := ARRAY['Silent', 'Hidden', 'Secret', 'Mystère', 'Ombre', 'Brume', 'Voile', 'Écho'];
    nouns TEXT[] := ARRAY['Voyageur', 'Rêveur', 'Penseur', 'Âme', 'Coeur', 'Esprit', 'Voix', 'Souffle'];
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
 

CREATE OR REPLACE FUNCTION create_anonymous_session()
RETURNS VARCHAR(64) AS $$
DECLARE
    new_token VARCHAR(64);
    new_name VARCHAR(50);
BEGIN
    new_token := encode(gen_random_bytes(32), 'hex');
    new_name := generate_anonymous_name();
    
    INSERT INTO anonymous_sessions (session_token, anonymous_name)
    VALUES (new_token, new_name);
    
    RETURN new_token;
END;
$$ LANGUAGE plpgsql;
 

CREATE OR REPLACE VIEW posts_with_reactions AS
SELECT 
    p.*,
    s.anonymous_name as author_name,
    COALESCE(rc.cry_count, 0) as cry_count,
    COALESCE(rc.sad_count, 0) as sad_count,
    COALESCE(rc.heart_count, 0) as heart_count
FROM posts p
LEFT JOIN anonymous_sessions s ON p.session_token = s.session_token
LEFT JOIN (
    SELECT 
        post_id,
        SUM(CASE WHEN reaction_type_id = 1 THEN count ELSE 0 END) as cry_count,
        SUM(CASE WHEN reaction_type_id = 2 THEN count ELSE 0 END) as sad_count,
        SUM(CASE WHEN reaction_type_id = 3 THEN count ELSE 0 END) as heart_count
    FROM reaction_counts
    GROUP BY post_id
) rc ON p.id = rc.post_id
WHERE p.status = 'published';

CREATE OR REPLACE VIEW popular_posts AS
SELECT * FROM posts_with_reactions
ORDER BY reactions_count DESC, views_count DESC, created_at DESC
LIMIT 100;

CREATE OR REPLACE VIEW recent_posts AS
SELECT * FROM posts_with_reactions
ORDER BY created_at DESC
LIMIT 50;
 

ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts ENABLE ROW LEVEL SECURITY;
 
CREATE POLICY "Posts publiés visibles par tous" ON posts
    FOR SELECT USING (status = 'published');
 
CREATE POLICY "Utilisateurs voient leurs posts" ON posts
    FOR SELECT USING (session_token = current_setting('request.jwt.claims->session_token', true));
 
CREATE POLICY "Utilisateurs créent posts" ON posts
    FOR INSERT WITH CHECK (session_token = current_setting('request.jwt.claims->session_token', true));

CREATE POLICY "Utilisateurs modifient leurs posts" ON posts
    FOR UPDATE USING (session_token = current_setting('request.jwt.claims->session_token', true));

CREATE POLICY "Utilisateurs suppriment leurs posts" ON posts
    FOR DELETE USING (session_token = current_setting('request.jwt.claims->session_token', true));

CREATE POLICY "Commentaires visibles" ON comments
    FOR SELECT USING (status = 'visible');

CREATE POLICY "Utilisateurs voient leurs commentaires" ON comments
    FOR SELECT USING (session_token = current_setting('request.jwt.claims->session_token', true));

CREATE POLICY "Utilisateurs créent commentaires" ON comments
    FOR INSERT WITH CHECK (session_token = current_setting('request.jwt.claims->session_token', true));

CREATE POLICY "Utilisateurs modifient leurs commentaires" ON comments
    FOR UPDATE USING (session_token = current_setting('request.jwt.claims->session_token', true));

CREATE POLICY "Utilisateurs suppriment leurs commentaires" ON comments
    FOR DELETE USING (session_token = current_setting('request.jwt.claims->session_token', true));

CREATE POLICY "Réactions visibles" ON post_reactions FOR SELECT USING (true);
CREATE POLICY "Utilisateurs créent réactions" ON post_reactions
    FOR INSERT WITH CHECK (session_token = current_setting('request.jwt.claims->session_token', true));
CREATE POLICY "Utilisateurs suppriment réactions" ON post_reactions
    FOR DELETE USING (session_token = current_setting('request.jwt.claims->session_token', true));

CREATE POLICY "Likes visibles" ON comment_likes FOR SELECT USING (true);
CREATE POLICY "Utilisateurs créent likes" ON comment_likes
    FOR INSERT WITH CHECK (session_token = current_setting('request.jwt.claims->session_token', true));
CREATE POLICY "Utilisateurs suppriment likes" ON comment_likes
    FOR DELETE USING (session_token = current_setting('request.jwt.claims->session_token', true));
CREATE POLICY "Utilisateurs voient leurs brouillons" ON drafts
    FOR SELECT USING (session_token = current_setting('request.jwt.claims->session_token', true));
CREATE POLICY "Utilisateurs créent brouillons" ON drafts
    FOR INSERT WITH CHECK (session_token = current_setting('request.jwt.claims->session_token', true));
CREATE POLICY "Utilisateurs modifient brouillons" ON drafts
    FOR UPDATE USING (session_token = current_setting('request.jwt.claims->session_token', true));
CREATE POLICY "Utilisateurs suppriment brouillons" ON drafts
    FOR DELETE USING (session_token = current_setting('request.jwt.claims->session_token', true));

CREATE POLICY "Moods visibles" ON moods FOR SELECT USING (true);
CREATE POLICY "Tags visibles" ON tags FOR SELECT USING (true);
CREATE POLICY "Reaction types visibles" ON reaction_types FOR SELECT USING (true);
CREATE POLICY "Reaction counts visibles" ON reaction_counts FOR SELECT USING (true);