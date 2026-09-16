-- Search reports are explicitly derived evidence, never represented as article text.
CREATE TABLE news_private.research (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES news_private.runs(id),
  query text NOT NULL, report text NOT NULL, sources jsonb NOT NULL,
  provider_request_id text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE news_private.research ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON news_private.research FROM PUBLIC;
CREATE INDEX research_run ON news_private.research(run_id);
ALTER TABLE news_private.runs ADD COLUMN schedule_key text UNIQUE;
CREATE TABLE news_private.feedback (
  id uuid PRIMARY KEY, text text NOT NULL, actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE news_private.feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON news_private.feedback FROM PUBLIC;
CREATE TABLE news_private.market_links (
  id uuid PRIMARY KEY, provider text NOT NULL CHECK(provider IN ('polymarket','kalshi')),
  external_id text NOT NULL, topic text NOT NULL, enabled boolean NOT NULL DEFAULT false,
  permission_reference text NOT NULL, version integer NOT NULL DEFAULT 1,
  public_url text, selected boolean NOT NULL DEFAULT true,
  quote jsonb, checked_at timestamptz, error text, UNIQUE(provider,external_id,topic)
);
ALTER TABLE news_private.market_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON news_private.market_links FROM PUBLIC;
