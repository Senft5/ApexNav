-- Referral (IDEAS O-07): when someone who joined on a member's invite first shares real road data, both get Octane, once.
-- Paying on a real contribution rather than on sign-up leaves nothing to farm with throwaway accounts.
ALTER TABLE members ADD COLUMN referral_paid INTEGER NOT NULL DEFAULT 0;
