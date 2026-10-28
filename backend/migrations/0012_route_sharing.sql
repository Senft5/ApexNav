-- Planned routes shared with friends or crews (IDEAS S-05, docs/SOCIAL.md 2.5). shared_routes (0001) holds the route; this
-- says who may see it. Planned geometry only, never a recorded drive. Routes expire after 30 days (the daily sweep).
CREATE TABLE shared_route_audience (
  route_id      TEXT NOT NULL REFERENCES shared_routes(id) ON DELETE CASCADE,
  audience_type TEXT NOT NULL CHECK (audience_type IN ('friend','crew')),
  audience_id   TEXT NOT NULL,                           -- a user id or a crew id
  PRIMARY KEY (route_id, audience_type, audience_id)
) WITHOUT ROWID;
CREATE INDEX shared_route_audience_who ON shared_route_audience(audience_type, audience_id);
CREATE INDEX shared_routes_owner ON shared_routes(owner, created_at);
