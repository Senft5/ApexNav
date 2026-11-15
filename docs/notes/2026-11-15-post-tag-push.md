# STATE

## 2026-11-15 A tag on a drive post is a push
- Done: a friend tagged on a post to friends gets a push, "@alice tagged you on a drive." with the post's name as the title, opening the post. Only while they can see the post (POST_SEEN), never the caption. It sits under Comments and mentions in Garage → Settings → Notifications (kind `post_tag`). Tests: vitest "a tag tells each tagged friend".
- Next: none for tags.
