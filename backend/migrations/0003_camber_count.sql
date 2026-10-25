-- 0003: camber may be unmeasured (null) on some passes, so its running mean needs its own count.
ALTER TABLE road_bins ADD COLUMN camber_n INTEGER NOT NULL DEFAULT 0;
