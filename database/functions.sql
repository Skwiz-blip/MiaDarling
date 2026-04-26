CREATE OR REPLACE FUNCTION increment_view_count(post_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE posts 
    SET views_count = COALESCE(views_count, 0) + 1 
    WHERE id = post_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
 
CREATE OR REPLACE FUNCTION update_reaction_count(post_id UUID, reaction_type_id INT, increment BOOLEAN)
RETURNS void AS $$
BEGIN
    IF increment THEN
        UPDATE posts 
        SET reactions_count = COALESCE(reactions_count, 0) + 1 
        WHERE id = post_id;
    ELSE
        UPDATE posts 
        SET reactions_count = GREATEST(COALESCE(reactions_count, 0) - 1, 0) 
        WHERE id = post_id;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
