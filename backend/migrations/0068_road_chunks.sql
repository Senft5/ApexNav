-- Packed road data (2026-11-15, Nate chose "Pack bins: fewer writes"). A road_bins row per 5 m bin made each uploaded km
-- write about 210 D1 rows, and Workers Paid includes 50 M rows written a month. Now ROAD_CHUNK (128) bins of one way and
-- direction share a row: their values as JSON, {"<bin_idx % 128>": [n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2,
-- crest_peak, crest_n, last_on, changed_on, smooth_run, k_mean, k_n, flow_mean, brake_mean, flow_n, bump_hit, bump_pass,
-- bump_drivers]} (src/road_pack.ts BIN_COLUMNS), merged in the Worker (road_pack.ts mergeBinRow) and written with a version
-- check (ver). road_bins is now a view over the chunks with the old columns, so every reader is unchanged; its INSTEAD OF
-- triggers keep hand-written inserts and updates (tests, tools) working. The old table stays as road_bins_legacy until the
-- packed data has been checked, then a later migration drops it.
CREATE TABLE road_chunks (
  way_id INTEGER NOT NULL,
  dir    INTEGER NOT NULL,
  chunk  INTEGER NOT NULL,                 -- bin_idx / 128
  ver    INTEGER NOT NULL DEFAULT 0,       -- +1 on every write; a write that read an older ver fails (NOT NULL) and is retried
  bins   TEXT NOT NULL,
  PRIMARY KEY (way_id, dir, chunk)
) WITHOUT ROWID;

ALTER TABLE road_bins RENAME TO road_bins_legacy;

INSERT INTO road_chunks (way_id, dir, chunk, ver, bins)
  SELECT way_id, dir, CAST(bin_idx AS INTEGER) / 128, 0,
         json_group_object(CAST(CAST(bin_idx AS INTEGER) % 128 AS TEXT), json_array(n, camber_mean, camber_m2, camber_n, rough_mean, rough_m2, crest_peak, crest_n, last_on, changed_on,
                                                                   smooth_run, k_mean, k_n, flow_mean, brake_mean, flow_n, bump_hit, bump_pass, bump_drivers))
    FROM (SELECT * FROM road_bins_legacy ORDER BY way_id, dir, bin_idx)
   GROUP BY way_id, dir, CAST(bin_idx AS INTEGER) / 128;

CREATE VIEW road_bins AS
  SELECT c.way_id, c.dir, c.chunk * 128 + CAST(j.key AS INTEGER) AS bin_idx,
         json_extract(j.value, '$[0]') AS n, json_extract(j.value, '$[1]') AS camber_mean, json_extract(j.value, '$[2]') AS camber_m2,
         json_extract(j.value, '$[3]') AS camber_n, json_extract(j.value, '$[4]') AS rough_mean, json_extract(j.value, '$[5]') AS rough_m2,
         json_extract(j.value, '$[6]') AS crest_peak, json_extract(j.value, '$[7]') AS crest_n, json_extract(j.value, '$[8]') AS last_on,
         json_extract(j.value, '$[9]') AS changed_on, json_extract(j.value, '$[10]') AS smooth_run, json_extract(j.value, '$[11]') AS k_mean,
         json_extract(j.value, '$[12]') AS k_n, json_extract(j.value, '$[13]') AS flow_mean, json_extract(j.value, '$[14]') AS brake_mean,
         json_extract(j.value, '$[15]') AS flow_n, json_extract(j.value, '$[16]') AS bump_hit, json_extract(j.value, '$[17]') AS bump_pass,
         json_extract(j.value, '$[18]') AS bump_drivers
    FROM road_chunks c, json_each(c.bins) j;

CREATE TRIGGER road_bins_insert INSTEAD OF INSERT ON road_bins BEGIN INSERT INTO road_chunks (way_id, dir, chunk, bins) VALUES (NEW.way_id, NEW.dir, CAST(NEW.bin_idx AS INTEGER) / 128, json_object(CAST(CAST(NEW.bin_idx AS INTEGER) % 128 AS TEXT), json_array(NEW.n, NEW.camber_mean, NEW.camber_m2, COALESCE(NEW.camber_n, 0), NEW.rough_mean, NEW.rough_m2, NEW.crest_peak, COALESCE(NEW.crest_n, 0), NEW.last_on, NEW.changed_on, COALESCE(NEW.smooth_run, 0), NEW.k_mean, COALESCE(NEW.k_n, 0), NEW.flow_mean, NEW.brake_mean, COALESCE(NEW.flow_n, 0), COALESCE(NEW.bump_hit, 0), COALESCE(NEW.bump_pass, 0), COALESCE(NEW.bump_drivers, 0)))) ON CONFLICT (way_id, dir, chunk) DO UPDATE SET bins = json_set(bins, '$."' || (CAST(NEW.bin_idx AS INTEGER) % 128) || '"', json_array(NEW.n, NEW.camber_mean, NEW.camber_m2, COALESCE(NEW.camber_n, 0), NEW.rough_mean, NEW.rough_m2, NEW.crest_peak, COALESCE(NEW.crest_n, 0), NEW.last_on, NEW.changed_on, COALESCE(NEW.smooth_run, 0), NEW.k_mean, COALESCE(NEW.k_n, 0), NEW.flow_mean, NEW.brake_mean, COALESCE(NEW.flow_n, 0), COALESCE(NEW.bump_hit, 0), COALESCE(NEW.bump_pass, 0), COALESCE(NEW.bump_drivers, 0))), ver = ver + 1; END;

CREATE TRIGGER road_bins_update INSTEAD OF UPDATE ON road_bins BEGIN UPDATE road_chunks SET bins = json_set(bins, '$."' || (CAST(OLD.bin_idx AS INTEGER) % 128) || '"', json_array(NEW.n, NEW.camber_mean, NEW.camber_m2, NEW.camber_n, NEW.rough_mean, NEW.rough_m2, NEW.crest_peak, NEW.crest_n, NEW.last_on, NEW.changed_on, NEW.smooth_run, NEW.k_mean, NEW.k_n, NEW.flow_mean, NEW.brake_mean, NEW.flow_n, NEW.bump_hit, NEW.bump_pass, NEW.bump_drivers)), ver = ver + 1 WHERE way_id = OLD.way_id AND dir = OLD.dir AND chunk = CAST(OLD.bin_idx AS INTEGER) / 128; END;

CREATE TRIGGER road_bins_delete INSTEAD OF DELETE ON road_bins BEGIN UPDATE road_chunks SET bins = json_remove(bins, '$."' || (CAST(OLD.bin_idx AS INTEGER) % 128) || '"'), ver = ver + 1 WHERE way_id = OLD.way_id AND dir = OLD.dir AND chunk = CAST(OLD.bin_idx AS INTEGER) / 128; DELETE FROM road_chunks WHERE way_id = OLD.way_id AND dir = OLD.dir AND chunk = CAST(OLD.bin_idx AS INTEGER) / 128 AND bins = '{}'; END;
