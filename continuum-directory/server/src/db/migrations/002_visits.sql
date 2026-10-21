-- Public-site page views: the anonymous sibling of login_events. Nobody is
-- identified — only coarse geography (as the load balancer reports it) and a
-- daily-salted hash of IP (+ IP and user-agent) for a rough de-dup within a
-- day. The raw IP is never stored. `via` is 'server' (every request, forwarded
-- by continuum-site) or 'client' (an enrichment beacon from a real browser).
-- Kept the history days, then removed by sweep().
CREATE TABLE page_views (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL,
  day          date NOT NULL,
  path         text NOT NULL,
  referer_host text,
  source       text NOT NULL DEFAULT 'direct',  -- direct | search | social | referral
  via          text NOT NULL DEFAULT 'server',   -- server | client
  browser      text,
  os           text,
  device       text,
  bot          boolean NOT NULL DEFAULT false,
  region       text,                             -- the load balancer's country/region code, when present
  city         text,
  ip_hash      text,                             -- sha256(secret:day:ip), truncated; not linkable across days
  visitor_hash text,                             -- sha256(secret:day:ip|user-agent), truncated; rough daily uniques
  client       jsonb,                            -- what a real browser reports (screen, timezone, language…)
  expire_at    timestamptz NOT NULL
);
CREATE INDEX page_views_at ON page_views (at DESC);
CREATE INDEX page_views_day ON page_views (day);
CREATE INDEX page_views_path ON page_views (path);
CREATE INDEX page_views_expire ON page_views (expire_at);
