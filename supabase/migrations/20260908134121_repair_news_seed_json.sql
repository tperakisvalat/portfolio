-- Repair the first Docker startup's double-encoded seed values. Preserve all
-- content, versions and timestamps. Correct objects are untouched, including
-- owner edits in existing embedded databases. Invalid encoded JSON fails closed.
UPDATE news_private.settings
SET value = (value #>> '{}')::jsonb
WHERE CASE WHEN jsonb_typeof(value) = 'string'
  THEN jsonb_typeof((value #>> '{}')::jsonb) = 'object'
  ELSE false END;

UPDATE news_private.sources
SET config = (config #>> '{}')::jsonb
WHERE CASE WHEN jsonb_typeof(config) = 'string'
  THEN jsonb_typeof((config #>> '{}')::jsonb) = 'object'
  ELSE false END;
