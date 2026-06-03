-- ═══════════════════════════════════════════════════════════
-- DB Init Script - Credit Card Analyzer
-- Run after fresh postgres container is up
-- ═══════════════════════════════════════════════════════════

-- Create DBA user for external access
DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'dba') THEN
      CREATE USER dba WITH PASSWORD 'DBA_S3cr3t_2026' CREATEDB;
   END IF;
END
$$;

-- Create prod user
DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'expenses_user') THEN
      CREATE USER expenses_user WITH PASSWORD 'EXPENSES_PASS_prod';
   END IF;
END
$$;

-- Create dev user
DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'expenses_dev_user') THEN
      CREATE USER expenses_dev_user WITH PASSWORD 'EXPENSES_PASS_dev';
   END IF;
END
$$;

-- Create databases (run separately, can't be in DO block)
-- CREATE DATABASE expenses;
-- CREATE DATABASE expenses_dev;

-- Grant on schema public - tables and sequences
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO dba;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO expenses_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO expenses_dev_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO dba;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO expenses_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO expenses_dev_user;
GRANT ALL PRIVILEGES ON SCHEMA public TO dba;
GRANT ALL PRIVILEGES ON SCHEMA public TO expenses_user;
GRANT ALL PRIVILEGES ON SCHEMA public TO expenses_dev_user;

-- Default permissions for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO dba;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO expenses_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO expenses_dev_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO dba;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO expenses_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO expenses_dev_user;