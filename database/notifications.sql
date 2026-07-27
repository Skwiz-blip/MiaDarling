-- =====================================================
-- MIA DARLING — Notifications
-- =====================================================
-- Crée une table de notifications alimentée AUTOMATIQUEMENT par des triggers :
--   * réaction à ton témoignage
--   * commentaire sur ton témoignage
--   * réponse à ton commentaire
--   * like sur ton commentaire
--   * nouveau message dans un groupe dont tu es membre
--
-- À exécuter UNE FOIS dans Supabase > SQL Editor.
-- =====================================================

CREATE TABLE IF NOT EXISTS notifications (
    id              BIGSERIAL PRIMARY KEY,
    recipient_token VARCHAR(64) NOT NULL,           -- qui reçoit
    actor_token     VARCHAR(64),                    -- qui a déclenché (peut être null)
    type            VARCHAR(30) NOT NULL,           -- reaction | comment | reply | comment_like | group_message
    post_id         BIGINT,
    comment_id      BIGINT,
    group_id        UUID,
    message_id      UUID,
    preview         TEXT,                           -- petit extrait
    is_read         BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT fk_notif_recipient
        FOREIGN KEY (recipient_token)
        REFERENCES anonymous_sessions(session_token)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications(recipient_token, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(recipient_token) WHERE is_read = FALSE;

-- RLS permissive (cohérent avec le reste de l'app ; le filtrage par
-- destinataire se fait côté client). Les aperçus ne contiennent que du
-- contenu déjà public (témoignages/commentaires/messages de groupe).
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif_all" ON notifications;
CREATE POLICY "notif_all" ON notifications FOR ALL USING (true) WITH CHECK (true);


-- =====================================================
-- TRIGGERS (SECURITY DEFINER : insèrent la notif quel que soit l'appelant)
-- =====================================================

-- 1) Réaction sur un témoignage → notifie l'auteur du témoignage
CREATE OR REPLACE FUNCTION notify_post_reaction()
RETURNS TRIGGER AS $$
DECLARE owner_token TEXT; snippet TEXT;
BEGIN
    SELECT session_token, LEFT(content, 90) INTO owner_token, snippet
    FROM posts WHERE id = NEW.post_id;

    IF owner_token IS NOT NULL AND owner_token <> NEW.session_token THEN
        INSERT INTO notifications (recipient_token, actor_token, type, post_id, preview)
        VALUES (owner_token, NEW.session_token, 'reaction', NEW.post_id, snippet);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_post_reaction ON post_reactions;
CREATE TRIGGER trg_notify_post_reaction
    AFTER INSERT ON post_reactions
    FOR EACH ROW EXECUTE FUNCTION notify_post_reaction();


-- 2) Commentaire sur un témoignage / réponse à un commentaire
CREATE OR REPLACE FUNCTION notify_comment()
RETURNS TRIGGER AS $$
DECLARE target_token TEXT; snippet TEXT;
BEGIN
    snippet := LEFT(NEW.content, 90);

    IF NEW.parent_comment_id IS NULL THEN
        -- commentaire → auteur du post
        SELECT session_token INTO target_token FROM posts WHERE id = NEW.post_id;
        IF target_token IS NOT NULL AND target_token <> NEW.session_token THEN
            INSERT INTO notifications (recipient_token, actor_token, type, post_id, comment_id, preview)
            VALUES (target_token, NEW.session_token, 'comment', NEW.post_id, NEW.id, snippet);
        END IF;
    ELSE
        -- réponse → auteur du commentaire parent
        SELECT session_token INTO target_token FROM comments WHERE id = NEW.parent_comment_id;
        IF target_token IS NOT NULL AND target_token <> NEW.session_token THEN
            INSERT INTO notifications (recipient_token, actor_token, type, post_id, comment_id, preview)
            VALUES (target_token, NEW.session_token, 'reply', NEW.post_id, NEW.id, snippet);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_comment ON comments;
CREATE TRIGGER trg_notify_comment
    AFTER INSERT ON comments
    FOR EACH ROW EXECUTE FUNCTION notify_comment();


-- 3) Like sur un commentaire → notifie l'auteur du commentaire
CREATE OR REPLACE FUNCTION notify_comment_like()
RETURNS TRIGGER AS $$
DECLARE target_token TEXT; snippet TEXT;
BEGIN
    SELECT session_token, LEFT(content, 90) INTO target_token, snippet
    FROM comments WHERE id = NEW.comment_id;

    IF target_token IS NOT NULL AND target_token <> NEW.session_token THEN
        INSERT INTO notifications (recipient_token, actor_token, type, comment_id, preview)
        VALUES (target_token, NEW.session_token, 'comment_like', NEW.comment_id, snippet);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_comment_like ON comment_likes;
CREATE TRIGGER trg_notify_comment_like
    AFTER INSERT ON comment_likes
    FOR EACH ROW EXECUTE FUNCTION notify_comment_like();


-- 4) Nouveau message de groupe → notifie tous les membres (sauf l'expéditeur)
CREATE OR REPLACE FUNCTION notify_group_message()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO notifications (recipient_token, actor_token, type, group_id, message_id, preview)
    SELECT gm.session_token, NEW.session_token, 'group_message', NEW.group_id, NEW.id, LEFT(NEW.content, 90)
    FROM group_members gm
    WHERE gm.group_id = NEW.group_id
      AND gm.session_token <> NEW.session_token;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_notify_group_message ON group_messages;
CREATE TRIGGER trg_notify_group_message
    AFTER INSERT ON group_messages
    FOR EACH ROW EXECUTE FUNCTION notify_group_message();

-- =====================================================
-- Fin. Les notifications se créent désormais toutes seules.
-- =====================================================
