/* =====================================================================
   BRANDMON QUEST — game.js  (engine)
   Tile overworld + FRLG-style battle, menus, shop, save. Vanilla JS.
   Runs on procedural art (no external PNGs required).
   ===================================================================== */
(function () {
  'use strict';
  var C = window.CONTENT;
  var SPECIES = C.SPECIES, MOVES = C.MOVES, ITEMS = C.ITEMS, MAPS = C.MAPS;
  var TYPECOLORS = C.TYPECOLORS, typeMult = C.typeMult, JOURNAL = C.JOURNAL;
  var SHOP_STOCK = C.SHOP_STOCK, STARTERS = C.STARTERS;

  /* ---------- DOM ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('screen'), ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  var elMoney = $('money'), elBadge = $('badgeCount');
  var elToast = $('toast');
  var elDlg = $('dialogue'), elDlgText = $('dlgText');
  var elMenuRoot = $('menuRoot'), elMenuList = $('menuList');
  var elShop = $('shopPanel'), elShopMoney = $('shopMoney'), elShopList = $('shopList');
  var elBattle = $('battle'), elBMsg = $('battleMsg'), elBMenu = $('battleMenu');
  var elStarter = $('starter'), elStarterRow = $('starterRow');

  var TILE = 16, VIEW_W = 15, VIEW_H = 11;
  var VW = VIEW_W * TILE, VH = VIEW_H * TILE; // 240 x 176
  canvas.width = VW; canvas.height = VH;

  var SAVE_KEY = 'brandmon_quest_save_v2';

  /* ====================================================================
     ART HOOKS — swap the procedural placeholders for your own PNGs.
     1) Flip a category below to true.
     2) Drop PNGs into art/ using the names in art/README.md.
     Missing files silently fall back to the built-in placeholder art,
     so you can replace one sprite at a time.
     ==================================================================== */
  var USE_ART = { brandmons: false, tiles: false, characters: false };

  /* ---------- Game state ---------- */
  var G = null;
  function freshState() {
    return {
      map: 'town', tx: 11, ty: 12, dir: 'down',
      px: 11 * TILE, py: 12 * TILE,
      team: [], box: [], bag: { energyDrink: 3, sampleCase: 3 },
      money: 1500, badges: 0, badgeNames: [],
      dex: { seen: {}, caught: {} }, flags: {},
    };
  }

  /* movement/runtime (not saved) */
  var moving = false, moveT = 0, fromPx = 0, fromPy = 0, toPx = 0, toPy = 0, toTx = 0, toTy = 0;
  var held = { up: false, down: false, left: false, right: false };
  var mode = 'world';        // world|dialogue|menu|sheet|shop|starter|battle
  var tick = 0, walkAnim = 0;

  /* ---------- helpers ---------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function ri(a, b) { return Math.floor(rnd(a, b + 1)); }
  function curMap() { return MAPS[G.map]; }
  function tileAt(m, x, y) { var r = m.grid[y]; return r ? (r[x] || ' ') : ' '; }
  function ahead(x, y, d) { return d === 'up' ? [x, y - 1] : d === 'down' ? [x, y + 1] : d === 'left' ? [x - 1, y] : [x + 1, y]; }

  function isSolid(m, x, y) {
    if (y < 0 || y >= m.grid.length) return true;
    var ch = tileAt(m, x, y);
    if (ch === ' ') return true;
    var set = m.interior ? C.SOLID_INTERIOR : C.SOLID_OVERWORLD;
    return set.indexOf(ch) !== -1;
  }
  function npcAt(m, x, y) {
    if (!m.npcs) return null;
    for (var i = 0; i < m.npcs.length; i++) if (m.npcs[i].x === x && m.npcs[i].y === y) return m.npcs[i];
    return null;
  }
  function warpAt(m, x, y) {
    if (!m.warps) return null;
    for (var i = 0; i < m.warps.length; i++) if (m.warps[i].x === x && m.warps[i].y === y) return m.warps[i];
    return null;
  }
  function signAt(m, x, y) {
    if (!m.signs) return null;
    for (var i = 0; i < m.signs.length; i++) if (m.signs[i].x === x && m.signs[i].y === y) return m.signs[i];
    return null;
  }
  function walkable(m, x, y) {
    if (isSolid(m, x, y)) return false;
    if (npcAt(m, x, y)) return false;
    return true;
  }

  /* ---------- mon factory / stats ---------- */
  function recompute(mon) {
    var b = SPECIES[mon.species].base, old = mon.maxHp || 0, L = mon.level;
    mon.maxHp = Math.floor(b.hp * 2 * L / 100) + L + 10;
    mon.atk = Math.floor(b.atk * 2 * L / 100) + 5;
    mon.def = Math.floor(b.def * 2 * L / 100) + 5;
    mon.spd = Math.floor(b.spd * 2 * L / 100) + 5;
    if (old) mon.hp = Math.min(mon.maxHp, mon.hp + (mon.maxHp - old)); else mon.hp = mon.maxHp;
  }
  function makeMon(id, level) {
    var sp = SPECIES[id], m = { species: id, level: level, exp: 0 };
    recompute(m); m.hp = m.maxHp;
    m.moves = sp.moves.slice(0, 4).map(function (mid) { return { id: mid, pp: MOVES[mid].pp, max: MOVES[mid].pp }; });
    return m;
  }
  function expToNext(level) { return level * 18 + 24; }
  function nameOf(mon) { return mon.nick || SPECIES[mon.species].name; }
  function firstHealthy() { for (var i = 0; i < G.team.length; i++) if (G.team[i].hp > 0) return i; return -1; }
  function teamWiped() { return firstHealthy() === -1; }
  function healTeam() { G.team.forEach(function (m) { m.hp = m.maxHp; m.moves.forEach(function (mv) { mv.pp = mv.max; }); }); }

  /* ---------- save / load ---------- */
  function save() {
    var d = { map: G.map, tx: G.tx, ty: G.ty, dir: G.dir, team: G.team, box: G.box, bag: G.bag,
      money: G.money, badges: G.badges, badgeNames: G.badgeNames, dex: G.dex, flags: G.flags };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
      var d = JSON.parse(raw); G = freshState();
      for (var k in d) G[k] = d[k];
      G.px = G.tx * TILE; G.py = G.ty * TILE;
      return G.team && G.team.length > 0;
    } catch (e) { return false; }
  }

  /* ---------- HUD ---------- */
  function updateHUD() { elMoney.textContent = G.money; elBadge.textContent = G.badges; }

  /* ---------- toast ---------- */
  var toastTimer = null;
  function toast(msg) {
    elToast.textContent = msg; elToast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { elToast.classList.remove('show'); }, 2200);
  }

  /* ---------- dialogue ---------- */
  var dlgQ = [], dlgDone = null;
  function say(lines, done) {
    dlgQ = (typeof lines === 'string') ? [lines] : lines.slice();
    dlgDone = done || null; mode = 'dialogue';
    elDlg.classList.remove('hidden'); nextLine();
  }
  function nextLine() {
    if (dlgQ.length === 0) { elDlg.classList.add('hidden'); var d = dlgDone; dlgDone = null; mode = 'world'; if (d) d(); return; }
    elDlgText.textContent = dlgQ.shift();
  }

  /* =====================================================================
     RENDERING
     ===================================================================== */
  function camera() {
    var m = curMap(), mw = m.grid[0].length * TILE, mh = m.grid.length * TILE;
    var cx, cy;
    cx = (mw <= VW) ? (mw - VW) / 2 : clamp(G.px + 8 - VW / 2, 0, mw - VW);
    cy = (mh <= VH) ? (mh - VH) / 2 : clamp(G.py + 8 - VH / 2, 0, mh - VH);
    return { x: Math.round(cx), y: Math.round(cy) };
  }

  function render() {
    var m = curMap(), cam = camera();
    ctx.fillStyle = m.interior ? '#241c12' : '#3a6b3a';
    ctx.fillRect(0, 0, VW, VH);
    var x0 = Math.floor(cam.x / TILE) - 1, y0 = Math.floor(cam.y / TILE) - 1;
    for (var y = y0; y < y0 + VIEW_H + 2; y++) {
      for (var x = x0; x < x0 + VIEW_W + 2; x++) {
        var sx = x * TILE - cam.x, sy = y * TILE - cam.y;
        drawTile(m, tileAt(m, x, y), sx, sy, x, y);
      }
    }
    // NPCs
    if (m.npcs) m.npcs.forEach(function (n) {
      if (n.defeatedHidden) return;
      drawPerson(n.x * TILE - cam.x, n.y * TILE - cam.y, n.dir, PAL[n.spr] || PAL.villager, 0, n.spr);
    });
    // player (centered-ish; draw at world pos)
    drawPerson(Math.round(G.px - cam.x), Math.round(G.py - cam.y), G.dir, PAL.player, moving ? walkAnim : 0, 'player');
    // tree tops overlay (so player can stand "behind" trunks) — keep simple
  }

  /* ---------- art loader (lazy; only requests a file when its category is on) ---------- */
  var IMG = {};
  function getImg(path) {
    var e = IMG[path];
    if (e) return e.ready ? e.img : null;
    e = IMG[path] = { ready: false }; var img = new Image(); e.img = img;
    img.onload = function () { e.ready = true; };
    img.onerror = function () { e.failed = true; };
    img.src = path;
    return null;
  }
  // tile char -> art/tiles/<name>.png
  var TILEART = {
    '.': 'grass', ',': 'tallgrass', 'T': 'tree', 'W': 'water', 'P': 'path',
    'F': 'flower', 'S': 'sign', 'd': 'door', 'B': 'roof_hq', 'R': 'roof_shop', 'G': 'roof_gym',
    'w': 'wall', 'H': 'hedge', 'f': 'fence', 'o': 'floor', 'm': 'rug', '#': 'wall_in',
    '=': 'window', 'c': 'counter', 'b': 'shelf', 'l': 'table', 'p': 'plant', 'x': 'mat'
  };
  function preloadArt() {
    var k;
    if (USE_ART.brandmons) for (k in SPECIES) getImg('art/brandmons/' + k + '.png');
    if (USE_ART.tiles) for (k in TILEART) getImg('art/tiles/' + TILEART[k] + '.png');
    if (USE_ART.characters) {
      ['down', 'up', 'left', 'right'].forEach(function (d) { getImg('art/player_' + d + '.png'); });
      ['coach', 'villager', 'rookie', 'director', 'clerk', 'manager'].forEach(function (s) { getImg('art/npc_' + s + '.png'); });
    }
  }

  /* tile art — bright FireRed/LeafGreen-ish placeholders (used until you add PNGs) */
  function drawTile(m, ch, x, y, wx, wy) {
    if (USE_ART.tiles) {
      var ta = TILEART[ch];
      if (ta) {
        var base = getImg('art/tiles/' + ta + '.png');
        if (base) {
          if ('T,FSd'.indexOf(ch) !== -1) grass(x, y, wx, wy);        // draw grass under transparent overlays
          else if ('mcblpx='.indexOf(ch) !== -1) floor(x, y, wx, wy);  // draw floor under interior props
          ctx.drawImage(base, x, y, TILE, TILE);
          return;
        }
      }
    }
    switch (ch) {
      case '.': case 'F': case ',': case 'S': case 'd': grass(x, y, wx, wy); break;
      case 'P': path(x, y, m, wx, wy); break;
      case 'W': water(x, y); break;
      case 'T': grass(x, y, wx, wy); tree(x, y); break;
      case 'B': roof(x, y, m, wx, wy, '#4f7fd6', '#3a5fa8'); break;
      case 'R': roof(x, y, m, wx, wy, '#d05a4a', '#a8412f'); break;
      case 'G': roof(x, y, m, wx, wy, '#caa53a', '#9c7f24'); break;
      case 'w': wall(x, y); break;
      case 'H': hedge(x, y); break;
      case 'f': fence(x, y); break;
      // interiors
      case 'o': floor(x, y, wx, wy); break;
      case 'm': floor(x, y, wx, wy); rug(x, y); break;
      case '#': iwall(x, y, m, wx, wy); break;
      case '=': iwall(x, y, m, wx, wy); window2(x, y); break;
      case 'c': floor(x, y, wx, wy); counter(x, y); break;
      case 'b': floor(x, y, wx, wy); shelf(x, y); break;
      case 'l': floor(x, y, wx, wy); table(x, y); break;
      case 'p': floor(x, y, wx, wy); plant(x, y); break;
      case 'x': floor(x, y, wx, wy); exitmat(x, y); break;
      default: ctx.fillStyle = m && m.interior ? '#241c12' : '#3a6b3a'; ctx.fillRect(x, y, TILE, TILE);
    }
    // overlays that sit on grass
    if (ch === 'F') flower(x, y, wx, wy);
    if (ch === ',') tallgrass(x, y, wx, wy);
    if (ch === 'S') sign(x, y);
    if (ch === 'd') door(x, y);
  }

  function px(c, x, y, w, h) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }
  function grass(x, y, wx, wy) {
    px('#74c264', x, y, TILE, TILE);
    px('#69b85a', x + ((wx * 7 + wy * 3) % 3) * 5, y + ((wx + wy * 5) % 3) * 5, 3, 2);
    px('#7fcf6c', x + 10 - ((wx + wy) % 2) * 6, y + 9, 2, 2);
  }
  function path(x, y, m, wx, wy) {
    px('#dcc79a', x, y, TILE, TILE);
    px('#cbb585', x, y, TILE, 2); px('#cbb585', x, y, 2, TILE);
    px('#e8d6ab', x + 3, y + 4, 2, 2); px('#cbb585', x + 9, y + 10, 2, 2);
  }
  function water(x, y) {
    px('#3f9ad8', x, y, TILE, TILE);
    px('#5bb0e6', x, y, TILE, 4);
    var s = (tick >> 4) % 2 === 0 ? 0 : 6;
    px('#bfe6fb', x + 2 + s, y + 8, 4, 1); px('#bfe6fb', x + 9 - s, y + 12, 4, 1);
  }
  function tree(x, y) {
    px('#7a4a26', x + 6, y + 9, 4, 7);                    // trunk
    px('#2f7d33', x + 1, y - 2, 14, 12);                  // canopy
    px('#3f9a40', x + 2, y - 1, 12, 6);
    px('#56b85a', x + 3, y, 6, 3);
    px('#266b2a', x + 1, y + 8, 14, 3);
  }
  function roof(x, y, m, wx, wy, c1, c2) {
    px(c2, x, y, TILE, TILE);
    px(c1, x, y, TILE, 9);
    // ridge highlight if top edge
    if (tileAt(m, wx, wy - 1) !== tileAt(m, wx, wy)) px('#ffffff', x, y, TILE, 2);
    px(c2, x, y + 9, TILE, 2);
    px('rgba(255,255,255,.15)', x + 2, y + 3, TILE - 4, 1);
  }
  function wall(x, y) {
    px('#e7d3ad', x, y, TILE, TILE);
    px('#cdb488', x, y, TILE, 2);
    px('#bfa477', x, y + TILE - 2, TILE, 2);
  }
  function door(x, y) {
    px('#e7d3ad', x, y, TILE, TILE);
    px('#5a3a22', x + 3, y + 2, 10, 14);
    px('#7a5232', x + 4, y + 3, 8, 12);
    px('#f2c14e', x + 9, y + 9, 2, 2);                    // knob
    px('#caa86a', x + 3, y + 13, 10, 3);                  // mat
  }
  function hedge(x, y) { px('#3f8f3f', x, y, TILE, TILE); px('#56b05a', x, y, TILE, 4); px('#2e7a32', x + 2, y + 9, TILE - 4, 4); }
  function fence(x, y) { px('#74c264', x, y, TILE, TILE); px('#caa86a', x + 1, y + 4, TILE - 2, 3); px('#caa86a', x + 2, y + 2, 3, 10); px('#caa86a', x + 11, y + 2, 3, 10); }
  function flower(x, y, wx, wy) {
    var cols = ['#e8556d', '#f2c14e', '#e87fb0', '#7fa6ff'], c = cols[(wx * 3 + wy) % 4];
    px(c, x + 5, y + 6, 5, 5); px('#fff2c2', x + 7, y + 8, 1, 1);
    px(c, x + 10, y + 10, 3, 3);
  }
  function tallgrass(x, y, wx, wy) {
    var sway = (tick >> 5) % 2 === 0 ? 0 : 1;
    px('#3f9a40', x, y + 8, TILE, 8);
    px('#56b85a', x + 1 + sway, y + 6, 3, 8); px('#56b85a', x + 6 - sway, y + 5, 3, 9); px('#56b85a', x + 11 + sway, y + 6, 3, 8);
    px('#2e7a32', x, y + 13, TILE, 3);
  }
  function sign(x, y) { px('#7a5232', x + 7, y + 8, 3, 8); px('#a9743c', x + 2, y + 2, 12, 8); px('#8a5a2b', x + 2, y + 2, 12, 2); px('#5a3a22', x + 4, y + 5, 8, 1); px('#5a3a22', x + 4, y + 7, 6, 1); }
  /* interiors */
  function floor(x, y, wx, wy) { px('#e9d6b0', x, y, TILE, TILE); px('#dcc79a', x, y + TILE - 1, TILE, 1); px('#dcc79a', x + TILE - 1, y, 1, TILE); if ((wx + wy) % 2) px('#e0cca2', x, y, TILE, TILE); }
  function rug(x, y) { px('#c0413a', x + 1, y + 1, TILE - 2, TILE - 2); px('#e0655a', x + 2, y + 2, TILE - 4, 2); px('#9c2f2a', x + 1, y + TILE - 3, TILE - 2, 2); }
  function iwall(x, y, m, wx, wy) { px('#7a6648', x, y, TILE, TILE); px('#8f7a58', x, y, TILE, 6); px('#5f4e36', x, y + TILE - 3, TILE, 3); }
  function window2(x, y) { px('#a9d6f0', x + 3, y + 3, 10, 7); px('#cdeaff', x + 3, y + 3, 10, 2); px('#5f7f9a', x + 7, y + 3, 1, 7); }
  function counter(x, y) { px('#9c6b34', x, y + 2, TILE, TILE - 2); px('#b9854a', x, y, TILE, 4); px('#7a5226', x, y + TILE - 3, TILE, 3); }
  function shelf(x, y) { px('#8a6a3a', x, y, TILE, TILE); px('#caa86a', x + 1, y + 2, TILE - 2, 3); px('#caa86a', x + 1, y + 8, TILE - 2, 3); px('#e8556d', x + 2, y + 3, 2, 2); px('#7fa6ff', x + 6, y + 3, 2, 2); px('#f2c14e', x + 10, y + 9, 2, 2); }
  function table(x, y) { px('#9c6b34', x, y + 4, TILE, 8); px('#b9854a', x, y + 4, TILE, 2); }
  function plant(x, y) { px('#7a5232', x + 4, y + 9, 8, 6); px('#2f8f4f', x + 2, y + 1, 12, 10); px('#46b06a', x + 4, y + 2, 6, 5); }
  function exitmat(x, y) { px('#caa86a', x + 1, y + 5, TILE - 2, 8); px('#9c8048', x + 1, y + 5, TILE - 2, 2); }

  /* ---------- character sprites ---------- */
  var PAL = {
    player:  { skin: '#f1c79b', hair: '#5a3a22', top: '#2f63c0', bottom: '#39404e' },
    director:{ skin: '#e6b489', hair: '#39393f', top: '#26304a', bottom: '#1a2030' },
    clerk:   { skin: '#f1c79b', hair: '#7a4a2a', top: '#2f8f6f', bottom: '#33373f' },
    coach:   { skin: '#d99a6a', hair: '#222222', top: '#c0392b', bottom: '#2a2a2a' },
    villager:{ skin: '#f0c79b', hair: '#caa23a', top: '#e0a92e', bottom: '#5a4a2a' },
    rookie:  { skin: '#eebd92', hair: '#8a5a2b', top: '#e2722e', bottom: '#3a3550', cap: '#e2722e' },
    manager: { skin: '#e6b487', hair: '#5a3a6a', top: '#5a3a8a', bottom: '#2a2040' },
  };
  function drawPerson(x, y, dir, p, anim, key) {
    if (USE_ART.characters && key) {
      var im = getImg(key === 'player' ? ('art/player_' + dir + '.png') : ('art/npc_' + key + '.png'));
      if (im) {
        px('rgba(0,0,0,.22)', x + 3, y + 15, 10, 3);
        var ih = Math.round(im.naturalHeight * (16 / (im.naturalWidth || 16))) || 16;
        ctx.drawImage(im, x, y + 16 - ih, 16, ih);
        return;
      }
    }
    var bob = (anim && (Math.floor(anim * 4) % 2)) ? 1 : 0;
    // shadow
    px('rgba(0,0,0,.22)', x + 3, y + 14, 10, 3);
    // legs
    px(p.bottom, x + 4, y + 11 - 0, 3, 4 + (bob ? 0 : 1));
    px(p.bottom, x + 9, y + 11, 3, 4 + (bob ? 1 : 0));
    // body
    px(p.top, x + 3, y + 6, 10, 7);
    px('rgba(255,255,255,.12)', x + 3, y + 6, 10, 2);
    // head
    px(p.skin, x + 4, y, 8, 7);
    // hair / cap by direction
    var hc = p.cap || p.hair;
    if (dir === 'up') { px(p.hair, x + 4, y, 8, 6); }
    else {
      px(hc, x + 3, y - 1, 10, 4);
      if (dir === 'left') px(hc, x + 3, y, 3, 5);
      if (dir === 'right') px(hc, x + 10, y, 3, 5);
      // eyes
      if (dir === 'down') { px('#23222a', x + 5, y + 4, 1, 2); px('#23222a', x + 10, y + 4, 1, 2); }
      if (dir === 'left') { px('#23222a', x + 5, y + 4, 1, 2); }
      if (dir === 'right') { px('#23222a', x + 10, y + 4, 1, 2); }
    }
    if (p.cap) px('#fff', x + 6, y + 1, 4, 1);
  }

  /* =====================================================================
     BRANDMON BATTLE SPRITES (procedural apparel-creatures, 64x64)
     ===================================================================== */
  function brandmonCanvas(id) {
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    cv.className = 'sprImg'; var g = cv.getContext('2d'); g.imageSmoothingEnabled = false;
    drawBrandmon(g, SPECIES[id], id); return cv;
  }
  function rr(g, c, x, y, w, h) { g.fillStyle = c; g.fillRect(x | 0, y | 0, w | 0, h | 0); }
  function eyes(g, x, y, gap) {
    rr(g, '#fff', x, y, 6, 7); rr(g, '#fff', x + gap, y, 6, 7);
    rr(g, '#23222a', x + 2, y + 2, 3, 3); rr(g, '#23222a', x + gap + 1, y + 2, 3, 3);
    rr(g, '#fff', x + 3, y + 2, 1, 1); rr(g, '#fff', x + gap + 2, y + 2, 1, 1);
  }
  function shade(g, x, y, w, h) { g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x, y, w, h); }
  function hi(g, x, y, w, h) { g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x, y, w, h); }
  function drawBrandmon(g, sp, id) {
    g.clearRect(0, 0, 64, 64);
    if (USE_ART.brandmons && id) {
      var im = getImg('art/brandmons/' + id + '.png');
      if (im) { g.drawImage(im, 0, 0, 64, 64); return; }
    }
    var c = sp.color, a = sp.accent;
    g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(14, 56, 36, 5);
    switch (sp.shape) {
      case 'tee': case 'tee2':
        rr(g, c, 12, 16, 40, 34); rr(g, c, 6, 18, 12, 14); rr(g, c, 46, 18, 12, 14); // sleeves
        rr(g, a, 24, 14, 16, 8); rr(g, a, 22, 16, 4, 6); rr(g, a, 38, 16, 4, 6);      // collar
        hi(g, 14, 18, 36, 3); shade(g, 12, 44, 40, 6);
        if (sp.shape === 'tee2') { rr(g, a, 27, 30, 10, 10); rr(g, c, 29, 32, 6, 6); }
        eyes(g, 21, 30, 16); rr(g, '#23222a', 29, 42, 6, 2);
        break;
      case 'fairy':
        rr(g, '#fff', 6, 26, 12, 10); rr(g, '#fff', 46, 26, 12, 10);                 // wings
        rr(g, c, 16, 18, 32, 30); rr(g, c, 12, 26, 8, 16); rr(g, c, 44, 26, 8, 16);
        rr(g, c, 22, 12, 20, 10); hi(g, 18, 20, 26, 4);
        rr(g, a, 14, 14, 4, 4); rr(g, a, 46, 16, 4, 4);
        eyes(g, 23, 28, 14); rr(g, '#d96a8e', 28, 40, 8, 3);
        break;
      case 'cap':
        rr(g, c, 12, 22, 40, 24); rr(g, '#3a2a1a', 8, 40, 48, 8);                     // brim
        rr(g, c, 16, 14, 32, 12); hi(g, 18, 16, 28, 3);
        rr(g, a, 26, 12, 12, 8);
        for (var i = 0; i < 5; i++) rr(g, 'rgba(0,0,0,.12)', 16 + i * 7, 26, 2, 12);  // mesh
        eyes(g, 22, 30, 16); break;
      case 'polo':
        rr(g, c, 12, 18, 40, 32); rr(g, c, 6, 20, 10, 12); rr(g, c, 48, 20, 10, 12);
        rr(g, a, 22, 12, 8, 12); rr(g, a, 34, 12, 8, 12);                              // collar wings
        rr(g, a, 30, 22, 4, 18); rr(g, a, 31, 26, 2, 2); rr(g, a, 31, 32, 2, 2);       // placket+buttons
        hi(g, 14, 20, 36, 3); eyes(g, 19, 30, 18); break;
      case 'lux':
        rr(g, c, 16, 20, 32, 30); rr(g, c, 10, 22, 44, 8);                            // draped
        rr(g, a, 24, 10, 16, 10); rr(g, a, 22, 8, 4, 6); rr(g, a, 30, 6, 4, 8); rr(g, a, 38, 8, 4, 6); // crown
        for (var j = 0; j < 3; j++) rr(g, 'rgba(255,255,255,.3)', 20 + j * 9, 30, 2, 14);
        rr(g, a, 31, 44, 4, 4); eyes(g, 22, 30, 16); break;
      case 'athletic':
        rr(g, c, 14, 16, 36, 34); rr(g, c, 8, 18, 10, 12); rr(g, c, 46, 18, 10, 12);
        g.fillStyle = a; g.beginPath(); g.moveTo(34, 20); g.lineTo(26, 34); g.lineTo(32, 34); g.lineTo(26, 48); g.lineTo(40, 30); g.lineTo(33, 30); g.closePath(); g.fill();
        rr(g, a, 14, 44, 36, 3); hi(g, 16, 18, 32, 3);
        eyes(g, 19, 24, 18); break;
      case 'boot':
        rr(g, c, 18, 12, 20, 30); rr(g, c, 18, 40, 34, 12);                           // shaft + foot
        rr(g, '#2c2018', 16, 50, 40, 6); rr(g, a, 18, 46, 30, 4);                      // sole
        for (var k = 0; k < 4; k++) { rr(g, '#2c2018', 22, 16 + k * 6, 12, 2); }       // laces
        rr(g, a, 20, 14, 16, 2); eyes(g, 22, 22, 12); break;
      case 'dress':
        g.fillStyle = c; g.beginPath(); g.moveTo(32, 14); g.lineTo(20, 52); g.lineTo(44, 52); g.closePath(); g.fill();
        rr(g, c, 26, 12, 12, 10); rr(g, a, 28, 10, 8, 4);
        rr(g, a, 26, 26, 12, 3); rr(g, a, 29, 18, 2, 6); rr(g, a, 33, 18, 2, 6);
        rr(g, a, 30, 30, 4, 4); hi(g, 28, 16, 8, 2); eyes(g, 26, 18, 8); break;
      case 'jacket': case 'jacket2':
        rr(g, c, 12, 16, 40, 34); rr(g, c, 6, 18, 10, 14); rr(g, c, 48, 18, 10, 14);
        rr(g, '#cfcfcf', 30, 16, 4, 34);                                              // zipper
        for (var z = 0; z < 7; z++) rr(g, '#9a9a9a', 31, 18 + z * 4, 2, 2);
        rr(g, a, 22, 12, 8, 8); rr(g, a, 34, 12, 8, 8); hi(g, 14, 18, 36, 3);
        if (sp.shape === 'jacket2') { g.fillStyle = a; g.beginPath(); g.moveTo(40, 40); g.lineTo(45, 30); g.lineTo(50, 40); g.closePath(); g.fill(); }
        eyes(g, 18, 28, 18); break;
      case 'hoodie':
        rr(g, c, 12, 18, 40, 34); rr(g, c, 6, 20, 10, 14); rr(g, c, 48, 20, 10, 14);
        rr(g, c, 16, 10, 32, 12); rr(g, '#9c1f1f', 20, 14, 24, 8);                     // hood
        rr(g, a, 24, 22, 3, 12); rr(g, a, 37, 22, 3, 12);                              // drawstrings
        rr(g, '#9c1f1f', 22, 38, 20, 8);                                              // pocket
        g.fillStyle = a; g.beginPath(); g.moveTo(32, 24); g.lineTo(34, 29); g.lineTo(39, 29); g.lineTo(35, 32); g.lineTo(37, 37); g.lineTo(32, 34); g.lineTo(27, 37); g.lineTo(29, 32); g.lineTo(25, 29); g.lineTo(30, 29); g.closePath(); g.fill(); // star
        eyes(g, 22, 14, 16); break;
      default:
        rr(g, c, 14, 16, 36, 34); eyes(g, 22, 28, 16);
    }
  }

  /* =====================================================================
     MOVEMENT + INTERACTION
     ===================================================================== */
  function tryStep(dir) {
    if (moving || mode !== 'world') return;
    G.dir = dir;
    var t = ahead(G.tx, G.ty, dir), nx = t[0], ny = t[1], m = curMap();
    var w = warpAt(m, nx, ny);
    if (w && w.locked && !G.flags.gymUnlocked) { say(['The Regional Office is closed.', 'Finish your Week 1 Journal first, rep.']); return; }
    if (!walkable(m, nx, ny)) { return; } // bump: just face
    moving = true; moveT = 0; fromPx = G.px; fromPy = G.py; toTx = nx; toTy = ny; toPx = nx * TILE; toPy = ny * TILE;
  }
  function arrive() {
    G.tx = toTx; G.ty = toTy; G.px = toPx; G.py = toPy; moving = false;
    var m = curMap(), w = warpAt(m, G.tx, G.ty);
    if (w && !(w.locked && !G.flags.gymUnlocked)) { doWarp(w); return; }
    // encounter check
    if (tileAt(m, G.tx, G.ty) === ',' && m.encounters && m.encounters.length) {
      if (Math.random() < 0.13) { startWild(m); return; }
    }
    save();
  }
  function doWarp(w) {
    G.map = w.to; G.tx = w.tx; G.ty = w.ty; G.dir = w.dir || 'down';
    G.px = G.tx * TILE; G.py = G.ty * TILE; moving = false;
    if (w.to === 'shop' && !G.flags.visitedShop) { setFlag('visitedShop'); }
    save();
  }

  function interact() {
    if (moving) return;
    var m = curMap(), t = ahead(G.tx, G.ty, G.dir), nx = t[0], ny = t[1];
    var n = npcAt(m, nx, ny);
    if (n) { faceToward(n); talkNpc(n); return; }
    var s = signAt(m, nx, ny);
    if (s) { say(s.text.split('\n')); return; }
    // talk over a counter (clerk one tile beyond)
    if (tileAt(m, nx, ny) === 'c') { var n2 = npcAt(m, nx, ny - 1); if (n2) { talkNpc(n2); return; } }
  }
  function faceToward(n) { var dx = G.tx - n.x, dy = G.ty - n.y; n.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); }

  function talkNpc(n) {
    if (n.battle && !G.flags['beat_' + n.id]) {
      say([n.battle.name + ': ' + n.battle.intro], function () { startTrainer(n); });
      return;
    }
    var lines = (n.battle && G.flags['beat_' + n.id]) ? (n.battle.after || n.lines) : n.lines;
    say(lines.slice(), function () {
      if (n.onTalk === 'heal') { healTeam(); toast('Your team is pepped up!'); updateHUD(); save(); }
      else if (n.onTalk === 'shop') { openShop(); }
    });
  }

  /* =====================================================================
     OVERWORLD MENU + SHEETS
     ===================================================================== */
  var menuItems = ['TEAM', 'BAG', 'SALESDEX', 'JOURNAL', 'SAVE', 'NEW GAME', 'CLOSE'];
  var menuSel = 0;
  function openMenu() { mode = 'menu'; menuSel = 0; elMenuRoot.classList.remove('hidden'); renderMenu(); }
  function closeMenu() { elMenuRoot.classList.add('hidden'); mode = 'world'; }
  function renderMenu() {
    elMenuList.innerHTML = menuItems.map(function (it, i) {
      return '<div class="mItem' + (i === menuSel ? ' sel' : '') + '">' + (i === menuSel ? '\u25B6 ' : '\u00A0\u00A0') + it + '</div>';
    }).join('');
  }
  function menuMove(d) { menuSel = (menuSel + d + menuItems.length) % menuItems.length; renderMenu(); }
  function menuSelect() {
    var it = menuItems[menuSel];
    if (it === 'CLOSE') return closeMenu();
    if (it === 'TEAM') return openSheet('sheetParty', renderParty);
    if (it === 'BAG') return openSheet('sheetBag', renderBag);
    if (it === 'SALESDEX') return openSheet('sheetDex', renderDex);
    if (it === 'JOURNAL') return openSheet('sheetJournal', renderJournal);
    if (it === 'SAVE') { save(); toast('Progress saved!'); return; }
    if (it === 'NEW GAME') { if (window.confirm('Start a NEW GAME? This erases your save.')) { localStorage.removeItem(SAVE_KEY); location.reload(); } return; }
  }
  function openSheet(id, renderer) { closeMenu(); mode = 'sheet'; renderer(); $(id).classList.remove('hidden'); curSheet = id; }
  var curSheet = null;
  function closeSheet() { if (curSheet) $(curSheet).classList.add('hidden'); curSheet = null; mode = 'world'; }

  function miniSprite(id) {
    var cv = brandmonCanvas(id);
    return '<img class="sprImg" src="' + cv.toDataURL() + '" style="width:34px;height:34px;vertical-align:middle">';
  }
  function typePill(t) { return '<span class="pill" style="background:' + TYPECOLORS[t] + '">' + t + '</span>'; }
  function hpColor(f) { return f > 0.5 ? '#5fcf52' : f > 0.2 ? '#f2c14e' : '#e0533e'; }

  function renderParty() {
    var b = $('partyBody');
    if (!G.team.length) { b.innerHTML = '<div class="note">No Brandmons yet.</div>'; return; }
    b.innerHTML = G.team.map(function (m) {
      var sp = SPECIES[m.species], f = m.hp / m.maxHp;
      return '<div class="row">' + miniSprite(m.species) +
        '<div style="flex:1">' +
          '<div style="display:flex;justify-content:space-between;align-items:center"><span>' + nameOf(m) + ' ' + typePill(sp.type) + '</span><span class="lv2">Lv ' + m.level + '</span></div>' +
          '<div class="hpbar" style="width:100%"><div class="hpfill" style="width:' + (f * 100) + '%;background:' + hpColor(f) + '"></div></div>' +
          '<div class="hpNum">' + m.hp + ' / ' + m.maxHp + (m.hp <= 0 ? '  \u00B7 OUT-PITCHED' : '') + '</div>' +
        '</div></div>';
    }).join('');
  }
  function renderBag() {
    var b = $('bagBody'), keys = Object.keys(G.bag).filter(function (k) { return G.bag[k] > 0; });
    if (!keys.length) { b.innerHTML = '<div class="note">Your bag is empty.</div>'; return; }
    b.innerHTML = keys.map(function (k) {
      return '<div class="row"><div style="flex:1"><b>' + ITEMS[k].name + '</b> \u00D7' + G.bag[k] + '<div class="note" style="margin-top:3px">' + ITEMS[k].desc + '</div></div></div>';
    }).join('');
  }
  function renderJournal() {
    var b = $('journalBody');
    var done = JOURNAL.filter(function (t) { return G.flags[t.id]; }).length;
    b.innerHTML = JOURNAL.map(function (t) {
      var d = !!G.flags[t.id];
      return '<button class="taskBtn' + (d ? ' done' : '') + '">' + (d ? '\u2611 ' : '\u2610 ') + t.label + '</button>';
    }).join('') + '<div class="note">' + (G.flags.gymUnlocked ? 'Week 1 complete \u2014 the Regional Office is OPEN!' : 'Finish all four to unlock the Regional Office. (' + done + '/4)') + '</div>';
  }
  function renderDex() {
    var b = $('dexBody'); $('dexTitle').textContent = 'SALESDEX \u00B7 ' + Object.keys(G.dex.caught).length + ' recruited';
    var ids = Object.keys(SPECIES);
    b.innerHTML = ids.map(function (id) {
      var sp = SPECIES[id], caught = G.dex.caught[id], seen = G.dex.seen[id];
      var no = ('00' + sp.no).slice(-2);
      if (!seen && !caught) return '<div class="row" style="opacity:.5"><span style="width:34px;text-align:center">?</span><div style="flex:1">No.' + no + ' <b>--------</b></div></div>';
      return '<div class="row">' + miniSprite(id) + '<div style="flex:1"><div>No.' + no + ' <b>' + sp.name + '</b> ' + typePill(sp.type) + (caught ? ' <span class="pill" style="background:#3a8f4a">OWNED</span>' : ' <span class="pill" style="background:#777">SEEN</span>') + '</div>' + (caught ? '<div class="note" style="margin-top:3px">' + sp.blurb + '</div>' : '') + '</div></div>';
    }).join('');
  }

  /* =====================================================================
     SHOP
     ===================================================================== */
  var shopSel = 0, shopList = [];
  function openShop() {
    if (!G.flags.visitedShop) setFlag('visitedShop');
    mode = 'shop'; shopSel = 0; shopList = SHOP_STOCK.slice().concat(['EXIT']);
    elShop.classList.remove('hidden'); renderShop();
  }
  function closeShop() { elShop.classList.add('hidden'); mode = 'world'; save(); }
  function renderShop() {
    elShopMoney.textContent = G.money;
    elShopList.innerHTML = shopList.map(function (k, i) {
      var sel = i === shopSel ? ' sel' : '', arrow = i === shopSel ? '\u25B6 ' : '\u00A0\u00A0';
      if (k === 'EXIT') return '<div class="mItem' + sel + '">' + arrow + 'EXIT</div>';
      var it = ITEMS[k];
      return '<div class="mItem' + sel + '">' + arrow + it.name + '<span style="float:right">\u20B5' + it.price + '</span><div class="note" style="margin:2px 0 0 14px">' + it.desc + '</div></div>';
    }).join('');
  }
  function shopMove(d) { shopSel = (shopSel + d + shopList.length) % shopList.length; renderShop(); }
  function shopSelect() {
    var k = shopList[shopSel];
    if (k === 'EXIT') return closeShop();
    var it = ITEMS[k];
    if (G.money < it.price) { toast('Not enough commission!'); return; }
    G.money -= it.price; G.bag[k] = (G.bag[k] || 0) + 1; updateHUD(); renderShop();
    toast('Bought ' + it.name + '!');
  }

  /* =====================================================================
     STARTER PICKER
     ===================================================================== */
  var startSel = 0;
  function openStarter() {
    mode = 'starter'; startSel = 0; elStarter.classList.remove('hidden');
    elStarterRow.innerHTML = STARTERS.map(function (id, i) {
      var sp = SPECIES[id];
      return '<div class="starterCard' + (i === 0 ? ' sel' : '') + '" data-i="' + i + '">' +
        '<div class="sc" id="scimg' + i + '"></div>' +
        '<div class="sn">' + sp.name + '</div><div class="st">' + typePill(sp.type) + '</div></div>';
    }).join('');
    STARTERS.forEach(function (id, i) { var cv = brandmonCanvas(id); cv.style.width = '60px'; cv.style.height = '60px'; $('scimg' + i).appendChild(cv); });
    Array.prototype.forEach.call(elStarterRow.children, function (card) {
      card.addEventListener('click', function () { startSel = +card.dataset.i; renderStarter(); confirmStarter(); });
    });
  }
  function renderStarter() { Array.prototype.forEach.call(elStarterRow.children, function (c, i) { c.classList.toggle('sel', i === startSel); }); }
  function startMove(d) { startSel = (startSel + d + STARTERS.length) % STARTERS.length; renderStarter(); }
  function confirmStarter() {
    var id = STARTERS[startSel]; elStarter.classList.add('hidden');
    var m = makeMon(id, 5); G.team.push(m); G.dex.caught[id] = true; G.dex.seen[id] = true;
    setFlag('choseStarter'); updateHUD(); save();
    say(['Director Halsey: ' + SPECIES[id].name + ' \u2014 excellent pick!',
         'Welcome to the Apparel Region, rep.',
         'Wander the tall grass to meet wild Brandmons. Wear one down, then a SAMPLE CASE recruits it.',
         'Clear your Week 1 Journal, then take on the Regional Office. Press START for your kit!']);
  }

  /* =====================================================================
     FLAGS / GYM UNLOCK
     ===================================================================== */
  function setFlag(f) {
    if (G.flags[f]) return; G.flags[f] = true;
    if (!G.flags.gymUnlocked && JOURNAL.every(function (t) { return G.flags[t.id]; })) {
      G.flags.gymUnlocked = true;
      var gw = MAPS.town.warps.filter(function (w) { return w.to === 'gym'; })[0]; if (gw) gw.locked = false;
      setTimeout(function () { toast('The Regional Office is now OPEN!'); }, 400);
    }
    save();
  }

  /* =====================================================================
     BATTLE ENGINE  (FireRed/LeafGreen flavored)
     ===================================================================== */
  var BS = null;
  function newBattler(mon) { mon.atkMod = 1; mon.defMod = 1; mon.accMod = 1; return mon; }

  function startWild(m) {
    var pick = weighted(m.encounters), lvl = ri(pick.min, pick.max);
    var e = newBattler(makeMon(pick.s, lvl));
    G.dex.seen[pick.s] = true;
    BS = { enemy: e, wild: true, trainer: null, active: firstHealthy(), sub: 'msg', canRun: true };
    newBattler(G.team[BS.active]);
    enterBattle('A wild ' + nameOf(e) + ' appeared!');
  }
  function startTrainer(n) {
    var t = n.battle, team = t.team.map(function (d) { return newBattler(makeMon(d.s, d.lvl)); });
    BS = { enemy: team[0], wild: false, trainer: t, tnpc: n, tteam: team, tidx: 0, active: firstHealthy(), sub: 'msg', canRun: false };
    newBattler(G.team[BS.active]);
    enterBattle(t.name + ' sent out ' + nameOf(team[0]) + '!');
  }
  function weighted(list) {
    var tot = list.reduce(function (s, e) { return s + e.w; }, 0), r = Math.random() * tot;
    for (var i = 0; i < list.length; i++) { r -= list[i].w; if (r <= 0) return list[i]; }
    return list[0];
  }

  function enterBattle(introMsg) {
    mode = 'battle'; elBattle.classList.remove('hidden');
    // mount sprites
    var es = $('eSpr'), ps = $('pSpr'); es.innerHTML = ''; ps.innerHTML = '';
    var ec = brandmonCanvas(BS.enemy.species); es.appendChild(ec);
    var pc = brandmonCanvas(G.team[BS.active].species); pc.style.transform = 'scaleX(-1)'; ps.appendChild(pc);
    // sprites visible immediately (no timer-dependent reveal); subtle CSS entrance only
    es.style.opacity = '1'; es.style.transform = ''; es.classList.remove('bIn'); void es.offsetWidth; es.classList.add('bIn');
    ps.style.opacity = '1'; ps.style.transform = ''; ps.classList.remove('bIn'); void ps.offsetWidth; ps.classList.add('bIn');
    refreshBattleCards();
    bSay([introMsg], function () { playerTurn(); });
  }
  function refreshBattleCards() {
    var e = BS.enemy, p = G.team[BS.active];
    $('eName').textContent = nameOf(e); $('eLv').textContent = 'Lv ' + e.level;
    $('pName').textContent = nameOf(p); $('pLv').textContent = 'Lv ' + p.level;
    setBar('eHp', e.hp / e.maxHp); setBar('pHp', p.hp / p.maxHp);
    $('pHpNum').textContent = Math.max(0, p.hp) + ' / ' + p.maxHp;
  }
  function setBar(id, f) { var el = $(id); f = clamp(f, 0, 1); el.style.width = (f * 100) + '%'; el.style.background = hpColor(f); }
  function animBar(id, mon, done) {
    var target = clamp(mon.hp / mon.maxHp, 0, 1), el = $(id);
    var cur = parseFloat(el.style.width) / 100; if (isNaN(cur)) cur = target;
    var steps = 14, i = 0;
    var iv = setInterval(function () {
      i++; var f = cur + (target - cur) * (i / steps); el.style.width = (f * 100) + '%'; el.style.background = hpColor(f);
      if (id === 'pHp') $('pHpNum').textContent = Math.max(0, Math.round(mon.maxHp * f)) + ' / ' + mon.maxHp;
      if (i >= steps) { clearInterval(iv); el.style.width = (target * 100) + '%'; if (id === 'pHp') $('pHpNum').textContent = Math.max(0, mon.hp) + ' / ' + mon.maxHp; if (done) done(); }
    }, 26);
  }

  /* ----- battle messages ----- */
  var bQ = [], bDone = null;
  function bSay(lines, done) { BS.sub = 'msg'; bQ = lines.slice(); bDone = done || null; elBMenu.innerHTML = ''; elBMenu.style.display = 'none'; bNext(); }
  function bNext() {
    if (bQ.length === 0) { var d = bDone; bDone = null; if (d) d(); return; }
    elBMsg.innerHTML = bQ.shift() + '<span class="bArrow blink">\u25B6</span>';
  }

  /* ----- player command menu ----- */
  var cmdSel = 0, moveSel = 0, bagSel = 0, switchSel = 0;
  function playerTurn() {
    var p = G.team[BS.active];
    if (p.hp <= 0) { forceSwitch(); return; }
    BS.sub = 'cmd'; cmdSel = 0; elBMsg.textContent = 'What will ' + nameOf(p) + ' do?';
    elBMenu.style.display = 'grid'; renderCmd();
  }
  function renderCmd() {
    var labels = ['FIGHT', 'BAG', 'TEAM', 'RUN'];
    elBMenu.innerHTML = labels.map(function (l, i) { return '<button class="bBtn' + (i === cmdSel ? ' sel' : '') + '">' + (i === cmdSel ? '\u25B6' : '') + l + '</button>'; }).join('');
  }
  function cmdMove(d, horiz) { // grid 2x2
    if (horiz) cmdSel ^= 1; else cmdSel ^= 2; cmdSel = clamp(cmdSel, 0, 3); renderCmd();
  }
  function cmdSelect() {
    if (cmdSel === 0) openMoves();
    else if (cmdSel === 1) openBattleBag();
    else if (cmdSel === 2) openSwitch(false);
    else doRun();
  }
  function openMoves() {
    BS.sub = 'moves'; moveSel = 0; elBMenu.style.display = 'grid'; renderMoves();
  }
  function renderMoves() {
    var p = G.team[BS.active];
    elBMenu.innerHTML = p.moves.map(function (mv, i) {
      var def = MOVES[mv.id];
      return '<button class="bBtn moveBtn' + (i === moveSel ? ' sel' : '') + '"' + (mv.pp <= 0 ? ' disabled' : '') + '>' +
        '<span class="tdot" style="background:' + TYPECOLORS[def.type] + '"></span><span class="mvName">' + def.name + '</span></button>';
    }).join('');
    var sel = p.moves[moveSel], d = MOVES[sel.id];
    elBMsg.innerHTML = '<div class="mvInfo"><span class="mvInfoTop">PP ' + sel.pp + ' / ' + sel.max + '</span>' +
      '<span class="mvInfoType"><span class="tdot" style="background:' + TYPECOLORS[d.type] + '"></span>' + d.type + '</span>' +
      (d.desc ? '<span class="mvInfoDesc">' + d.desc + '</span>' : '') + '</div>';
  }
  function moveMove(d, horiz) { if (horiz) moveSel ^= 1; else moveSel ^= 2; moveSel = clamp(moveSel, 0, G.team[BS.active].moves.length - 1); renderMoves(); }
  function moveSelect() {
    var p = G.team[BS.active], mv = p.moves[moveSel]; if (!mv || mv.pp <= 0) { return; }
    mv.pp--; resolveRound({ type: 'move', mv: mv });
  }

  function openBattleBag() {
    BS.sub = 'bbag'; bagSel = 0;
    var keys = Object.keys(G.bag).filter(function (k) { return G.bag[k] > 0; });
    BS.bagKeys = keys.concat(['BACK']);
    elBMenu.style.display = 'block'; renderBattleBag();
  }
  function renderBattleBag() {
    elBMenu.innerHTML = BS.bagKeys.map(function (k, i) {
      var sel = i === bagSel ? ' sel' : '', ar = i === bagSel ? '\u25B6 ' : '\u00A0\u00A0';
      if (k === 'BACK') return '<button class="bBtn listBtn' + sel + '">' + ar + 'BACK</button>';
      return '<button class="bBtn listBtn' + sel + '">' + ar + ITEMS[k].name + ' \u00D7' + G.bag[k] + '</button>';
    }).join('');
  }
  function bagMove(d) { bagSel = (bagSel + d + BS.bagKeys.length) % BS.bagKeys.length; renderBattleBag(); }
  function bagSelect() {
    var k = BS.bagKeys[bagSel]; if (k === 'BACK') return playerTurn();
    var it = ITEMS[k];
    if (it.kind === 'ball') {
      if (!BS.wild) { bSay(["You can't recruit another rep's Brandmon!"], function () { playerTurn(); }); return; }
      G.bag[k]--; resolveCatch(it); return;
    }
    if (it.kind === 'heal') {
      var p = G.team[BS.active];
      if (p.hp >= p.maxHp) { bSay([nameOf(p) + ' is already at full Pitch HP.'], function () { openBattleBag(); }); return; }
      G.bag[k]--; p.hp = Math.min(p.maxHp, p.hp + it.amount);
      bSay(['You used ' + it.name + '.'], function () { animBar('pHp', p, function () { afterPlayerAction(); }); });
      return;
    }
    if (it.kind === 'revive') {
      var dead = G.team.filter(function (mm) { return mm.hp <= 0; });
      if (!dead.length) { bSay(['No Brandmon needs reviving.'], function () { openBattleBag(); }); return; }
      G.bag[k]--; dead[0].hp = Math.floor(dead[0].maxHp / 2);
      bSay([nameOf(dead[0]) + ' is back in the game!'], function () { afterPlayerAction(); });
      return;
    }
  }

  function resolveCatch(it) {
    var e = BS.enemy, frac = e.hp / e.maxHp;
    var base = SPECIES[e.species].catch / 255;
    var chance = clamp((1 - frac * 0.72) * base * it.rate + 0.06, 0.03, 0.95);
    var ok = Math.random() < chance;
    bSay(['You tossed a ' + it.name + '!', ok ? '\u2026' : 'Shake\u2026 shake\u2026 it broke free!'], function () {
      if (ok) {
        var caught = e; caught.atkMod = caught.defMod = caught.accMod = 1;
        if (!G.dex.caught[caught.species]) G.dex.caught[caught.species] = true;
        var where = G.team.length < 6 ? 'team' : 'box';
        if (where === 'team') G.team.push(caught); else G.box.push(caught);
        setFlag('recruited');
        bSay([nameOf(caught) + ' joined your roster!' + (where === 'box' ? ' (sent to the Bench)' : '')], function () { endBattle(); });
      } else { enemyTurnThen(function () { playerTurn(); }); }
    });
  }

  function openSwitch(forced) {
    BS.sub = 'switch'; BS.forcedSwitch = forced; switchSel = 0;
    BS.switchList = G.team.map(function (m, i) { return i; }).concat(forced ? [] : [-1]); // -1 = back
    elBMenu.style.display = 'block'; renderSwitch();
  }
  function renderSwitch() {
    elBMenu.innerHTML = BS.switchList.map(function (idx, i) {
      var sel = i === switchSel ? ' sel' : '', ar = i === switchSel ? '\u25B6 ' : '\u00A0\u00A0';
      if (idx === -1) return '<button class="bBtn listBtn' + sel + '">' + ar + 'BACK</button>';
      var m = G.team[idx], dead = m.hp <= 0, act = idx === BS.active;
      return '<button class="bBtn listBtn' + sel + '"' + (dead || act ? ' disabled' : '') + '>' + ar + nameOf(m) + ' Lv' + m.level + ' \u00B7 ' + Math.max(0, m.hp) + '/' + m.maxHp + (act ? ' (out)' : dead ? ' (down)' : '') + '</button>';
    }).join('');
  }
  function switchMove(d) { switchSel = (switchSel + d + BS.switchList.length) % BS.switchList.length; renderSwitch(); }
  function switchSelect() {
    var idx = BS.switchList[switchSel];
    if (idx === -1) return playerTurn();
    var m = G.team[idx]; if (m.hp <= 0 || idx === BS.active) return;
    var forced = BS.forcedSwitch; BS.active = idx; newBattler(m);
    var pc = brandmonCanvas(m.species); pc.style.transform = 'scaleX(-1)'; var ps = $('pSpr'); ps.innerHTML = ''; ps.appendChild(pc);
    refreshBattleCards();
    bSay(['Go, ' + nameOf(m) + '!'], function () { forced ? playerTurn() : enemyTurnThen(function () { playerTurn(); }); });
  }

  function doRun() {
    if (!BS.wild) { bSay(["There's no running from a rival rep!"], function () { playerTurn(); }); return; }
    var p = G.team[BS.active], e = BS.enemy;
    var ok = p.spd >= e.spd || Math.random() < 0.6;
    if (ok) bSay(['Got away safely!'], function () { endBattle(); });
    else bSay(["Couldn't get away!"], function () { enemyTurnThen(function () { playerTurn(); }); });
  }

  /* ----- round resolution ----- */
  function effMul(a, mv, d) { return typeMult(MOVES[mv.id].type, SPECIES[d.species].type); }
  function calcDmg(a, d, mvId) {
    var mv = MOVES[mvId], mult = typeMult(mv.type, SPECIES[d.species].type);
    var crit = Math.random() < 0.07 ? 1.5 : 1;
    var atk = a.atk * (a.atkMod || 1), def = Math.max(1, d.def * (d.defMod || 1));
    var base = Math.floor(((2 * a.level / 5 + 2) * mv.power * (atk / def)) / 50) + 2;
    var dmg = Math.max(1, Math.floor(base * mult * crit * (0.85 + Math.random() * 0.15)));
    return { dmg: dmg, mult: mult, crit: crit > 1 };
  }
  function effMsg(mult) { return mult > 1 ? "It's a knockout pitch!" : (mult < 1 ? "It barely landed\u2026" : null); }

  function performMove(att, def, mv, attIsPlayer, after) {
    var def0 = MOVES[mv.id];
    var msgs = [nameOf(att) + ' used ' + def0.name + '!'];
    // accuracy
    if (Math.random() > (def0.acc / 100) * (att.accMod || 1)) {
      bSay(msgs.concat(['But it missed!']), after); return;
    }
    if (def0.kind === 'heal') {
      att.hp = Math.min(att.maxHp, att.hp + Math.floor(att.maxHp * def0.heal));
      bSay(msgs.concat([nameOf(att) + ' recovered Pitch HP!']), function () { animBar(attIsPlayer ? 'pHp' : 'eHp', att, after); });
      return;
    }
    if (def0.kind === 'buff') { att[def0.stat + 'Mod'] = (att[def0.stat + 'Mod'] || 1) * def0.mult; bSay(msgs.concat([nameOf(att) + "'s " + statName(def0.stat) + ' rose!']), after); return; }
    if (def0.kind === 'debuff') { def[def0.stat + 'Mod'] = (def[def0.stat + 'Mod'] || 1) * def0.mult; bSay(msgs.concat([nameOf(def) + "'s " + statName(def0.stat) + ' fell!']), after); return; }
    // physical
    var r = calcDmg(att, def, mv.id); def.hp = Math.max(0, def.hp - r.dmg);
    var tail = []; if (r.crit) tail.push('A perfect pitch!'); var em = effMsg(r.mult); if (em) tail.push(em);
    bSay(msgs, function () { animBar(attIsPlayer ? 'eHp' : 'pHp', def, function () { if (tail.length) bSay(tail, after); else after(); }); });
  }
  function statName(s) { return s === 'atk' ? 'Close power' : s === 'def' ? 'Resolve' : 'focus'; }

  function enemyChoose() {
    var e = BS.enemy, p = G.team[BS.active];
    var avail = e.moves.filter(function (mv) { return mv.pp > 0; });
    if (!avail.length) return { id: 'coldCall', pp: 1, max: 1, _struggle: true };
    var best = null, bestScore = -1;
    avail.forEach(function (mv) {
      var d = MOVES[mv.id], score = d.power * typeMult(d.type, SPECIES[p.species].type);
      if (d.kind !== 'phys') score = 30; score += Math.random() * 12;
      if (score > bestScore) { bestScore = score; best = mv; }
    });
    return best;
  }
  function enemyTurnThen(after) {
    var e = BS.enemy, p = G.team[BS.active];
    if (e.hp <= 0) { after(); return; }
    var mv = enemyChoose(); if (!mv._struggle) mv.pp--;
    performMove(e, p, mv, false, function () {
      if (p.hp <= 0) { onPlayerFaint(); } else after();
    });
  }

  function resolveRound(playerAction) {
    var p = G.team[BS.active], e = BS.enemy;
    if (playerAction.type === 'move') {
      var emv = enemyChoose();
      var pFast = p.spd >= e.spd; // ties -> player
      var first = pFast ? 'p' : 'e';
      var doPlayer = function (next) { performMove(p, e, playerAction.mv, true, function () { if (e.hp <= 0) { onEnemyFaint(); } else next(); }); };
      var doEnemy = function (next) { if (!emv._struggle) emv.pp--; performMove(e, p, emv, false, function () { if (p.hp <= 0) { onPlayerFaint(); } else next(); }); };
      if (first === 'p') doPlayer(function () { doEnemy(function () { playerTurn(); }); });
      else doEnemy(function () { doPlayer(function () { playerTurn(); }); });
    }
  }
  function afterPlayerAction() { // item/etc that consumes a turn
    var e = BS.enemy; if (e.hp <= 0) { onEnemyFaint(); return; }
    enemyTurnThen(function () { playerTurn(); });
  }

  function onEnemyFaint() {
    var e = BS.enemy, p = G.team[BS.active];
    bSay([nameOf(e) + ' was out-pitched!'], function () {
      var gain = Math.floor(e.level * 7 + 12);
      grantExp(p, gain, function () {
        if (!G.flags.wonBattle) setFlag('wonBattle');
        if (!BS.wild) {
          if (BS.tidx < BS.tteam.length - 1) {
            BS.tidx++; BS.enemy = BS.tteam[BS.tidx];
            var ec = brandmonCanvas(BS.enemy.species); var es = $('eSpr'); es.innerHTML = ''; es.appendChild(ec);
            refreshBattleCards();
            bSay([BS.trainer.name + ' sent out ' + nameOf(BS.enemy) + '!'], function () { playerTurn(); });
          } else {
            // trainer defeated
            G.money += BS.trainer.reward; updateHUD();
            var msgs = ['You out-sold ' + BS.trainer.name + '!', 'Earned \u20B5' + BS.trainer.reward + ' commission.'];
            if (BS.trainer.win) msgs.push(BS.trainer.name + ': ' + BS.trainer.win);
            if (BS.trainer.badge) { G.badges++; G.badgeNames.push(BS.trainer.badge); updateHUD(); msgs.push('You earned the ' + BS.trainer.badge + '!'); }
            G.flags['beat_' + BS.tnpc.id] = true;
            if (BS.trainer.journal) setFlag(BS.trainer.journal);
            bSay(msgs, function () { endBattle(); });
          }
        } else { bSay(['+' + gain + ' pitch EXP for ' + nameOf(p) + '.'], function () { endBattle(); }); }
      });
    });
  }
  function grantExp(p, amount, done) {
    p.exp += amount; var msgs = []; var leveled = false;
    while (p.exp >= expToNext(p.level) && p.level < 50) {
      p.exp -= expToNext(p.level); p.level++; recompute(p); leveled = true;
      msgs.push(nameOf(p) + ' grew to Lv ' + p.level + '!');
      var sp = SPECIES[p.species];
      if (sp.evolve && p.level >= sp.evolve.lvl) {
        var to = sp.evolve.to; msgs.push(nameOf(p) + ' is evolving!');
        p.species = to; recompute(p);
        // learn the new species' missing default moves (fill empty slots)
        msgs.push('Evolved into ' + SPECIES[to].name + '!');
        var ps = $('pSpr'); var pc = brandmonCanvas(p.species); pc.style.transform = 'scaleX(-1)'; ps.innerHTML = ''; ps.appendChild(pc);
        G.dex.caught[to] = true; G.dex.seen[to] = true;
      }
    }
    if (leveled) { refreshBattleCards(); bSay(msgs, done); } else { done(); }
  }

  function onPlayerFaint() {
    var p = G.team[BS.active];
    bSay([nameOf(p) + ' was out-pitched!'], function () {
      if (teamWiped()) {
        bSay(['All your Brandmons are spent\u2026', 'You hurry back to HQ to regroup.'], function () { whiteout(); });
      } else { forceSwitch(); }
    });
  }
  function forceSwitch() { openSwitch(true); }

  function whiteout() {
    healTeam(); endBattle();
    G.map = 'town'; G.tx = 11; G.ty = 6; G.dir = 'down'; G.px = G.tx * TILE; G.py = G.ty * TILE;
    toast('Your team was restored at HQ.'); save();
  }

  function endBattle() {
    elBattle.classList.add('hidden'); BS = null; mode = 'world';
    // reset stat mods
    G.team.forEach(function (m) { m.atkMod = m.defMod = m.accMod = 1; });
    save();
  }

  /* =====================================================================
     INPUT ROUTING
     ===================================================================== */
  function onA() {
    switch (mode) {
      case 'world': interact(); break;
      case 'dialogue': nextLine(); break;
      case 'menu': menuSelect(); break;
      case 'sheet': break;
      case 'shop': shopSelect(); break;
      case 'starter': confirmStarter(); break;
      case 'battle': battleA(); break;
    }
  }
  function onB() {
    switch (mode) {
      case 'menu': closeMenu(); break;
      case 'sheet': closeSheet(); break;
      case 'shop': closeShop(); break;
      case 'dialogue': nextLine(); break;
      case 'battle': battleB(); break;
    }
  }
  function onStart() {
    if (mode === 'world') openMenu();
    else if (mode === 'menu') closeMenu();
  }
  function onDir(d) {
    if (mode === 'world') { held[d] = true; tryStep(d); }
    else if (mode === 'menu') menuMove(d === 'down' ? 1 : d === 'up' ? -1 : 0);
    else if (mode === 'shop') shopMove(d === 'down' ? 1 : d === 'up' ? -1 : 0);
    else if (mode === 'starter') { if (d === 'left') startMove(-1); if (d === 'right') startMove(1); }
    else if (mode === 'battle') battleDir(d);
  }
  function battleA() {
    if (BS.sub === 'msg') { if (bQ.length) bNext(); else { /* wait for chain */ var d = bDone; bDone = null; if (d) d(); } return; }
    if (BS.sub === 'cmd') return cmdSelect();
    if (BS.sub === 'moves') return moveSelect();
    if (BS.sub === 'bbag') return bagSelect();
    if (BS.sub === 'switch') return switchSelect();
  }
  function battleB() {
    if (BS.sub === 'moves' || BS.sub === 'bbag') return playerTurn();
    if (BS.sub === 'switch' && !BS.forcedSwitch) return playerTurn();
  }
  function battleDir(d) {
    if (BS.sub === 'cmd') cmdMove(0, d === 'left' || d === 'right');
    else if (BS.sub === 'moves') moveMove(0, d === 'left' || d === 'right');
    else if (BS.sub === 'bbag') bagMove(d === 'down' ? 1 : d === 'up' ? -1 : 0);
    else if (BS.sub === 'switch') switchMove(d === 'down' ? 1 : d === 'up' ? -1 : 0);
  }

  /* keyboard */
  var downKeys = {};
  document.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].indexOf(k) !== -1) e.preventDefault();
    if (downKeys[k]) { // allow held movement only
      if (k === 'arrowup' || k === 'w') held.up = true;
      if (k === 'arrowdown' || k === 's') held.down = true;
      if (k === 'arrowleft' || k === 'a') held.left = true;
      if (k === 'arrowright' || k === 'd') held.right = true;
      return;
    }
    downKeys[k] = true;
    if (k === 'arrowup' || k === 'w') onDir('up');
    else if (k === 'arrowdown' || k === 's') onDir('down');
    else if (k === 'arrowleft' || k === 'a') onDir('left');
    else if (k === 'arrowright' || k === 'd') onDir('right');
    else if (k === 'z' || k === ' ' || k === 'enter') { if (k === 'enter' && mode === 'world') onStart(); else onA(); }
    else if (k === 'x' || k === 'backspace') onB();
    else if (k === 'escape') onStart();
  });
  document.addEventListener('keyup', function (e) {
    var k = e.key.toLowerCase(); downKeys[k] = false;
    if (k === 'arrowup' || k === 'w') held.up = false;
    if (k === 'arrowdown' || k === 's') held.down = false;
    if (k === 'arrowleft' || k === 'a') held.left = false;
    if (k === 'arrowright' || k === 'd') held.right = false;
  });

  /* on-screen controls */
  function bindBtn(el, onDown, onUp) {
    if (!el) return;
    el.addEventListener('pointerdown', function (e) { e.preventDefault(); onDown(); });
    if (onUp) { el.addEventListener('pointerup', onUp); el.addEventListener('pointerleave', onUp); el.addEventListener('pointercancel', onUp); }
  }
  Array.prototype.forEach.call(document.querySelectorAll('.dpad [data-dir]'), function (b) {
    var d = b.getAttribute('data-dir');
    bindBtn(b, function () { onDir(d); }, function () { held[d] = false; });
  });
  bindBtn($('btnA'), onA); bindBtn($('btnB'), onB); bindBtn($('btnStart'), onStart);
  // close buttons on sheets
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', closeSheet); });

  /* =====================================================================
     MAIN LOOP
     ===================================================================== */
  function loop() {
   try {
    tick++;
    if (mode === 'world' && !moving) {
      var d = held.up ? 'up' : held.down ? 'down' : held.left ? 'left' : held.right ? 'right' : null;
      if (d) tryStep(d);
    }
    if (moving) {
      moveT += 0.14; walkAnim = moveT;
      if (moveT >= 1) { moveT = 1; G.px = toPx; G.py = toPy; arrive(); }
      else { G.px = fromPx + (toPx - fromPx) * moveT; G.py = fromPy + (toPy - fromPy) * moveT; }
    }
    if (mode !== 'battle' && mode !== 'starter') render();
   } catch (err) { console.error('LOOP ERROR:', err && err.message, err && err.stack); }
    requestAnimationFrame(loop);
  }

  /* =====================================================================
     BOOT
     ===================================================================== */
  function boot() {
    preloadArt();
    if (load()) { mode = 'world'; updateHUD(); toast('Welcome back, rep!'); }
    else {
      G = freshState(); updateHUD();
      // ensure gym warp locked
      openStarter();
    }
    try { if (mode !== 'battle' && mode !== 'starter') render(); } catch (err) { console.error('INIT RENDER ERROR:', err && err.message, err && err.stack); }
    requestAnimationFrame(loop);
  }
  boot();
})();
