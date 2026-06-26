# Brandmon Quest — Art Guide

The game ships with **procedural placeholder art** (drawn in code), so it runs with
zero image files. To use your own art, you don't edit the engine — you just drop PNGs
into this folder and flip a switch.

## 1. Turn a category on
Open `game.js`, near the top find:

```js
var USE_ART = { brandmons: false, tiles: false, characters: false };
```

Set the categories you're working on to `true`. Since you're starting with the
Brandmons, set `brandmons: true`. Anything you haven't drawn yet keeps using the
built-in placeholder, so you can replace sprites one at a time.

## 2. Drop in PNGs with these exact names

### Brandmon sprites  → `art/brandmons/<id>.png`
**64 × 64**, transparent background, front-facing (same sprite is used in battle,
the team list, the Salesdex, and the starter picker). The `<id>` is the key in
`data/content.js` (the `SPECIES` object), **not** the display name:

```
gilbit  gilcrest  comfae  trukket  corpah  mathlux
swyft   ruggard   bellae  nordpeak summitar champer
```
Add a new Brandmon? Add a `SPECIES` entry in `data/content.js`, then drop a matching
`art/brandmons/<newid>.png`. That's it.

### Map tiles  → `art/tiles/<name>.png`
**16 × 16**. Overlay tiles (tree, tall grass, flower, sign, door, and interior props)
are drawn on top of grass/floor, so give those a **transparent** background.

```
grass  tallgrass  tree  water  path  flower  sign  door
roof_hq  roof_shop  roof_gym  wall  hedge  fence          (outdoor)
floor  rug  wall_in  window  counter  shelf  table  plant  mat   (indoor)
```

### Characters  → `art/player_<dir>.png` and `art/npc_<spr>.png`
**16 wide**, up to ~24 tall, transparent, character standing with feet at the bottom
(the engine anchors the image to the bottom of the tile).

```
player_down.png  player_up.png  player_left.png  player_right.png
npc_coach.png  npc_villager.png  npc_rookie.png
npc_director.png  npc_clerk.png  npc_manager.png
```
(NPC sprites are front/`down`-facing only for now — they don't turn.)

## Tips
- **Pixel art** looks best — the screen renders pixelated, so design at the native
  size (16×16 tiles, 64×64 Brandmons) rather than shrinking big images.
- Keep backgrounds **transparent** (PNG alpha) for anything that isn't a full tile.
- Use **original artwork only** — do not use any real brand's logo or trademarked art.
- Missing a file? No problem — it just falls back to the placeholder. Check the
  browser console if a sprite isn't showing (a 404 means the filename doesn't match).
