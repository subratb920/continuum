-- Engagement and (opt-in) continuity for page views.
--   view_id      a browser-made id per page view: lets an engagement update find
--                its view, and ties a visitor's views into a journey.
--   dwell_ms     time spent on the page (from the engagement beacon).
--   scroll_pct   how far down the page they read (0–100).
--   visitor_pid  a STABLE hash of a persistent id the visitor agreed to (a
--                cookie). Only set after consent; lets the same person be
--                followed across days. Null for everyone who hasn't consented
--                (they stay day-scoped and anonymous via visitor_hash).
ALTER TABLE page_views ADD COLUMN view_id      text;
ALTER TABLE page_views ADD COLUMN dwell_ms     integer;
ALTER TABLE page_views ADD COLUMN scroll_pct   smallint;
ALTER TABLE page_views ADD COLUMN visitor_pid  text;
CREATE INDEX page_views_view_id ON page_views (view_id);
CREATE INDEX page_views_pid ON page_views (visitor_pid) WHERE visitor_pid IS NOT NULL;
