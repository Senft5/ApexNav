-- Sharing on for existing friends and private crews too (the owner, 2026-11-11: "for those too", after new friendships and
-- private crews became on by default, share_defaults.ts). Data only: a grant with Scores and Times on for each side of every
-- accepted friendship and for every member of a private crew, where no grant row exists yet (INSERT OR IGNORE: a row set
-- since #392, on or off, is kept). Never across a block. Public crews: nothing. The app says so once (People).
-- Undo: there is no way to tell these rows from ones made by a default since; reverting means switching off by hand.
INSERT OR IGNORE INTO grants (user_id, audience_type, audience_id, share_scores, share_times)
  SELECT f.user_a, 'friend', f.user_b, 1, 1 FROM friendships f
   WHERE f.status = 'accepted'
     AND NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.blocker = f.user_a AND k.blocked = f.user_b) OR (k.blocker = f.user_b AND k.blocked = f.user_a));
INSERT OR IGNORE INTO grants (user_id, audience_type, audience_id, share_scores, share_times)
  SELECT f.user_b, 'friend', f.user_a, 1, 1 FROM friendships f
   WHERE f.status = 'accepted'
     AND NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.blocker = f.user_a AND k.blocked = f.user_b) OR (k.blocker = f.user_b AND k.blocked = f.user_a));
INSERT OR IGNORE INTO grants (user_id, audience_type, audience_id, share_scores, share_times)
  SELECT m.user_id, 'crew', m.crew_id, 1, 1 FROM crew_members m JOIN crews c ON c.id = m.crew_id WHERE c.visibility = 'private';
