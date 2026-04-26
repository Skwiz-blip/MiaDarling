-- SYSTÈME DE RÉCUPÉRATION DE COMPTE
-- Exécutez ce script dans Supabase SQL Editor

-- Ajouter les colonnes de récupération à la table anonymous_sessions
ALTER TABLE anonymous_sessions 
ADD COLUMN IF NOT EXISTS recovery_code VARCHAR(20) UNIQUE,
ADD COLUMN IF NOT EXISTS recovery_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS recovery_email_verified BOOLEAN DEFAULT FALSE;

-- Créer un index pour le code de récupération
CREATE INDEX IF NOT EXISTS idx_anonymous_sessions_recovery_code 
ON anonymous_sessions(recovery_code);

-- Fonction pour générer un code de récupération unique
CREATE OR REPLACE FUNCTION generate_recovery_code()
RETURNS VARCHAR(20) AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    code VARCHAR(20) := '';
    i INTEGER;
    exists BOOLEAN;
BEGIN
    LOOP
        -- Générer un code au format MIA-XXXX-XXXX
        code := 'MIA-';
        FOR i IN 1..4 LOOP
            code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
        END LOOP;
        code := code || '-';
        FOR i IN 1..4 LOOP
            code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
        END LOOP;
        
        -- Vérifier l'unicité
        SELECT EXISTS(SELECT 1 FROM anonymous_sessions WHERE recovery_code = code) INTO exists;
        EXIT WHEN NOT exists;
    END LOOP;
    
    RETURN code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fonction pour récupérer une session par code de récupération
CREATE OR REPLACE FUNCTION recover_session(p_recovery_code VARCHAR(20))
RETURNS UUID AS $$
DECLARE
    session_token UUID;
BEGIN
    SELECT session_token INTO session_token
    FROM anonymous_sessions
    WHERE recovery_code = p_recovery_code;
    
    RETURN session_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger pour générer automatiquement un code de récupération à la création d'une session
CREATE OR REPLACE FUNCTION auto_generate_recovery_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.recovery_code IS NULL THEN
        NEW.recovery_code := generate_recovery_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Supprimer l'ancien trigger s'il existe
DROP TRIGGER IF EXISTS trigger_auto_recovery_code ON anonymous_sessions;

-- Créer le trigger
CREATE TRIGGER trigger_auto_recovery_code
BEFORE INSERT ON anonymous_sessions
FOR EACH ROW
EXECUTE FUNCTION auto_generate_recovery_code();
