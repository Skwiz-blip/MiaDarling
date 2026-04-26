ALTER PUBLICATION supabase_realtime ADD TABLE posts;

-- 3. Activer Realtime sur la table comments
ALTER PUBLICATION supabase_realtime ADD TABLE comments;

-- 4. Activer Realtime sur la table post_reactions
ALTER PUBLICATION supabase_realtime ADD TABLE post_reactions;

-- 5. Activer Realtime sur la table comment_likes
ALTER PUBLICATION supabase_realtime ADD TABLE comment_likes;

-- 6. Activer Realtime sur la table post_views
ALTER PUBLICATION supabase_realtime ADD TABLE post_views;

-- 7. Activer Realtime sur la table anonymous_sessions
ALTER PUBLICATION supabase_realtime ADD TABLE anonymous_sessions; 