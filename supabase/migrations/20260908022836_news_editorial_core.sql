CREATE SCHEMA IF NOT EXISTS news_private;
REVOKE ALL ON SCHEMA news_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA news_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA news_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE news_private.settings (
  id text PRIMARY KEY CHECK (id = 'editor'), version integer NOT NULL DEFAULT 1,
  value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE news_private.sources (
  id text PRIMARY KEY, version integer NOT NULL DEFAULT 1, config jsonb NOT NULL,
  last_checked_at timestamptz, last_success_at timestamptz, last_error text,
  lease_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE news_private.items (
  id uuid PRIMARY KEY, source_id text NOT NULL REFERENCES news_private.sources(id),
  canonical_url text NOT NULL UNIQUE, title text NOT NULL, author text,
  published_at timestamptz, discovered_at timestamptz NOT NULL DEFAULT now(),
  evidence text, evidence_level text NOT NULL CHECK(evidence_level IN ('metadata','feed-text')),
  content_hash text NOT NULL, kind text NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX items_source_date ON news_private.items(source_id,published_at DESC NULLS LAST);
CREATE INDEX items_recent ON news_private.items(discovered_at DESC);
CREATE TABLE news_private.drafts (
  id uuid PRIMARY KEY, version integer NOT NULL DEFAULT 1, content jsonb NOT NULL,
  settings_version integer NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE news_private.editions (
  id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES news_private.drafts(id), draft_version integer NOT NULL,
  content jsonb NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(draft_id,draft_version)
);
CREATE INDEX editions_latest ON news_private.editions(published_at DESC,id DESC);
CREATE TABLE news_private.library (
  item_id uuid PRIMARY KEY REFERENCES news_private.items(id), annotation text NOT NULL,
  edition_id uuid NOT NULL REFERENCES news_private.editions(id), approved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE news_private.library_topics (
  item_id uuid NOT NULL REFERENCES news_private.library(item_id), topic text NOT NULL,
  PRIMARY KEY(item_id,topic)
);
CREATE INDEX library_topic_lookup ON news_private.library_topics(topic,item_id);
CREATE TABLE news_private.audit (
  id uuid PRIMARY KEY, actor text NOT NULL, action text NOT NULL, entity_id text NOT NULL,
  before_value jsonb, after_value jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE news_private.service_tokens (
  id uuid PRIMARY KEY, name text NOT NULL, token_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE news_private.idempotency (
  actor text NOT NULL, key text NOT NULL, request_hash text NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor,key)
);
CREATE TABLE news_private.runs (
  id uuid PRIMARY KEY, settings_version integer NOT NULL, settings_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK(status IN ('queued','running','review','failed','cancelled')),
  draft_id uuid REFERENCES news_private.drafts(id), error text,
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
  lease_until timestamptz, worker_id text
);
CREATE INDEX runs_queue ON news_private.runs(status,created_at);
CREATE TABLE news_private.daily_budget (
  day date PRIMARY KEY, limit_usd numeric(12,6) NOT NULL, committed_usd numeric(12,6) NOT NULL DEFAULT 0,
  CHECK(committed_usd >= 0)
);
CREATE TABLE news_private.usage (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES news_private.runs(id), day date NOT NULL REFERENCES news_private.daily_budget(day),
  model text NOT NULL, reserved_usd numeric(12,6) NOT NULL, actual_usd numeric(12,6),
  state text NOT NULL CHECK(state IN ('reserved','settled','unknown')),
  provider_request_id text, created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz
);
CREATE INDEX usage_run ON news_private.usage(run_id);

-- No browser-facing table grants. All public reads use an explicit, sanitized API projection.
-- RLS is defense in depth even if this private schema is accidentally exposed via PostgREST.
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='news_private' LOOP
    EXECUTE format('ALTER TABLE news_private.%I ENABLE ROW LEVEL SECURITY',t.tablename);
    EXECUTE format('REVOKE ALL ON news_private.%I FROM PUBLIC',t.tablename);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
      EXECUTE format('REVOKE ALL ON news_private.%I FROM anon, authenticated',t.tablename);
    END IF;
  END LOOP;
END $$;
