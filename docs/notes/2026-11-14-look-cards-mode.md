# STATE

## 2026-11-14: the Garage's look cards are drawn in the page's mode
- Garage → Look and voice used to draw every look's card in its day colours. At night, the main look's card was a white block in a dark Garage (seen in the redesign's night shots).
- Now each card takes the page's mode: day by day, night by night, as the car themes already did. The cards are redrawn when the mode turns: `applyTheme`'s idle step calls `renderThemePicker`, and `previewTokens` sets the tokens.
- Newly possible: the night Garage shows each look as you'll actually drive it after dark.
