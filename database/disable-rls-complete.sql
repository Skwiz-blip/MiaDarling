-- DÉSACTIVER RLS SUR TOUTES LES TABLES
-- Exécutez ce script dans Supabase SQL Editor

DO $$
DECLARE
    t text;
BEGIN
    FOR t IN 
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE 'ALTER TABLE IF EXISTS ' || t || ' DISABLE ROW LEVEL SECURITY';
    END LOOP;
END $$;

-- Vérifier le résultat
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
