-- The crew page's stock crest (docs/design/REVIEW.md 5.1, Plain livery): one of the drawn set in web/crew_page.js.
-- crest_photo_id (0030) is the Club tier's own upload; this is the stock one every crew can pick.
ALTER TABLE crews ADD COLUMN crest TEXT;
