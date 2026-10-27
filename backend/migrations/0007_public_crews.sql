-- 0007: crews can be public (listed for people nearby) or private (invite link only, the default).
-- A public crew has an owner-chosen area: a name and a point rounded to 0.1 degree (about 11 km), never a member's position.
ALTER TABLE crews ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';
ALTER TABLE crews ADD COLUMN about TEXT;
ALTER TABLE crews ADD COLUMN area_name TEXT;
ALTER TABLE crews ADD COLUMN area_lat REAL;
ALTER TABLE crews ADD COLUMN area_lon REAL;
CREATE INDEX crews_public_area ON crews(visibility, area_lat, area_lon);
