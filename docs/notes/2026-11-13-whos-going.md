# STATE

## Crew drive card: the Going faces open who's going (2026-11-13)
On the crew page, a drive card's faces and "N going" are one key. It opens a sheet listing everyone going, with you shown as
You. Each other name opens that person's member sheet (Add friend, Report, Block), as the members strip does. It is plumbed
as `person` in crew_events `card`/`section` opts, from crew_page `crewMate(c)`. Cards outside a crew page (Drives) keep
plain faces. In e2e, the crew page flow's "I'm going" click is now the switch's `Going` key, because `has-text("going")`
also matched "1 going".
Next: the remembered drive's "Came" faces could open the same list.

# CALL SHEET

## A crew-mate opened from a drive card is shown as a member (2026-11-13)
What: the sheet says "In <crew>" even for the owner, because the drive's going list has no roles.
Why: the crew page object has no owner handle; the same holds for the chat (#640).
Undo: pass the members list into crewMate(c) and look up the role.
