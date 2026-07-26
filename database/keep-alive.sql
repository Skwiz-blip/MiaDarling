-- =====================================================
-- MIA DARLING — Garder le backend Supabase (gratuit) actif
-- =====================================================
-- Problème : un projet Supabase gratuit est MIS EN PAUSE après 7 jours
--            SANS aucune requête API.
-- Solution : une tâche planifiée (pg_cron) qui envoie chaque jour une vraie
--            requête HTTP à la propre API REST du projet (pg_net) → trafic
--            réel = le projet reste actif.
--
-- ⚠️ Un simple trigger SQL NE SUFFIT PAS (il ne se déclenche que sur un
--    changement de données et ne génère pas de trafic API). Il faut bien une
--    tâche planifiée comme ci-dessous.
--
-- À exécuter UNE FOIS dans Supabase > SQL Editor.
-- =====================================================

-- 1) Activer les extensions nécessaires
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) Petite table "battement de cœur" (trace locale, utile pour vérifier)
CREATE TABLE IF NOT EXISTS keepalive (
    id         INT PRIMARY KEY DEFAULT 1,
    last_ping  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT keepalive_single_row CHECK (id = 1)
);
INSERT INTO keepalive (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 3) (Ré)installer proprement la tâche planifiée
--    On supprime l'ancienne si elle existe déjà pour éviter les doublons.
DO $$
BEGIN
    PERFORM cron.unschedule('mia-keepalive');
EXCEPTION WHEN OTHERS THEN
    -- la tâche n'existait pas encore : on ignore
    NULL;
END $$;

-- 4) Planifier : tous les jours à 06:00 UTC
--    (largement dans la fenêtre des 7 jours, avec de la marge)
SELECT cron.schedule(
    'mia-keepalive',
    '0 6 * * *',
    $job$
    -- a) trafic DB interne
    UPDATE keepalive SET last_ping = NOW() WHERE id = 1;

    -- b) VRAIE requête vers l'API REST du projet (c'est ce qui compte le plus
    --    pour éviter la mise en pause). On lit 1 ligne, sans rien exposer.
    SELECT net.http_get(
        url     := 'https://yeawjdkyqjyjvpahlbmp.supabase.co/rest/v1/moods?select=id&limit=1',
        headers := jsonb_build_object(
            'apikey',        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllYXdqZGt5cWp5anZwYWhsYm1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzQ2MzAsImV4cCI6MjA5MjI1MDYzMH0.DP3kRbQ0UH7moDkaF61y9wmlqupLXjClj6PSqROQNlA',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllYXdqZGt5cWp5anZwYWhsYm1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NzQ2MzAsImV4cCI6MjA5MjI1MDYzMH0.DP3kRbQ0UH7moDkaF61y9wmlqupLXjClj6PSqROQNlA'
        )
    );
    $job$
);

-- =====================================================
-- VÉRIFICATIONS (à lancer quand tu veux)
-- =====================================================
-- Voir la tâche planifiée :
--   SELECT jobid, schedule, jobname, active FROM cron.job;
--
-- Voir les dernières exécutions (succès/échec) :
--   SELECT jobid, status, return_message, start_time
--   FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
--
-- Voir le dernier battement de cœur :
--   SELECT * FROM keepalive;
--
-- Voir les réponses HTTP de pg_net :
--   SELECT id, status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;
--
-- Pour DÉSACTIVER le keep-alive plus tard :
--   SELECT cron.unschedule('mia-keepalive');
-- =====================================================
