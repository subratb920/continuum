-- The network a page view came over (as login_events keeps it): IP version, the
-- proxies' chain, protocol, and the load balancer's view (subdivision, round-trip
-- time, TLS) when it passes them. Lets the Visitors admin show each visit's
-- device, location and network, like Sign-ins. Still no raw IP is stored.
ALTER TABLE page_views ADD COLUMN network jsonb;
