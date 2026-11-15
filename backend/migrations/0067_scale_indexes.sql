-- Launch scale (2026-11-15, tests/test_query_plans.py): the per-message rate checks counted the author's last hour by
-- reading the whole table, and the crew page's house stage read every segment. Indexes only; nothing else changes.
CREATE INDEX IF NOT EXISTS crew_chat_author ON crew_chat(author, created_at);
CREATE INDEX IF NOT EXISTS build_chat_author ON build_chat(author, created_at);
CREATE INDEX IF NOT EXISTS build_replies_author ON build_replies(author, created_at);
CREATE INDEX IF NOT EXISTS segments_canon ON segments(COALESCE(origin_id, id), created_at);
-- deleting a shared route (each share prunes the owner's oldest) cleared these two by reading every row
CREATE INDEX IF NOT EXISTS crew_events_route ON crew_events(route_id) WHERE route_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crews_pinned_route ON crews(pinned_route_id) WHERE pinned_route_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crew_invites_crew ON crew_invites(crew_id);
