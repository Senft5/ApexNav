-- 0006: crest is unmeasured (null) on many passes, so its running mean needs its own count (like camber_n in 0003).
-- crest_peak = mean over measuring passes of the bin's peak unweighting in g (0 = none, 1 = weightless), 0..3.
ALTER TABLE road_bins ADD COLUMN crest_n INTEGER NOT NULL DEFAULT 0;
UPDATE road_bins SET crest_n = n WHERE crest_peak IS NOT NULL;
