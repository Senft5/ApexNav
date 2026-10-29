-- Factory livery (docs/design/REVIEW.md 5.1): a crew's own hazard categories (e.g. "Cattle grid"), reported as a labelled
-- debris report; the crew's members read the crew's word on the plate, everyone else reads Debris (hazards.ts).
ALTER TABLE crews ADD COLUMN hazard_kinds TEXT NOT NULL DEFAULT '[]';
ALTER TABLE hazard_reports ADD COLUMN label TEXT;
