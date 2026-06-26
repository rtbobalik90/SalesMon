# Brandmon Quest

A Pokémon-style **sales RPG**. Recruit *Brandmons* (living apparel), battle rival reps
by pitching, earn badges, and clear your Week 1 onboarding — all in the browser, with no
build step and no dependencies.

## Play
Open `index.html` in any modern browser. (Or host it free on GitHub Pages — see below.)

**Controls** — Move: WASD / Arrows · A: `Z` or `Space` · B: `X` · Menu: `START` / `Esc`.
Walk into tall grass for wild encounters, into doors to enter buildings, and clear the
Week 1 Journal to unlock the Regional Office.

## Project structure
- `index.html` — shell, styling, on-screen controls (FireRed/LeafGreen look)
- `game.js` — engine: overworld, battles, menus, shop, saves
- `data/content.js` — all content: Brandmons, moves, type chart, items, maps, NPCs
- `art/` — optional drop-in PNG art. The game runs on procedural placeholder art until
  you add your own — see **`art/README.md`** for the full guide.

## Adding your own art
No images are required to run. To use your own, drop PNGs into `art/` and flip one
switch in `game.js`. Full instructions: **`art/README.md`**.

## Host it free (GitHub Pages)
Push this repo to GitHub, then go to **Settings → Pages → Source: `main` / `root`**.
GitHub serves the game at a public URL you can share with your reps — it's a static
site, so there's nothing to build.

## Note
All art and content here are original. Do not add any real brand's logos or trademarked
artwork.
