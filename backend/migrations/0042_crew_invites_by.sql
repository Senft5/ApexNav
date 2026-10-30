-- Who can invite to a crew (REVIEW_PEOPLE.md P-07, backend/src/social.ts). Additive only.
-- 'anyone': every member can make the crew's invite links (the default, existing crews included: Vetta is open, a member
-- can bring a mate). 'owner': only the owner can, and switching to it voids the links other members made.
ALTER TABLE crews ADD COLUMN invites TEXT NOT NULL DEFAULT 'anyone' CHECK (invites IN ('anyone','owner'));
