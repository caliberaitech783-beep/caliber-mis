-- Run with an authorised PostgreSQL administrator in psql.
-- This creates only a dedicated MIS role and targets the new MIS database.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'caliber_mis_app') THEN
    CREATE ROLE caliber_mis_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $$;
-- psql prompts privately; do not put the password in this file or chat.
\password caliber_mis_app
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE caliber_mis TO caliber_mis_app;
\connect caliber_mis
GRANT USAGE, CREATE ON SCHEMA public TO caliber_mis_app;
-- Start the MIS app using this role to create its own tables.
-- Never run migrations with the Pulse connection string.
