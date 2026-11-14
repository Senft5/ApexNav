-- A clip or a photo on a drive post (docs/SOCIAL.md 2.13, backend/src/post_media.ts): the bytes are in R2 (MEDIA,
-- post/<post id>); this is what they are, JSON {kind: "clip" | "photo", mime, bytes, label}, or NULL for none.
ALTER TABLE drive_posts ADD COLUMN media TEXT;
