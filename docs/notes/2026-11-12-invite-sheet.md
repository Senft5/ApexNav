# STATE

## 2026-11-12 Invite sheet: one link, one handle field

- Done: the Friends Invite sheet had two headings ("New to Vetta", "Already on Vetta"), a note and two link keys whose difference wasn't clear. It is now one solid "Send a friend link" (the one-use invite: a newcomer is your friend when they sign in, a member is asked first), the handle field with Send request, and a small "A link anyone can use" (the reusable ?add= link). The copy toast is one sentence. e2e checks the sheet.
- Next: keep decluttering the social surfaces (Nate 2026-11-12, no walls of text).

# CALL SHEET

## 2026-11-12 The invite link is the friend link for everyone

- What: dropped the New to Vetta / Already on Vetta split; the invite link leads, the ?add= link is a quiet text key.
- Why: an invite link already works for members too (it asks "Add @x?" first, P-02), so the split only made people choose between two links.
- Undo: restore the two `h3` sections in the Invite sheet (`ipop.append`) in web/cockpit.js.
