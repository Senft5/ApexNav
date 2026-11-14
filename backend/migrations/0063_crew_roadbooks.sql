-- A crew's roadbook (docs/SOCIAL.md 2.6, backend/src/roadbooks.ts): a member keeps one of their books with a crew they are
-- in, and every member of that crew can open it and add roads to it. added_by is who put a road in (NULL: the book's owner,
-- as every road before this migration was), so a member can take out their own and For you can say who added it.
-- Additive only. Undo: DROP INDEX roadbooks_crew; ALTER TABLE roadbooks DROP COLUMN crew_id; ALTER TABLE roadbook_roads
-- DROP COLUMN added_by (nothing else reads them).
ALTER TABLE roadbooks ADD COLUMN crew_id TEXT REFERENCES crews(id) ON DELETE SET NULL;
ALTER TABLE roadbook_roads ADD COLUMN added_by TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX roadbooks_crew ON roadbooks(crew_id);
