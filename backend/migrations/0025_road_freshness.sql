-- Freshness (IDEAS Q-12): a bin's averages lean on recent passes once it has many, and two passes in a row reading far
-- smoother than an established bin mean the road was repaved: the bin starts again from them and keeps the day it did.
-- last_on: the newest pass's day (never sent to phones). changed_on: the day a step change reset the bin (sent as a month).
ALTER TABLE road_bins ADD COLUMN last_on TEXT;
ALTER TABLE road_bins ADD COLUMN changed_on TEXT;
ALTER TABLE road_bins ADD COLUMN smooth_run INTEGER NOT NULL DEFAULT 0;
