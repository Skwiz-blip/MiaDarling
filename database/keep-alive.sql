-- 1) Activer les extensions nécessaires
--    ⚠️ RECOMMANDÉ : active plutôt pg_cron et pg_net depuis
--    Dashboard > Database > Extensions (recherche "pg_cron" puis "pg_net",
--    bascule chaque interrupteur). Le CREATE EXTENSION ci-dessous peut entrer
--    en conflit (deadlock) avec les workers de Supabase.
--    Si tu passes par le Dashboard, saute directement à l'étape 2.
--    Exécute chaque ligne SÉPARÉMENT (une à la fois) si tu utilises le SQL :
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2) Petite table "battement de cœur" (trace locale, utile pour vérifier)
CREATE TABLE IF NOT EXISTS keepalive (
    id         INT PRIMARY KEY DEFAULT 1,
    last_ping  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT keepalive_single_row CHECK (id = 1)
);
INSERT INTO keepalive (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 3) (Ré)installer proprement la tâche planifiée.
--    On désinscrit l'ancienne UNIQUEMENT si elle existe (un seul énoncé, sans
--    bloc PL/pgSQL, pour limiter les verrous sur cron.job → moins de deadlock).
SELECT cron.unschedule('mia-keepalive')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mia-keepalive');

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
