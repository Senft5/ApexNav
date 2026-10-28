-- Car-aware routing (IDEAS R-20): ride height (a lowered car stays off unpaved roads) and width with mirrors (the router
-- keeps to roads whose posted width fits). Both optional; unknown changes nothing.
ALTER TABLE cars ADD COLUMN clearance TEXT CHECK (clearance IN ('low','stock','high'));
ALTER TABLE cars ADD COLUMN width_cm INTEGER;
