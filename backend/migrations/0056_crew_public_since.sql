-- When a crew last became public (backend/src/crew_page.ts CHAT_SINCE_JOIN): someone who joins a public crew after that
-- doesn't read the chat written before it, from its private days. NULL while it has never been public. Crews public now
-- start from the moment this is applied: their members today keep everything, a newcomer from here on reads what follows.
ALTER TABLE crews ADD COLUMN public_since TEXT;
UPDATE crews SET public_since = datetime('now') WHERE visibility = 'public';
