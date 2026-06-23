// ─── Color Attack TCG ─────────────────────────────────────────────────────────
// Pure vanilla JS + HTML5 Canvas. No dependencies. No build step.

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ─── Color palette (visual/audio reference) ───────────────────────────────────
const COLORS = [
  { id: 'yellow', label: 'Yellow', hex: '#FFD700', dark: '#b89800', glow: '#ffe87a' },
  { id: 'orange', label: 'Orange', hex: '#FF8C00', dark: '#c46000', glow: '#ffb84d' },
  { id: 'red',    label: 'Red',    hex: '#FF2222', dark: '#bb0000', glow: '#ff7777' },
  { id: 'purple', label: 'Purple', hex: '#9B30FF', dark: '#5a0099', glow: '#cc88ff' },
  { id: 'blue',   label: 'Blue',   hex: '#1E90FF', dark: '#0050bb', glow: '#88ccff' },
  { id: 'green',  label: 'Green',  hex: '#22DD55', dark: '#007722', glow: '#88ffaa' },
];

// ─── Card definitions ─────────────────────────────────────────────────────────
const CARD_DEFS = {
  yellow: { name: 'Spark',  mana: 1, atk: 1, def: 2, ability: null },
  orange: { name: 'Ember',  mana: 2, atk: 2, def: 3, ability: null },
  red:    { name: 'Blaze',  mana: 3, atk: 4, def: 1, ability: 'charge' },
  purple: { name: 'Void',   mana: 3, atk: 3, def: 2, ability: null },
  blue:   { name: 'Frost',  mana: 2, atk: 1, def: 5, ability: 'taunt' },
  green:  { name: 'Nature', mana: 2, atk: 0, def: 4, ability: 'heal' },
};
const COLOR_IDS = ['yellow', 'orange', 'red', 'purple', 'blue', 'green'];

// ─── Card art images ──────────────────────────────────────────────────────────
const CARD_IMAGES = {};
const CARD_IMAGE_PATHS = {
  yellow: 'src/card-img/ai-image-generator-1780303159315.png',
  orange: 'src/card-img/ai-image-generator-1780302582434.png',
  red:    'src/card-img/ai-image-generator-1780302782081.png',
  purple: 'src/card-img/ai-image-generator-1780302672969.png',
  blue:   'src/card-img/ai-image-generator-1780303293899.png',
  green:  'src/card-img/ai-image-generator-1780303021745.png',
};
COLOR_IDS.forEach(id => {
  const img = new Image();
  img.src = CARD_IMAGE_PATHS[id];
  CARD_IMAGES[id] = img;
});

const bgImage = new Image();
bgImage.src = 'src/bg/battle-bg.jpg';


const atkStatImg = new Image();
atkStatImg.src = 'src/card-stat-square/attack.png';
const hpStatImg = new Image();
hpStatImg.src = 'src/card-stat-square/hp.png';

// ─── Level / merge system ─────────────────────────────────────────────────────
const MAX_LEVEL = 3;

function getMergedCard(base) {
  if (base.level >= MAX_LEVEL) return null;
  const def  = CARD_DEFS[base.id];
  const lvl  = base.level + 1;
  const mult = lvl === 2 ? 1.65 : 2.6;
  return {
    ...base,
    level:       lvl,
    attack:      Math.ceil(def.atk * mult),
    defense:     Math.ceil(def.def * mult),
    maxDefense:  Math.ceil(def.def * mult),
    hasAttacked: false,
    summoningSickness: true,
  };
}

function makeCard(colorId) {
  const def      = CARD_DEFS[colorId];
  const colorDef = COLORS.find(c => c.id === colorId);
  return {
    id: colorId, colorDef, level: 1,
    name: def.name, manaCost: def.mana,
    attack: def.atk, defense: def.def, maxDefense: def.def,
    ability: def.ability, hasAttacked: false, summoningSickness: true,
  };
}

// ─── TCG state ────────────────────────────────────────────────────────────────
const MAX_HP    = 20;
const MAX_MANA  = 10;
const MAX_SLOTS = 5;
const MAX_HAND  = 7;

let playerHP = MAX_HP, enemyHP = MAX_HP;
let playerMana = 2,    playerMaxMana = 2;
let enemyMana  = 2,    enemyMaxMana  = 2;

let playerField = [null, null, null, null, null];
let enemyField  = [null, null, null, null, null];
let playerHand  = [];
let enemyHand   = [];

let currentTurn     = 'player';
let turnNumber      = 1;
let phase           = 'play';
let gameOver        = false;

let selectedHandIdx  = null;
let selectedFieldIdx = null;
let animLock         = false;
let dragState        = null;  // { card, handIdx, x, y, startX, startY, isDragging, hoverSlot }

// Flash/impact tweens
let playerFlash  = null;
let enemyFlash   = null;
let enemyImpact  = null;
let playerImpact = null;

// Particles, shake, starfield, audio
let particles = [];
let shake     = { intensity: 0, duration: 0, elapsed: 0 };
const STAR_COUNT = 90;
const stars      = [];
let bgPulse      = 0;
let audioCtx     = null;

// ─── Layout zones ─────────────────────────────────────────────────────────────
const ZONE = {
  topHud:      () => ({ y: 0,                        h: canvas.height * 0.09 }),
  enemyHand:   () => ({ y: canvas.height * 0.09,     h: canvas.height * 0.11 }),
  enemyField:  () => ({ y: canvas.height * 0.20,     h: canvas.height * 0.22 }),
  centerBar:   () => ({ y: canvas.height * 0.42,     h: canvas.height * 0.08 }),
  playerField: () => ({ y: canvas.height * 0.50,     h: canvas.height * 0.22 }),
  playerHand:  () => ({ y: canvas.height * 0.72,     h: canvas.height * 0.21 }),
  bottomHud:   () => ({ y: canvas.height * 0.93,     h: canvas.height * 0.07 }),
};

// ─── Flat field projection (no perspective distortion) ───────────────────────
function projectField(normX, normY) {
  const fz      = normY < 0.5 ? ZONE.enemyField() : ZONE.playerField();
  const screenY = fz.y + fz.h * 0.5;
  const screenX = canvas.width * 0.08 + normX * canvas.width * 0.84;
  return { x: screenX, y: screenY, scale: 1 };
}

function cardW()      { return Math.min(canvas.width * 0.14, 115 * devicePixelRatio); }
function cardH()      { return cardW() * 1.45; }
function fieldCardW() { return Math.min(canvas.width * 0.15, 120 * devicePixelRatio); }
function fieldCardH() { return fieldCardW() * 1.45; }

// ─── Geometry helpers ─────────────────────────────────────────────────────────
function fieldSlotRect(side, idx) {
  const fz0    = side === 'player' ? ZONE.playerField() : ZONE.enemyField();
  const maxCh  = fz0.h * 0.82;                                     // card must fit inside zone
  const cw     = Math.min(canvas.width * 0.125, 100 * devicePixelRatio, maxCh / 1.45);
  const ch     = cw * 1.45;
  const gap    = canvas.width * 0.014;
  const totalW = MAX_SLOTS * cw + (MAX_SLOTS - 1) * gap;
  const startX = (canvas.width - totalW) * 0.5;
  const fz     = side === 'player' ? ZONE.playerField() : ZONE.enemyField();
  const cx     = startX + idx * (cw + gap) + cw * 0.5;
  const cy     = fz.y + fz.h * 0.5;
  return { x: cx - cw * 0.5, y: cy - ch * 0.5, w: cw, h: ch,
           cx, cy, scale: 1, normY: side === 'player' ? 1 : 0 };
}

function emzSlotRect(idx) {
  const normX = idx === 0 ? 0.35 : 0.65;
  const proj  = projectField(normX, 0.5);
  const w     = fieldCardW() * proj.scale;
  const h     = w * 1.45;
  return { x: proj.x - w * 0.5, y: proj.y - h * 0.5, w, h,
           cx: proj.x, cy: proj.y, scale: proj.scale };
}

// Straight-row hand layout helpers
function handRowParams(total) {
  const fz     = ZONE.playerHand();
  const maxCh  = fz.h * 0.88;                                      // leave breathing room in zone
  const cw     = Math.min(canvas.width * 0.125, 100 * devicePixelRatio, maxCh / 1.45);
  const ch     = cw * 1.45;
  const gap    = canvas.width * 0.012;
  const totalW = total * cw + (total - 1) * gap;
  const startX = (canvas.width - totalW) * 0.5;
  const cardY  = fz.y + (fz.h - ch) * 0.5;
  return { cw, ch, gap, startX, cardY };
}

function handCardRect(idx, total) {
  const p      = handRowParams(total);
  const lifted = idx === selectedHandIdx ? p.ch * 0.08 : 0;
  const x      = p.startX + idx * (p.cw + p.gap);
  const y      = p.cardY - lifted;
  return { x, y, w: p.cw, h: p.ch, cx: x + p.cw * 0.5, cy: y + p.ch * 0.5 };
}

function hitTestHandCard(px, py, idx, total) {
  const r = handCardRect(idx, total);
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function endTurnRect() {
  const cB = ZONE.centerBar();
  const bw = Math.min(canvas.width * 0.20, 120 * devicePixelRatio);
  const bh = Math.min(cB.h * 0.65, 32 * devicePixelRatio);
  const x  = canvas.width * 0.5 - bw * 0.5;
  const y  = cB.y + (cB.h - bh) * 0.5;
  return { x, y, w: bw, h: bh, cx: x + bw * 0.5, cy: cB.y + cB.h * 0.5 };
}

function pointIn(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

// ─── Deck / draw ──────────────────────────────────────────────────────────────
function dealCard(target) {
  const id   = COLOR_IDS[Math.floor(Math.random() * COLOR_IDS.length)];
  const hand = target === 'player' ? playerHand : enemyHand;
  if (hand.length >= MAX_HAND) hand.shift();
  hand.push(makeCard(id));
}

function dealOpening() {
  for (let i = 0; i < 4; i++) dealCard('player');
  for (let i = 0; i < 4; i++) dealCard('enemy');
}

// ─── Turn management ──────────────────────────────────────────────────────────
function startPlayerTurn() {
  currentTurn = 'player'; phase = 'play';
  playerMaxMana = Math.min(playerMaxMana + 1, MAX_MANA);
  playerMana    = playerMaxMana;
  dealCard('player');
  playerField.forEach(c => { if (c) { c.summoningSickness = false; c.hasAttacked = false; } });
  playerField.forEach(c => { if (c && c.ability === 'heal') applyHeroHeal('player', 3); });
  selectedHandIdx = null; selectedFieldIdx = null; animLock = false;
}

function startEnemyTurn() {
  currentTurn = 'enemy'; phase = 'enemy'; turnNumber++;
  enemyMaxMana = Math.min(enemyMaxMana + 1, MAX_MANA);
  enemyMana    = enemyMaxMana;
  dealCard('enemy');
  enemyField.forEach(c => { if (c) { c.summoningSickness = false; c.hasAttacked = false; } });
  enemyField.forEach(c => { if (c && c.ability === 'heal') applyHeroHeal('enemy', 3); });
  selectedHandIdx = null; selectedFieldIdx = null;
  setTimeout(runEnemyAI, 500);
}

function endPlayerTurn() {
  if (currentTurn !== 'player' || animLock || gameOver) return;
  selectedHandIdx = null; selectedFieldIdx = null;
  setTimeout(startEnemyTurn, 200);
}

// ─── HP / heal ────────────────────────────────────────────────────────────────
function applyHeroDamage(target, amount, colorDef) {
  if (gameOver) return;
  if (target === 'player') {
    playerHP = Math.max(0, playerHP - amount);
    const r = { cx: canvas.width * 0.2, cy: ZONE.playerField().y + ZONE.playerField().h * 0.5, w: 60, h: 60, x: canvas.width * 0.2 - 30, y: 0 };
    spawnFloatingNumber('-' + amount, r, colorDef.hex, colorDef.glow);
    triggerShake(5);
    if (playerHP <= 0) { gameOver = 'lose'; phase = 'gameover'; }
  } else {
    enemyHP = Math.max(0, enemyHP - amount);
    const r = { cx: canvas.width * 0.8, cy: ZONE.enemyField().y + ZONE.enemyField().h * 0.5, w: 60, h: 60, x: canvas.width * 0.8 - 30, y: 0 };
    spawnFloatingNumber('-' + amount, r, colorDef.hex, colorDef.glow);
    triggerShake(5);
    if (enemyHP <= 0) { gameOver = 'win'; phase = 'gameover'; }
  }
}

function applyHeroHeal(target, amount) {
  if (target === 'player') {
    playerHP = Math.min(MAX_HP, playerHP + amount);
    const r = { cx: canvas.width * 0.2, cy: ZONE.playerField().y + 30, w: 40, h: 40, x: 0, y: 0 };
    spawnFloatingNumber('+' + amount, r, '#22DD55', '#88ffaa');
  } else {
    enemyHP = Math.min(MAX_HP, enemyHP + amount);
  }
}

// ─── Card combat ──────────────────────────────────────────────────────────────
function resolveAttack(atkIsPlayer, atkIdx, targetIsHero, tgtIdx) {
  if (animLock || gameOver) return;
  const atkField = atkIsPlayer ? playerField : enemyField;
  const defField = atkIsPlayer ? enemyField  : playerField;
  const attacker = atkField[atkIdx];
  if (!attacker) return;

  // Taunt enforcement
  if (!targetIsHero) {
    const hasTaunt = defField.some(c => c && c.ability === 'taunt');
    if (hasTaunt && defField[tgtIdx] && defField[tgtIdx].ability !== 'taunt') return;
  }

  attacker.hasAttacked = true;
  animLock = true;
  bgPulse  = 0.7;
  playSound(attacker.id);

  const src = fieldSlotRect(atkIsPlayer ? 'player' : 'enemy', atkIdx);
  const dst = targetIsHero
    ? { cx: atkIsPlayer ? canvas.width * 0.75 : canvas.width * 0.25, cy: atkIsPlayer ? ZONE.topHud().y + ZONE.topHud().h * 0.5 : ZONE.bottomHud().y + ZONE.bottomHud().h * 0.5, w: 50, h: 50, x: 0, y: 0 }
    : fieldSlotRect(atkIsPlayer ? 'enemy' : 'player', tgtIdx);

  if (atkIsPlayer) playerFlash = { color: attacker.colorDef, t: 0 };
  else             enemyFlash  = { color: attacker.colorDef, t: 0 };

  setTimeout(() => _dispatchBeamAt(attacker.colorDef, src, dst), 120);

  setTimeout(() => {
    if (targetIsHero) {
      applyHeroDamage(atkIsPlayer ? 'enemy' : 'player', attacker.attack, attacker.colorDef);
      if (atkIsPlayer) enemyImpact  = { color: attacker.colorDef, t: 0 };
      else             playerImpact = { color: attacker.colorDef, t: 0 };
    } else {
      const defender = defField[tgtIdx];
      if (!defender) { animLock = false; return; }
      const atkRect = fieldSlotRect(atkIsPlayer ? 'player' : 'enemy', atkIdx);
      const defRect = fieldSlotRect(atkIsPlayer ? 'enemy' : 'player', tgtIdx);
      if (attacker.attack > 0) {
        defender.defense -= attacker.attack;
        spawnFloatingNumber('-' + attacker.attack, defRect, attacker.colorDef.hex, attacker.colorDef.glow);
      }
      if (defender.attack > 0) {
        attacker.defense -= defender.attack;
        spawnFloatingNumber('-' + defender.attack, atkRect, defender.colorDef.hex, defender.colorDef.glow);
      }
      _dispatchImpactAt(attacker.colorDef, defRect);
      triggerShake(attacker.attack >= 3 ? 7 : 3);
      if (defender.defense <= 0) setTimeout(() => killCard(defField, tgtIdx, defRect), 250);
      if (attacker.defense <= 0) setTimeout(() => killCard(atkField, atkIdx, atkRect), 250);
    }
    setTimeout(() => { animLock = false; }, 400);
  }, 620);
}

function killCard(field, idx, rect) {
  const card = field[idx];
  if (!card) return;
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2;
    const speed = rand(3, 8) * devicePixelRatio;
    particles.push({ type: 'spark', color: card.colorDef.hex, glow: card.colorDef.glow,
      x: rect.cx, y: rect.cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: rand(3, 7), life: 1, alpha: 1 });
  }
  particles.push({ type: 'ring', color: card.colorDef.hex, glow: card.colorDef.glow,
    x: rect.cx, y: rect.cy, radius: 0, maxRadius: rect.w * 0.9, life: 1, alpha: 1, speed: 0.03 });
  field[idx] = null;
}

// ─── Merge system ─────────────────────────────────────────────────────────────
function spawnMergeBurst(srcRect, dstRect, colorDef) {
  for (let i = 0; i < 22; i++) {
    const angle = (i / 22) * Math.PI * 2;
    const dist  = rand(50, 110) * devicePixelRatio;
    particles.push({
      type: 'implode', color: '#FFD700', glow: '#ffe87a',
      x: dstRect.cx + Math.cos(angle) * dist,
      y: dstRect.cy + Math.sin(angle) * dist,
      tx: dstRect.cx, ty: dstRect.cy,
      size: rand(7, 16), life: 1, alpha: 1, phase: 'in',
    });
  }
  particles.push({ type: 'ring', color: '#FFD700', glow: '#ffe87a',
    x: dstRect.cx, y: dstRect.cy,
    radius: 0, maxRadius: dstRect.w * 1.8, life: 1, alpha: 1, speed: 0.022 });
  for (let i = 0; i < 28; i++) {
    const angle = (i / 28) * Math.PI * 2;
    const speed = rand(5, 13) * devicePixelRatio;
    particles.push({ type: 'spark', color: colorDef.hex, glow: colorDef.glow,
      x: dstRect.cx, y: dstRect.cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: rand(4, 9), life: 1, alpha: 1 });
  }
  particles.push({ type: 'ring', color: '#ffffff', glow: '#ffffff',
    x: dstRect.cx, y: dstRect.cy,
    radius: 0, maxRadius: dstRect.w * 0.9, life: 1, alpha: 0.9, speed: 0.04 });
}

function mergeCards(keepIdx, removeIdx) {
  if (animLock || gameOver) return;
  const keep   = playerField[keepIdx];
  const remove = playerField[removeIdx];
  if (!keep || !remove || keep.id !== remove.id || keep.level >= MAX_LEVEL) return;
  const merged = getMergedCard(keep);
  animLock = true; bgPulse = 0.9;
  const keepR   = fieldSlotRect('player', keepIdx);
  const removeR = fieldSlotRect('player', removeIdx);
  spawnMergeBurst(removeR, keepR, keep.colorDef);
  playSound(keep.id);
  setTimeout(() => {
    playerField[removeIdx] = null;
    playerField[keepIdx]   = merged;
    selectedFieldIdx = null;
    spawnFloatingNumber('LVL ' + merged.level + '!', keepR, '#FFD700', '#ffe87a');
    triggerShake(4);
    setTimeout(() => { animLock = false; }, 200);
  }, 420);
}

function mergeFromHand(handIdx, fieldIdx) {
  if (animLock || gameOver) return;
  const handCard  = playerHand[handIdx];
  const fieldCard = playerField[fieldIdx];
  if (!handCard || !fieldCard || handCard.id !== fieldCard.id || fieldCard.level >= MAX_LEVEL) return;
  const merged = getMergedCard(fieldCard);
  animLock = true; bgPulse = 0.9;
  const fieldR = fieldSlotRect('player', fieldIdx);
  spawnMergeBurst(fieldR, fieldR, fieldCard.colorDef);
  playSound(fieldCard.id);
  setTimeout(() => {
    playerHand.splice(handIdx, 1);
    playerField[fieldIdx] = merged;
    selectedHandIdx = null;
    spawnFloatingNumber('LVL ' + merged.level + '!', fieldR, '#FFD700', '#ffe87a');
    triggerShake(4);
    setTimeout(() => { animLock = false; }, 200);
  }, 420);
}

// ─── Enemy merge helpers ──────────────────────────────────────────────────────
function mergeEnemyCards(keepIdx, removeIdx) {
  if (gameOver) return;
  const keep   = enemyField[keepIdx];
  const remove = enemyField[removeIdx];
  if (!keep || !remove || keep.id !== remove.id || keep.level >= MAX_LEVEL) return;
  const merged = getMergedCard(keep);
  bgPulse = 0.7;
  const keepR   = fieldSlotRect('enemy', keepIdx);
  const removeR = fieldSlotRect('enemy', removeIdx);
  spawnMergeBurst(removeR, keepR, keep.colorDef);
  playSound(keep.id);
  setTimeout(() => {
    enemyField[removeIdx] = null;
    enemyField[keepIdx]   = merged;
    spawnFloatingNumber('LVL ' + merged.level + '!', keepR, '#FF6666', '#ff9999');
    triggerShake(3);
  }, 420);
}

function mergeEnemyFromHand(handCard, fieldIdx) {
  if (gameOver) return;
  const fieldCard = enemyField[fieldIdx];
  if (!handCard || !fieldCard || handCard.id !== fieldCard.id || fieldCard.level >= MAX_LEVEL) return;
  const merged = getMergedCard(fieldCard);
  bgPulse = 0.7;
  const fieldR = fieldSlotRect('enemy', fieldIdx);
  const hIdx   = enemyHand.indexOf(handCard);
  if (hIdx === -1) return;
  spawnMergeBurst(fieldR, fieldR, fieldCard.colorDef);
  playSound(fieldCard.id);
  setTimeout(() => {
    const currentIdx = enemyHand.indexOf(handCard);
    if (currentIdx !== -1) enemyHand.splice(currentIdx, 1);
    enemyField[fieldIdx] = merged;
    spawnFloatingNumber('LVL ' + merged.level + '!', fieldR, '#FF6666', '#ff9999');
    triggerShake(3);
  }, 420);
}

// ─── Enemy AI ─────────────────────────────────────────────────────────────────
function runEnemyAI() {
  if (gameOver) return;
  let delay = 100;

  // ── Step 1: Field-to-field merges (free power spike) ──────────────────────
  // Snapshot which field slots share the same color
  const fieldMerges = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    for (let j = i + 1; j < MAX_SLOTS; j++) {
      const a = enemyField[i], b = enemyField[j];
      if (a && b && a.id === b.id && a.level < MAX_LEVEL) {
        // merge the lower-level one into the higher (or first if equal)
        const keepIdx   = a.level >= b.level ? i : j;
        const removeIdx = keepIdx === i ? j : i;
        fieldMerges.push({ keepIdx, removeIdx });
        break; // one merge per slot per turn
      }
    }
    if (fieldMerges.length >= 2) break; // cap at 2 merges/turn to keep pace
  }
  for (const { keepIdx, removeIdx } of fieldMerges) {
    const k = keepIdx, r = removeIdx;
    setTimeout(() => { if (!gameOver) mergeEnemyCards(k, r); }, delay);
    delay += 800;
  }

  // ── Step 2: Hand-to-field merges (upgrade before playing new cards) ────────
  // Only do this if the AI has a card in hand matching a field card
  const usedFieldSlots = new Set();
  const handMerges = [];
  for (const handCard of [...enemyHand]) {
    for (let fi = 0; fi < MAX_SLOTS; fi++) {
      if (usedFieldSlots.has(fi)) continue;
      const fc = enemyField[fi];
      if (fc && fc.id === handCard.id && fc.level < MAX_LEVEL) {
        handMerges.push({ handCard, fi });
        usedFieldSlots.add(fi);
        break;
      }
    }
    if (handMerges.length >= 2) break; // cap at 2 hand-merges/turn
  }
  for (const { handCard, fi } of handMerges) {
    const capturedCard = handCard, capturedFi = fi;
    setTimeout(() => { if (!gameOver) mergeEnemyFromHand(capturedCard, capturedFi); }, delay);
    delay += 800;
  }

  // ── Step 3: Play affordable cards (cheapest first) ────────────────────────
  delay += 200;
  const playable = enemyHand
    .map((c, i) => ({ card: c, i }))
    .filter(x => x.card && x.card.manaCost <= enemyMana)
    .sort((a, b) => a.card.manaCost - b.card.manaCost);

  for (const { card } of playable) {
    const slot = enemyField.findIndex(s => s === null);
    if (slot === -1) break;
    setTimeout(() => {
      if (gameOver) return;
      const hIdx = enemyHand.indexOf(card);
      if (hIdx === -1 || enemyMana < card.manaCost || enemyField[slot] !== null) return;
      enemyMana -= card.manaCost;
      card.summoningSickness = card.ability !== 'charge';
      enemyField[slot] = card;
      enemyHand.splice(hIdx, 1);
      playPutCardSound();
      playSound(card.id);
      bgPulse = 0.35;
    }, delay);
    delay += 700;
  }

  // ── Step 4: Attack with each field card ───────────────────────────────────
  delay += 300;
  for (let idx = 0; idx < MAX_SLOTS; idx++) {
    const capturedIdx = idx;
    setTimeout(() => {
      if (gameOver) return;
      const card = enemyField[capturedIdx];
      if (!card || card.hasAttacked || card.summoningSickness || card.attack === 0) return;

      const tauntIdx = playerField.findIndex(c => c && c.ability === 'taunt');
      if (tauntIdx !== -1) {
        resolveAttack(false, capturedIdx, false, tauntIdx);
        return;
      }
      const targets = playerField.map((c, i) => c ? i : -1).filter(i => i !== -1);
      // Prefer attacking high-value player cards; fallback to hero
      if (targets.length > 0 && Math.random() < 0.55) {
        resolveAttack(false, capturedIdx, false, targets[Math.floor(Math.random() * targets.length)]);
      } else {
        resolveAttack(false, capturedIdx, true, -1);
      }
    }, delay);
    delay += 950;
  }

  setTimeout(() => { if (!gameOver) startPlayerTurn(); }, delay + 400);
}

// ─── Input ────────────────────────────────────────────────────────────────────
function getEventPos(e) {
  const r = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / r.width;
  const scaleY = canvas.height / r.height;
  const src = (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0]
            : (e.touches && e.touches.length > 0) ? e.touches[0]
            : e;
  return { x: (src.clientX - r.left) * scaleX, y: (src.clientY - r.top) * scaleY };
}

function handleClickLogic(pos) {
  if (gameOver) { resetGame(); return; }
  if (phase === 'enemy') return;

  if (pointIn(pos.x, pos.y, endTurnRect())) { endPlayerTurn(); return; }

  for (let i = 0; i < MAX_SLOTS; i++) {
    const r = fieldSlotRect('player', i);
    if (pointIn(pos.x, pos.y, r)) {
      if (selectedHandIdx !== null) {
        const card = playerHand[selectedHandIdx];
        // Hand→field merge: same color, field card exists and not max level
        if (playerField[i] !== null && playerField[i].id === card.id && playerField[i].level < MAX_LEVEL) {
          mergeFromHand(selectedHandIdx, i); return;
        }
        if (playerField[i] !== null || playerMana < card.manaCost) { selectedHandIdx = null; return; }
        playerMana -= card.manaCost;
        card.summoningSickness = card.ability !== 'charge';
        playerField[i] = card;
        playerHand.splice(selectedHandIdx, 1);
        selectedHandIdx = null;
        playPutCardSound(); bgPulse = 0.5;
        return;
      }
      const card = playerField[i];
      // Field→field merge: selected card + clicked same-color card
      if (selectedFieldIdx !== null && selectedFieldIdx !== i && card) {
        const selCard = playerField[selectedFieldIdx];
        if (selCard && selCard.id === card.id && card.level < MAX_LEVEL) {
          mergeCards(i, selectedFieldIdx); return;
        }
      }
      if (card && !card.hasAttacked && !card.summoningSickness) {
        selectedFieldIdx = selectedFieldIdx === i ? null : i;
        selectedHandIdx  = null;
      } else {
        selectedFieldIdx = null;
      }
      return;
    }
  }

  if (selectedFieldIdx !== null) {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const r = fieldSlotRect('enemy', i);
      if (pointIn(pos.x, pos.y, r)) {
        if (enemyField[i]) {
          resolveAttack(true, selectedFieldIdx, false, i);
          selectedFieldIdx = null;
          return;
        }
        // Click empty enemy slot = direct face attack when field is clear
        if (!enemyField.some(c => c && c.ability === 'taunt')) {
          resolveAttack(true, selectedFieldIdx, true, -1);
          selectedFieldIdx = null;
          return;
        }
      }
    }
    const tZ = ZONE.topHud();
    if (pos.y >= tZ.y && pos.y <= tZ.y + tZ.h) {
      if (!enemyField.some(c => c && c.ability === 'taunt')) {
        resolveAttack(true, selectedFieldIdx, true, -1);
        selectedFieldIdx = null;
      }
      return;
    }
    selectedFieldIdx = null;
  }
}

function onPointerDown(e) {
  e.preventDefault();
  if (gameOver) { resetGame(); return; }
  const pos = getEventPos(e);
  const hn  = playerHand.length;
  for (let i = hn - 1; i >= 0; i--) {
    if (hitTestHandCard(pos.x, pos.y, i, hn)) {
      dragState = { card: playerHand[i], handIdx: i, x: pos.x, y: pos.y, startX: pos.x, startY: pos.y, isDragging: false, hoverSlot: -1 };
      return;
    }
  }
  handleClickLogic(pos);
}

function onPointerMove(e) {
  if (!dragState) return;
  e.preventDefault();
  const pos = getEventPos(e);
  dragState.x = pos.x; dragState.y = pos.y;
  const dx = pos.x - dragState.startX, dy = pos.y - dragState.startY;
  if (!dragState.isDragging && (Math.abs(dx) > 8 * devicePixelRatio || Math.abs(dy) > 8 * devicePixelRatio)) {
    dragState.isDragging = true;
    selectedHandIdx = null;
  }
  if (dragState.isDragging) {
    dragState.hoverSlot = -1;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const r = fieldSlotRect('player', i);
      if (pointIn(pos.x, pos.y, r)) { dragState.hoverSlot = i; break; }
    }
  }
}

function onPointerUp(e) {
  if (!dragState) return;
  e.preventDefault();
  const pos = getEventPos(e);
  if (!dragState.isDragging) {
    selectedFieldIdx = null;
    selectedHandIdx  = selectedHandIdx === dragState.handIdx ? null : dragState.handIdx;
    dragState = null;
    return;
  }
  // Check release position directly — more reliable than last mousemove hoverSlot
  let slot = -1;
  for (let i = 0; i < MAX_SLOTS; i++) {
    const r = fieldSlotRect('player', i);
    if (pointIn(pos.x, pos.y, r)) { slot = i; break; }
  }
  if (slot === -1) slot = dragState.hoverSlot; // fallback to last known hover
  const card = dragState.card;
  if (slot !== -1 && phase !== 'enemy') {
    const existing = playerField[slot];
    if (existing && existing.id === card.id && existing.level < MAX_LEVEL) {
      // Drag→field merge
      mergeFromHand(dragState.handIdx, slot);
      dragState = null; return;
    } else if (!existing && playerMana >= card.manaCost) {
      playerMana -= card.manaCost;
      card.summoningSickness = card.ability !== 'charge';
      playerField[slot] = card;
      playerHand.splice(dragState.handIdx, 1);
      selectedHandIdx = null;
      playPutCardSound(); bgPulse = 0.5;
    }
  }
  dragState = null;
}

canvas.addEventListener('mousedown',  onPointerDown);
canvas.addEventListener('mousemove',  onPointerMove);
canvas.addEventListener('mouseup',    onPointerUp);
canvas.addEventListener('touchstart', onPointerDown, { passive: false });
canvas.addEventListener('touchmove',  onPointerMove, { passive: false });
canvas.addEventListener('touchend',   onPointerUp,   { passive: false });

// ─── Reset / init ─────────────────────────────────────────────────────────────
function resetGame() {
  playerHP = MAX_HP; enemyHP = MAX_HP;
  playerMana = 2; playerMaxMana = 2;
  enemyMana  = 2; enemyMaxMana  = 2;
  playerField = [null, null, null, null, null];
  enemyField  = [null, null, null, null, null];
  playerHand  = []; enemyHand = [];
  currentTurn = 'player'; turnNumber = 1; phase = 'play'; gameOver = false;
  selectedHandIdx = null; selectedFieldIdx = null; animLock = false;
  particles = [];
  playerFlash = null; enemyFlash = null; enemyImpact = null; playerImpact = null;
  shake = { intensity: 0, duration: 0, elapsed: 0 }; bgPulse = 0; dragState = null;
  dealOpening();
  // Give player first turn mana immediately
  playerMaxMana = 2; playerMana = 2;
}

// ─── Canvas resize ────────────────────────────────────────────────────────────
function resize() {
  canvas.width  = canvas.clientWidth  * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  initStars();
}
window.addEventListener('resize', resize);
resize();

// ─── Audio ────────────────────────────────────────────────────────────────────
const putCardAudio = new Audio('src/sfx/put-card.mp3');
putCardAudio.preload = 'auto';

function playPutCardSound() {
  try {
    putCardAudio.currentTime = 0;
    putCardAudio.play();
  } catch (e) {}
}

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playSound(colorId) {
  try {
    const ac = getAudio();
    const now = ac.currentTime;
    switch (colorId) {
      case 'yellow': {
        const g = ac.createGain();
        g.gain.setValueAtTime(0.28, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
        g.connect(ac.destination);
        const o = ac.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(900, now);
        o.frequency.exponentialRampToValueAtTime(420, now + 0.12);
        o.connect(g); o.start(now); o.stop(now + 0.32);
        break;
      }
      case 'orange': {
        const g = ac.createGain();
        g.gain.setValueAtTime(0.22, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        g.connect(ac.destination);
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(240, now);
        o.frequency.exponentialRampToValueAtTime(80, now + 0.6);
        o.connect(g); o.start(now); o.stop(now + 0.65);
        break;
      }
      case 'red': {
        const bufLen = ac.sampleRate * 0.3;
        const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;
        const src = ac.createBufferSource(); src.buffer = buf;
        const filter = ac.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(300, now);
        filter.frequency.exponentialRampToValueAtTime(60, now + 0.25);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.55, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
        src.connect(filter); filter.connect(g); g.connect(ac.destination);
        src.start(now); src.stop(now + 0.3);
        break;
      }
      case 'purple': {
        const g = ac.createGain();
        g.gain.setValueAtTime(0.2, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        g.connect(ac.destination);
        const o = ac.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(180, now);
        o.frequency.exponentialRampToValueAtTime(520, now + 0.45);
        o.connect(g); o.start(now); o.stop(now + 0.55);
        break;
      }
      case 'blue': {
        const g = ac.createGain();
        g.gain.setValueAtTime(0.001, now);
        g.gain.linearRampToValueAtTime(0.25, now + 0.04);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        g.connect(ac.destination);
        const o = ac.createOscillator();
        o.type = 'sine'; o.frequency.setValueAtTime(1047, now);
        o.connect(g); o.start(now); o.stop(now + 0.5);
        break;
      }
      case 'green': {
        [[523, 0.18], [659, 0.14]].forEach(([freq, vol]) => {
          const g = ac.createGain();
          g.gain.setValueAtTime(0.001, now);
          g.gain.linearRampToValueAtTime(vol, now + 0.08);
          g.gain.exponentialRampToValueAtTime(0.001, now + 0.85);
          g.connect(ac.destination);
          const o = ac.createOscillator();
          o.type = 'sine'; o.frequency.setValueAtTime(freq, now);
          o.connect(g); o.start(now); o.stop(now + 0.85);
        });
        break;
      }
    }
  } catch (_) { /* audio blocked */ }
}

// ─── Starfield ────────────────────────────────────────────────────────────────
function initStars() {
  stars.length = 0;
  const layerSpeeds = [0.55, 1.0, 1.6];
  for (let i = 0; i < STAR_COUNT; i++) {
    const layer = i % 3;
    stars.push({
      nx: Math.random(), ny: Math.random(),
      size: Math.random() * 1.2 + 0.4,
      speed: (Math.random() * 0.04 + 0.01) * layerSpeeds[layer],
      opacity: Math.random() * 0.45 + 0.12,
      layer,
    });
  }
}

function updateStars(dt) {
  for (const s of stars) {
    s.ny += s.speed * dt * 0.00018;
    if (s.ny > 1) { s.ny = 0; s.nx = Math.random(); }
  }
  if (bgPulse > 0) bgPulse = Math.max(0, bgPulse - dt * 0.003);
}

function drawStars() {
  const layerColors = ['#ffffff', '#cce8ff', '#fffbe6'];
  for (const s of stars) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, s.opacity + bgPulse * 0.35);
    ctx.fillStyle = layerColors[s.layer];
    ctx.beginPath();
    ctx.arc(s.nx * canvas.width, s.ny * canvas.height, s.size * devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ─── Screen shake ─────────────────────────────────────────────────────────────
function triggerShake(intensity) {
  shake.intensity = intensity * devicePixelRatio;
  shake.duration  = 280;
  shake.elapsed   = 0;
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────
function rand(min, max)    { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

function setGlow(color, blur)  { ctx.shadowColor = color; ctx.shadowBlur = blur; }
function clearGlow()            { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; }

function drawRoundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function lerpColor(a, b, t) {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const rr = Math.round(ar + (br-ar)*t), rg = Math.round(ag + (bg-ag)*t), rb = Math.round(ab + (bb-ab)*t);
  return '#' + ((1<<24)|(rr<<16)|(rg<<8)|rb).toString(16).slice(1);
}

// ─── Health bar ───────────────────────────────────────────────────────────────
function drawHealthBar(x, y, w, h, pct, glowColor, maxHp) {
  const r = h * 0.4;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  drawRoundRect(x, y, w, h, r); ctx.fill();
  if (pct > 0) {
    const fillW = Math.max(r * 2, (w - 2) * pct);
    const barCol = pct > 0.5 ? lerpColor('#22DD55', '#FFD700', (1-pct)*2) : lerpColor('#FFD700', '#FF2222', (0.5-pct)*2);
    if (pct < 0.3) setGlow(glowColor, 14);
    const grad = ctx.createLinearGradient(x + 1, y, x + 1 + fillW, y);
    grad.addColorStop(0, barCol); grad.addColorStop(1, barCol + '99');
    ctx.fillStyle = grad;
    drawRoundRect(x + 1, y + 1, fillW, h - 2, r); ctx.fill();
    clearGlow();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  drawRoundRect(x, y, w, h, r); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = `bold ${Math.max(9, h * 0.72)}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(Math.ceil(pct * maxHp) + ' / ' + maxHp, x + w * 0.5, y + h * 0.5);
}

// ─── Floating numbers ─────────────────────────────────────────────────────────
function spawnFloatingNumber(text, rect, color, glow) {
  particles.push({
    type: 'floatNum', text, color, glow,
    x: rect.cx + rand(-rect.w * 0.15, rect.w * 0.15),
    y: rect.y !== undefined ? rect.y + rect.h * 0.2 : rect.cy - 20,
    life: 1, alpha: 1,
    fontSize: Math.max(16 * devicePixelRatio, (rect.w || 60) * 0.28),
  });
}

// ─── Beam spawners ────────────────────────────────────────────────────────────
function _dispatchBeamAt(colorDef, src, dst) {
  switch (colorDef.id) {
    case 'yellow': spawnLightning(src, dst, colorDef); break;
    case 'orange': spawnFlame(src, dst, colorDef);     break;
    case 'red':    spawnBurst(src, dst, colorDef);     break;
    case 'purple': spawnSpiral(src, dst, colorDef);    break;
    case 'blue':   spawnWave(src, dst, colorDef);      break;
    case 'green':  spawnHealParticles(src);            break;
  }
}

function _dispatchImpactAt(colorDef, rect) {
  switch (colorDef.id) {
    case 'yellow': spawnElectricBurst(rect, colorDef); break;
    case 'orange': spawnFireSplash(rect, colorDef);    break;
    case 'red':    spawnShrapnel(rect, colorDef);      break;
    case 'purple': spawnImplosion(rect, colorDef);     break;
    case 'blue':   spawnIceShatter(rect, colorDef);    break;
  }
}

function spawnHealParticles(rect) {
  for (let i = 0; i < 14; i++) {
    particles.push({
      type: 'heal', color: '#22DD55', glow: '#88ffaa',
      x: rect.cx + rand(-rect.w * 0.4, rect.w * 0.4),
      y: rect.cy + rand(-rect.h * 0.4, rect.h * 0.4),
      vy: rand(1.5, 3) * devicePixelRatio,
      size: rand(4, 8), life: 1, alpha: 1,
    });
  }
}

function spawnLightning(src, dst, c) {
  for (let b = 0; b < 5; b++) {
    setTimeout(() => {
      particles.push({
        type: 'lightning', color: c.hex, glow: c.glow,
        sx: src.cx, sy: src.cy, ex: dst.cx, ey: dst.cy,
        t: 0, life: 1, speed: 0.045 + rand(0, 0.02),
        width: rand(1.5, 3.5), segments: randInt(6, 10),
        amp: rand(18, 38), alpha: rand(0.7, 1.0),
      });
    }, b * 60);
  }
}

function spawnFlame(src, dst, c) {
  const count = 24;
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      particles.push({
        type: 'flame', color: c.hex, glow: c.glow,
        x: src.cx + rand(-12, 12), y: src.cy + rand(-12, 12),
        tx: dst.cx, ty: dst.cy,
        t: 0, life: 1, speed: rand(0.012, 0.022),
        size: rand(10, 22), wobble: rand(0, Math.PI * 2),
        wobbleSpeed: rand(3, 6), alpha: 1,
      });
    }, i * 18);
  }
}

function spawnBurst(src, dst, c) {
  const baseAngle = Math.atan2(dst.cy - src.cy, dst.cx - src.cx);
  for (let i = 0; i < 18; i++) {
    const angle = baseAngle + (Math.random() - 0.5) * 0.7;
    const speed = rand(6, 13) * devicePixelRatio;
    particles.push({
      type: 'projectile', color: c.hex, glow: c.glow,
      x: src.cx, y: src.cy,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      tx: dst.cx, ty: dst.cy,
      size: rand(4, 9), life: 1, alpha: 1,
    });
  }
}

function spawnSpiral(src, dst, c) {
  for (let i = 0; i < 20; i++) {
    setTimeout(() => {
      particles.push({
        type: 'spiral', color: c.hex, glow: c.glow,
        sx: src.cx, sy: src.cy, ex: dst.cx, ey: dst.cy,
        t: 0, life: 1, speed: rand(0.018, 0.028),
        orbitRadius: rand(20, 55), orbitAngle: rand(0, Math.PI * 2),
        orbitSpeed: rand(4, 9) * (Math.random() > 0.5 ? 1 : -1),
        size: rand(5, 12), alpha: 1,
      });
    }, i * 22);
  }
}

function spawnWave(src, dst, c) {
  for (let row = -2; row <= 2; row++) {
    for (let col = 0; col < 8; col++) {
      setTimeout(() => {
        particles.push({
          type: 'wave', color: c.hex, glow: c.glow,
          sx: src.cx, sy: src.cy + row * 16 * devicePixelRatio,
          ex: dst.cx, ey: dst.cy + row * 16 * devicePixelRatio,
          t: 0, life: 1, speed: 0.025,
          size: rand(10, 18), alpha: 1,
        });
      }, col * 55);
    }
  }
}

// ─── Impact spawners ──────────────────────────────────────────────────────────
function spawnElectricBurst(e, c) {
  particles.push({ type: 'ring', color: c.hex, glow: c.glow, x: e.cx, y: e.cy,
    radius: 0, maxRadius: e.w * 1.2, life: 1, alpha: 1, speed: 0.03 });
  for (let i = 0; i < 24; i++) {
    const angle = (i / 24) * Math.PI * 2;
    const speed = rand(3, 7) * devicePixelRatio;
    particles.push({ type: 'spark', color: c.hex, glow: c.glow,
      x: e.cx, y: e.cy, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      size: rand(2, 5), life: 1, alpha: 1 });
  }
}

function spawnFireSplash(e, c) {
  for (let i = 0; i < 28; i++) {
    const angle = rand(0, Math.PI * 2), speed = rand(2, 8) * devicePixelRatio;
    particles.push({ type: 'fireDrop', color: c.hex, glow: c.glow,
      x: e.cx, y: e.cy,
      vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - rand(1,3)*devicePixelRatio,
      size: rand(8, 20), life: 1, alpha: 1 });
  }
}

function spawnShrapnel(e, c) {
  for (let i = 0; i < 30; i++) {
    const angle = (i / 30) * Math.PI * 2 + rand(-0.1, 0.1);
    const speed = rand(5, 14) * devicePixelRatio;
    particles.push({ type: 'shrapnel', color: c.hex, glow: c.glow,
      x: e.cx, y: e.cy,
      vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      size: rand(2, 6), life: 1, alpha: 1 });
  }
}

function spawnImplosion(e, c) {
  for (let i = 0; i < 20; i++) {
    const angle = rand(0, Math.PI * 2), dist = rand(e.w * 0.6, e.w * 1.4);
    particles.push({ type: 'implode', color: c.hex, glow: c.glow,
      x: e.cx + Math.cos(angle)*dist, y: e.cy + Math.sin(angle)*dist,
      tx: e.cx, ty: e.cy, size: rand(6, 14), life: 1, alpha: 1, phase: 'in' });
  }
  setTimeout(() => {
    for (let i = 0; i < 20; i++) {
      const angle = rand(0, Math.PI * 2), speed = rand(3, 9) * devicePixelRatio;
      particles.push({ type: 'spark', color: c.glow, glow: c.glow,
        x: e.cx, y: e.cy, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
        size: rand(4, 10), life: 1, alpha: 1 });
    }
  }, 400);
}

function spawnIceShatter(e, c) {
  particles.push({ type: 'iceRing', color: c.hex, glow: c.glow,
    x: e.cx, y: e.cy, radius: 0, maxRadius: e.w * 1.3, life: 1, alpha: 0.85, speed: 0.02 });
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2, speed = rand(1, 4) * devicePixelRatio;
    particles.push({ type: 'iceShard', color: c.hex, glow: c.glow,
      x: e.cx + Math.cos(angle)*e.w*0.09, y: e.cy + Math.sin(angle)*e.w*0.09,
      vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      size: rand(6, 18), angle: rand(0, Math.PI*2), life: 1, alpha: 0.9 });
  }
}

// ─── Particle update ──────────────────────────────────────────────────────────
function updateParticles(dt) {
  particles = particles.filter(p => p.life > 0);
  for (const p of particles) {
    switch (p.type) {
      case 'lightning':  updateLightning(p, dt);  break;
      case 'flame':      updateFlame(p, dt);       break;
      case 'projectile': updateProjectile(p, dt);  break;
      case 'spiral':     updateSpiral(p, dt);      break;
      case 'wave':       updateWave(p, dt);        break;
      case 'heal':       updateHeal(p, dt);        break;
      case 'glowPulse':  updateGlowPulse(p, dt);  break;
      case 'ring':       updateRing(p, dt);        break;
      case 'spark':      updateSpark(p, dt);       break;
      case 'fireDrop':   updateFireDrop(p, dt);    break;
      case 'shrapnel':   updateShrapnel(p, dt);    break;
      case 'implode':    updateImplode(p, dt);     break;
      case 'iceRing':    updateIceRing(p, dt);     break;
      case 'iceShard':   updateIceShard(p, dt);    break;
      case 'floatNum':   updateFloatNum(p, dt);    break;
    }
  }
}

function drawParticles() {
  for (const p of particles) {
    if (p.alpha <= 0) continue;
    switch (p.type) {
      case 'lightning':  drawLightning(p);  break;
      case 'flame':      drawFlame(p);      break;
      case 'projectile': drawProjectile(p); break;
      case 'spiral':     drawSpiral(p);     break;
      case 'wave':       drawWave(p);       break;
      case 'heal':       drawHeal(p);       break;
      case 'glowPulse':  drawGlowPulse(p); break;
      case 'ring':       drawRing(p);       break;
      case 'spark':      drawSpark(p);      break;
      case 'fireDrop':   drawFireDrop(p);   break;
      case 'shrapnel':   drawShrapnel(p);   break;
      case 'implode':    drawImplode(p);    break;
      case 'iceRing':    drawIceRing(p);    break;
      case 'iceShard':   drawIceShard(p);   break;
      case 'floatNum':   drawFloatNum(p);   break;
    }
  }
}

function updateLightning(p, dt) { p.t += p.speed * dt; if (p.t >= 1) { p.life = 0; return; } p.alpha = p.t < 0.5 ? 1 : 1 - (p.t - 0.5) * 2; }
function drawLightning(p) {
  const pts = [];
  for (let i = 0; i <= p.segments; i++) {
    const tt = i / p.segments;
    const bx = p.sx + (p.ex - p.sx) * tt, by = p.sy + (p.ey - p.sy) * tt;
    const perp = { x: -(p.ey - p.sy), y: p.ex - p.sx };
    const len = Math.sqrt(perp.x*perp.x + perp.y*perp.y);
    const jit = (i > 0 && i < p.segments) ? (Math.random()-0.5)*p.amp : 0;
    pts.push({ x: bx + (perp.x/len)*jit, y: by + (perp.y/len)*jit });
  }
  ctx.save(); ctx.globalAlpha = p.alpha * p.alpha;
  setGlow(p.glow, 18); ctx.strokeStyle = p.color; ctx.lineWidth = p.width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke(); clearGlow(); ctx.restore();
}

function updateFlame(p, dt) { p.t += p.speed * dt; if (p.t >= 1) { p.life = 0; return; } p.alpha = p.t < 0.7 ? 1 : 1-(p.t-0.7)/0.3; p.wobble += p.wobbleSpeed * dt * 0.016; }
function drawFlame(p) {
  const x = p.x + (p.tx-p.x)*p.t + Math.sin(p.wobble)*12, y = p.y + (p.ty-p.y)*p.t + Math.cos(p.wobble*0.7)*8;
  const size = p.size * (1 - p.t*0.5);
  ctx.save(); ctx.globalAlpha = p.alpha;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.3, p.color); grad.addColorStop(1, 'transparent');
  setGlow(p.glow, 14); ctx.fillStyle = grad;
  ctx.beginPath(); ctx.ellipse(x, y, size*0.6, size, 0, 0, Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

function updateProjectile(p, dt) { p.x += p.vx*dt*0.016; p.y += p.vy*dt*0.016; const dx=p.tx-p.x,dy=p.ty-p.y; const dist=Math.sqrt(dx*dx+dy*dy); p.life=dist>5?1:0; p.alpha=Math.min(1,dist/60); }
function drawProjectile(p) { ctx.save(); ctx.globalAlpha=p.alpha; setGlow(p.glow,10); ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill(); clearGlow(); ctx.restore(); }

function updateSpiral(p, dt) { p.t += p.speed*dt; if (p.t>=1){p.life=0;return;} p.orbitAngle += p.orbitSpeed*dt*0.016; p.alpha = p.t<0.8?1:1-(p.t-0.8)/0.2; }
function drawSpiral(p) {
  const bx=p.sx+(p.ex-p.sx)*p.t, by=p.sy+(p.ey-p.sy)*p.t, decay=1-p.t;
  const x=bx+Math.cos(p.orbitAngle)*p.orbitRadius*decay, y=by+Math.sin(p.orbitAngle)*p.orbitRadius*decay;
  ctx.save(); ctx.globalAlpha=p.alpha; setGlow(p.glow,16);
  const grad=ctx.createRadialGradient(x,y,0,x,y,p.size);
  grad.addColorStop(0,'#ffffff'); grad.addColorStop(0.4,p.color); grad.addColorStop(1,'transparent');
  ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(x,y,p.size,0,Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

function updateWave(p, dt) { p.t += p.speed*dt; if (p.t>=1){p.life=0;return;} p.alpha=p.t<0.85?1:1-(p.t-0.85)/0.15; }
function drawWave(p) {
  const x=p.sx+(p.ex-p.sx)*p.t, y=p.sy+(p.ey-p.sy)*p.t;
  ctx.save(); ctx.globalAlpha=p.alpha*0.85; setGlow(p.glow,16);
  const grad=ctx.createRadialGradient(x,y,0,x,y,p.size);
  grad.addColorStop(0,'#eef8ff'); grad.addColorStop(0.4,p.color); grad.addColorStop(1,'transparent');
  ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(x,y,p.size,0,Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

function updateHeal(p, dt) { p.y -= p.vy*dt*0.016; p.life -= 0.018*dt; p.alpha=p.life; }
function drawHeal(p) { ctx.save(); ctx.globalAlpha=p.alpha; setGlow(p.glow,12); ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.size*p.alpha,0,Math.PI*2); ctx.fill(); clearGlow(); ctx.restore(); }

function updateGlowPulse(p, dt) { p.radius += p.speed*dt*p.maxRadius; p.alpha -= 0.018*dt; if (p.alpha<=0||p.radius>=p.maxRadius) p.life=0; }
function drawGlowPulse(p) { ctx.save(); ctx.globalAlpha=p.alpha; const grad=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.radius); grad.addColorStop(0,'transparent'); grad.addColorStop(0.6,p.color+'44'); grad.addColorStop(1,p.glow+'00'); ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius,0,Math.PI*2); ctx.fill(); ctx.restore(); }

function updateRing(p, dt) { p.radius += p.speed*dt*p.maxRadius; p.alpha -= 0.025*dt; if (p.alpha<=0||p.radius>=p.maxRadius) p.life=0; }
function drawRing(p) { ctx.save(); ctx.globalAlpha=p.alpha; setGlow(p.glow,20); ctx.strokeStyle=p.color; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius,0,Math.PI*2); ctx.stroke(); clearGlow(); ctx.restore(); }

function updateSpark(p, dt) { p.x+=p.vx*dt*0.016; p.y+=p.vy*dt*0.016; p.life-=0.022*dt; p.alpha=p.life; }
function drawSpark(p) { ctx.save(); ctx.globalAlpha=p.alpha; setGlow(p.glow,10); ctx.fillStyle=p.color; ctx.beginPath(); ctx.arc(p.x,p.y,p.size*p.alpha,0,Math.PI*2); ctx.fill(); clearGlow(); ctx.restore(); }

function updateFireDrop(p, dt) { p.x+=p.vx*dt*0.016; p.y+=p.vy*dt*0.016; p.vy+=0.15*dt; p.life-=0.016*dt; p.alpha=p.life; }
function drawFireDrop(p) { ctx.save(); ctx.globalAlpha=p.alpha; setGlow(p.glow,14); const grad=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.size*p.life); grad.addColorStop(0,'#ffffff'); grad.addColorStop(0.3,p.color); grad.addColorStop(1,'transparent'); ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(p.x,p.y,p.size*p.life,0,Math.PI*2); ctx.fill(); clearGlow(); ctx.restore(); }

function updateShrapnel(p, dt) { p.x+=p.vx*dt*0.016; p.y+=p.vy*dt*0.016; p.vx*=0.97; p.vy*=0.97; p.life-=0.018*dt; p.alpha=p.life; }
function drawShrapnel(p) { ctx.save(); ctx.globalAlpha=p.alpha; setGlow(p.glow,8); ctx.fillStyle=p.color; ctx.beginPath(); ctx.rect(p.x-p.size*0.5,p.y-p.size*0.5,p.size,p.size*0.4); ctx.fill(); clearGlow(); ctx.restore(); }

function updateImplode(p, dt) { if (p.phase==='in'){p.x+=(p.tx-p.x)*0.08*dt; p.y+=(p.ty-p.y)*0.08*dt; const dx=p.tx-p.x,dy=p.ty-p.y; if(Math.sqrt(dx*dx+dy*dy)<4){p.life=0;return;}} p.life-=0.012*dt; p.alpha=p.life; }
function drawImplode(p) { ctx.save(); ctx.globalAlpha=p.alpha; setGlow(p.glow,14); const grad=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.size); grad.addColorStop(0,'#ffffff44'); grad.addColorStop(0.4,p.color); grad.addColorStop(1,'transparent'); ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill(); clearGlow(); ctx.restore(); }

function updateIceRing(p, dt) { p.radius+=p.speed*dt*p.maxRadius; p.alpha-=0.02*dt; if(p.alpha<=0||p.radius>=p.maxRadius)p.life=0; }
function drawIceRing(p) { ctx.save(); ctx.globalAlpha=p.alpha; setGlow(p.glow,24); const grad=ctx.createRadialGradient(p.x,p.y,p.radius*0.7,p.x,p.y,p.radius); grad.addColorStop(0,p.color+'aa'); grad.addColorStop(1,p.glow+'00'); ctx.fillStyle=grad; ctx.beginPath(); ctx.arc(p.x,p.y,p.radius,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#eef8ff'; ctx.lineWidth=2; ctx.stroke(); clearGlow(); ctx.restore(); }

function updateIceShard(p, dt) { p.x+=p.vx*dt*0.016; p.y+=p.vy*dt*0.016; p.angle+=0.05*dt; p.life-=0.015*dt; p.alpha=p.life; }
function drawIceShard(p) { ctx.save(); ctx.globalAlpha=p.alpha*0.9; ctx.translate(p.x,p.y); ctx.rotate(p.angle); setGlow(p.glow,12); ctx.fillStyle=p.color+'bb'; ctx.strokeStyle='#eef8ff'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,-p.size); ctx.lineTo(p.size*0.4,0); ctx.lineTo(0,p.size); ctx.lineTo(-p.size*0.4,0); ctx.closePath(); ctx.fill(); ctx.stroke(); clearGlow(); ctx.restore(); }

function updateFloatNum(p, dt) { p.y -= (dt/1000)*55*devicePixelRatio; p.life -= dt/1400; p.alpha = Math.min(1, p.life*4); }
function drawFloatNum(p) { ctx.save(); ctx.globalAlpha=Math.max(0,p.alpha); ctx.font=`bold ${p.fontSize}px system-ui`; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.strokeStyle='rgba(0,0,0,0.7)'; ctx.lineWidth=p.fontSize*0.1; ctx.lineJoin='round'; ctx.strokeText(p.text,p.x,p.y); setGlow(p.glow,14); ctx.fillStyle=p.color; ctx.fillText(p.text,p.x,p.y); clearGlow(); ctx.restore(); }

// ─── Tween updates ────────────────────────────────────────────────────────────
function updateTweens(dt) {
  if (playerFlash) { playerFlash.t += 0.025*dt; if (playerFlash.t >= 1) playerFlash = null; }
  if (enemyFlash)  { enemyFlash.t  += 0.025*dt; if (enemyFlash.t  >= 1) enemyFlash  = null; }
  if (enemyImpact) {
    enemyImpact.t += 0.022*dt;
    if (enemyImpact.t >= 1) { enemyImpact = null; }
    else if (enemyImpact.t > 0.05 && !enemyImpact.spawned) {
      enemyImpact.spawned = true;
      const r = fieldSlotRect('enemy', 2);
      _dispatchImpactAt(enemyImpact.color, r);
    }
  }
  if (playerImpact) {
    playerImpact.t += 0.022*dt;
    if (playerImpact.t >= 1) { playerImpact = null; }
    else if (playerImpact.t > 0.05 && !playerImpact.spawned) {
      playerImpact.spawned = true;
      const r = fieldSlotRect('player', 2);
      _dispatchImpactAt(playerImpact.color, r);
    }
  }
}

// ─── Drawing: card shape ──────────────────────────────────────────────────────
// Projects a card-space Y to screen space after Y-axis tilt anchored at anchorY
function tiltProjectY(rawY, anchorY, tilt) {
  return anchorY - (anchorY - rawY) * tilt;
}

// Card frame only — background, art, name, ability, border, level stars. Intended to be drawn inside a tilt transform.
function drawCardFrame(card, x, y, w, h, opts) {
  opts = opts || {};
  const r  = w * 0.1;
  const cx = x + w * 0.5;
  ctx.save();
  if (opts.dim) ctx.globalAlpha = 0.42;

  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, '#1a1a2a');
  grad.addColorStop(1, '#0a0a14');
  drawRoundRect(x, y, w, h, r);
  ctx.fillStyle = grad; ctx.fill();

  ctx.fillStyle = card.colorDef.hex + 'cc';
  ctx.fillRect(x + r, y, w - r * 2, Math.max(2, h * 0.012));

  const nameFontSz = Math.max(7, w * 0.115);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = `bold ${nameFontSz}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(card.name.toUpperCase(), cx, y + h * 0.065);

  const artPad = w * 0.05;
  const artX   = x + artPad;
  const artW   = w - artPad * 2;
  const artY   = y + h * 0.10;
  const artH   = h * 0.56;
  ctx.save();
  drawRoundRect(artX, artY, artW, artH, r * 0.55);
  ctx.clip();
  const img = CARD_IMAGES[card.id];
  if (img && img.complete && img.naturalWidth > 0) {
    const scale = Math.max(artW / img.naturalWidth, artH / img.naturalHeight);
    const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
    ctx.drawImage(img, artX + (artW - dw) * 0.5, artY + (artH - dh) * 0.5, dw, dh);
  } else {
    ctx.fillStyle = card.colorDef.hex + '44';
    ctx.fillRect(artX, artY, artW, artH);
  }
  const artGrad = ctx.createLinearGradient(artX, artY, artX, artY + artH);
  artGrad.addColorStop(0, 'rgba(0,0,0,0.25)');
  artGrad.addColorStop(0.5, 'transparent');
  artGrad.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = artGrad; ctx.fillRect(artX, artY, artW, artH);
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = Math.max(1, w * 0.02);
  drawRoundRect(artX, artY, artW, artH, r * 0.55); ctx.stroke();

  if (card.ability) {
    const abilityText = card.ability === 'charge' ? '⚡ Charge' : card.ability === 'taunt' ? '🛡 Taunt' : '💚 Heal +3';
    ctx.fillStyle = card.colorDef.glow;
    ctx.font = `bold italic ${Math.max(6, w * 0.083)}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(abilityText, cx, artY + artH + (h - (artY + artH) - h * 0.22) * 0.5);
  }

  const isSel = opts.selected || opts.isAttacker;
  if (isSel) {
    const pulse = opts.isAttacker ? 0.5 + 0.5 * Math.sin(performance.now() * 0.007) : 1;
    setGlow('#ffffff', 22 * pulse);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, w * 0.045);
  } else if (card.level >= 3) {
    const hue = (performance.now() * 0.15) % 360;
    const rc  = `hsl(${hue},100%,70%)`;
    setGlow(rc, 26); ctx.strokeStyle = rc;
    ctx.lineWidth = Math.max(2, w * 0.055);
  } else if (card.level === 2) {
    setGlow('#FFD700', 20); ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = Math.max(2, w * 0.042);
  } else if (card.ability === 'taunt') {
    setGlow('#FFD700', 12);
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = Math.max(2, w * 0.035);
  } else {
    setGlow(card.colorDef.glow, 6);
    ctx.strokeStyle = card.colorDef.hex;
    ctx.lineWidth = Math.max(1.5, w * 0.025);
  }
  drawRoundRect(x, y, w, h, r); ctx.stroke(); clearGlow();

  if (opts.isAttacker) {
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.007);
    setGlow('#ffffff', 20 * pulse);
    ctx.strokeStyle = `rgba(255,255,255,${0.4 + 0.6 * pulse})`;
    ctx.lineWidth = w * 0.05;
    drawRoundRect(x - 4, y - 4, w + 8, h + 8, r + 4); ctx.stroke(); clearGlow();
  }

  // Level stars tilt with frame
  if (card.level > 1) {
    const bR2      = Math.max(9, w * 0.155);
    const stars    = '★'.repeat(card.level - 1);
    const hue      = (performance.now() * 0.15) % 360;
    const lvlColor = card.level >= 3 ? `hsl(${hue},100%,72%)` : '#FFD700';
    setGlow(lvlColor, 16);
    ctx.fillStyle = lvlColor;
    ctx.font = `bold ${Math.max(7, bR2 * 1.05)}px system-ui`;
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(stars, x + w - bR2 * 0.55, y + bR2 * 0.25);
    clearGlow();
  }

  ctx.restore();
}

// Badge layer — mana circle, ATK badge, HP badge. Drawn flat (no tilt transform).
// When anchorY + tilt provided, badge Y positions are projected to match the tilted card surface.
function drawCardBadges(card, x, y, w, h, opts, anchorY, tilt) {
  opts = opts || {};
  const hasTilt = anchorY !== undefined && tilt !== undefined;
  const projY = hasTilt ? (rawY) => tiltProjectY(rawY, anchorY, tilt) : (rawY) => rawY;

  ctx.save();
  if (opts.dim) ctx.globalAlpha = 0.42;

  // Scale badge sizes by tilt so they fit the compressed card surface
  const tiltScale = hasTilt ? Math.max(tilt, 0.4) : 1;
  const bR  = Math.max(9, w * 0.155) * tiltScale;
  const bx0 = x + bR * 0.85;
  const by0 = projY(y + bR * 0.85);   // center Y projected
  ctx.beginPath(); ctx.arc(bx0, by0, bR, 0, Math.PI * 2);
  ctx.fillStyle = '#e87800'; ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, bR * 0.18); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${bR * 1.1}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(card.manaCost, bx0, by0);

  const statSz  = Math.max(16, w * 0.32) * tiltScale;
  const statPad = w * 0.04;
  const statRad = statSz * 0.12;
  const statLW  = Math.max(1.5, statSz * 0.09);
  // Project the CENTER of the badge, then offset up by half in screen space
  const statCenterY = projY(y + h - statSz * 0.5 - statPad);
  const statY       = statCenterY - statSz * 0.5;

  const atkBX = x + statPad;
  if (atkStatImg.complete && atkStatImg.naturalWidth) {
    ctx.drawImage(atkStatImg, atkBX, statY, statSz, statSz);
  } else {
    ctx.fillStyle = '#CC1111';
    drawRoundRect(atkBX, statY, statSz, statSz, statRad); ctx.fill();
  }
  setGlow('#ffffff', 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = statLW;
  drawRoundRect(atkBX, statY, statSz, statSz, statRad); ctx.stroke();
  clearGlow();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${statSz * 0.58}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(card.attack, atkBX + statSz * 0.5, statCenterY);

  const hpBX = x + w - statSz - statPad;
  if (hpStatImg.complete && hpStatImg.naturalWidth) {
    ctx.drawImage(hpStatImg, hpBX, statY, statSz, statSz);
  } else {
    ctx.fillStyle = '#1E90FF';
    drawRoundRect(hpBX, statY, statSz, statSz, statRad); ctx.fill();
  }
  setGlow('#ffffff', 6);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = statLW;
  drawRoundRect(hpBX, statY, statSz, statSz, statRad); ctx.stroke();
  clearGlow();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${statSz * 0.58}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(card.defense, hpBX + statSz * 0.5, statCenterY);

  ctx.restore();
}

// Full card (frame + badges, no tilt). Used by hand cards — API unchanged.
function drawCardShape(card, x, y, w, h, opts) {
  drawCardFrame(card, x, y, w, h, opts);
  drawCardBadges(card, x, y, w, h, opts);
}

function drawFaceDownCard(x, y, w, h) {
  const r = w * 0.1;
  ctx.save();
  drawRoundRect(x, y, w, h, r);
  ctx.fillStyle = '#1a1a2e'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1.5;
  drawRoundRect(x, y, w, h, r); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 2; col++) {
      ctx.fillRect(x + col*(w/2)+3, y + row*(h/3)+3, w/2-6, h/3-6);
    }
  }
  ctx.restore();
}

// ─── Drawing: battlefield ─────────────────────────────────────────────────────
function drawBattlefield() {
  ['enemy', 'player'].forEach(side => {
    for (let i = 0; i < MAX_SLOTS; i++) {
      const r    = fieldSlotRect(side, i);
      const card = side === 'player' ? playerField[i] : enemyField[i];

      // Slot outline / drag-drop indicator
      if (!card && side === 'player' && dragState && dragState.isDragging) {
        const canDrop  = dragState.card.manaCost <= playerMana;
        const isHover  = dragState.hoverSlot === i;
        const dashOff  = (performance.now() * 0.07) % 22;
        ctx.save();
        ctx.setLineDash([8 * devicePixelRatio, 5 * devicePixelRatio]);
        ctx.lineDashOffset = -dashOff;
        if (isHover && canDrop) {
          setGlow('#44ffdd', 28); ctx.strokeStyle = 'rgba(68,255,221,1)'; ctx.lineWidth = 3.5;
        } else if (canDrop) {
          setGlow('#44aaff', 12); ctx.strokeStyle = 'rgba(100,190,255,0.72)'; ctx.lineWidth = 2;
        } else {
          ctx.strokeStyle = 'rgba(255,80,80,0.42)'; ctx.lineWidth = 1.5;
        }
        drawRoundRect(r.x, r.y, r.w, r.h, r.w * 0.1); ctx.stroke();
        clearGlow(); ctx.setLineDash([]); ctx.restore();
        continue;
      }

      ctx.save();
      ctx.setLineDash([4 * devicePixelRatio, 5 * devicePixelRatio]);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1.5;
      drawRoundRect(r.x, r.y, r.w, r.h, r.w * 0.1); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      if (!card) continue;

      // Gold pulse on valid merge target
      const selCard    = selectedFieldIdx !== null ? playerField[selectedFieldIdx] : null;
      const isMergeTgt = side === 'player' && selCard && i !== selectedFieldIdx &&
        card && card.id === selCard.id && card.level < MAX_LEVEL;
      if (isMergeTgt) {
        const pulse = 0.55 + 0.45 * Math.sin(performance.now() * 0.006);
        setGlow('#FFD700', 30 * pulse);
        ctx.strokeStyle = `rgba(255,215,0,${pulse})`;
        ctx.lineWidth   = 3.5;
        drawRoundRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6, r.w * 0.12); ctx.stroke();
        clearGlow();
      }

      // Red glow on valid attack target
      const isTarget = side === 'enemy' && selectedFieldIdx !== null && card;
      if (isTarget) {
        const hasTaunt = enemyField.some(c => c && c.ability === 'taunt');
        const validTarget = !hasTaunt || card.ability === 'taunt';
        if (validTarget) {
          setGlow('#ff3333', 22);
          ctx.strokeStyle = '#ff3333';
          ctx.lineWidth = 3;
          drawRoundRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6, r.w * 0.1); ctx.stroke();
          clearGlow();
        }
      }

      const isAttacker = side === 'player' && selectedFieldIdx === i;
      const canAct     = side === 'player' && !card.hasAttacked && !card.summoningSickness && card.attack > 0;
      const shouldDim  = side === 'player' && !canAct && selectedFieldIdx === null && !animLock;

      drawCardShape(card, r.x, r.y, r.w, r.h, { selected: isAttacker, isAttacker, dim: shouldDim });

      // Summoning sickness overlay
      if (side === 'player' && card.summoningSickness) {
        ctx.save();
        drawRoundRect(r.x, r.y, r.w, r.h, r.w * 0.1);
        ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fill();
        ctx.fillStyle = 'rgba(200,200,200,0.60)';
        ctx.font = `bold ${Math.max(8, r.w * 0.12)}px system-ui`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('zZz', r.cx, r.cy);
        ctx.restore();
      }
    }
  });
}

// ─── Drawing: hand ────────────────────────────────────────────────────────────
function drawHand() {
  // ── Enemy hand — flat straight row of face-down cards ────────────────────
  const en  = enemyHand.length;
  if (en > 0) {
    const eZ   = ZONE.enemyHand();
    const maxFdH = eZ.h * 0.88;
    const fdW  = Math.min(canvas.width * 0.10, 78 * devicePixelRatio, maxFdH / 1.45);
    const fdH  = fdW * 1.45;
    const eGap = canvas.width * 0.01;
    const eTW  = en * fdW + (en - 1) * eGap;
    const eSx  = (canvas.width - eTW) * 0.5;
    const eFY  = eZ.y + (eZ.h - fdH) * 0.5;
    for (let i = 0; i < en; i++) {
      drawFaceDownCard(eSx + i * (fdW + eGap), eFY, fdW, fdH);
    }
  }

  // ── Player hand — flat straight row ──────────────────────────────────────
  const n = playerHand.length;
  if (n === 0) return;
  const p = handRowParams(n);
  for (let i = 0; i < n; i++) {
    if (dragState && dragState.isDragging && i === dragState.handIdx) continue;
    const card        = playerHand[i];
    const lifted      = i === selectedHandIdx ? p.ch * 0.08 : 0;
    const cantAfford  = card.manaCost > playerMana;
    const x           = p.startX + i * (p.cw + p.gap);
    drawCardShape(card, x, p.cardY - lifted, p.cw, p.ch, {
      selected: i === selectedHandIdx,
      dim:      cantAfford && i !== selectedHandIdx,
    });
  }
}

// ─── Drawing: HUD ─────────────────────────────────────────────────────────────
function drawHUD() {
  const fs  = Math.max(10, canvas.width * 0.018);
  const cB  = ZONE.centerBar();
  const etR = endTurnRect();

  // Top HUD bar fill
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, canvas.width, ZONE.topHud().h);

  // Bottom HUD bar fill
  const bZ = ZONE.bottomHud();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, bZ.y, canvas.width, bZ.h);

  // Turn label + thinking — right of END TURN inside center bar
  const isEnemy = currentTurn === 'enemy';
  const labelX  = etR.x + etR.w + canvas.width * 0.018;
  ctx.fillStyle = isEnemy ? '#ffaa55' : '#aaffcc';
  ctx.font      = `bold ${fs}px system-ui`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('TURN ' + turnNumber, labelX, cB.y + cB.h * 0.38);

  if (isEnemy) {
    ctx.fillStyle = 'rgba(255,140,60,0.9)';
    ctx.font      = `${Math.max(9, fs * 0.78)}px system-ui`;
    ctx.fillText('Enemy thinking…', labelX, cB.y + cB.h * 0.72);
  }

  // Merge hint — above center bar
  if (selectedFieldIdx !== null && currentTurn === 'player') {
    const selCard  = playerField[selectedFieldIdx];
    const canMerge = selCard && selCard.level < MAX_LEVEL &&
      (playerField.some((c, i) => c && i !== selectedFieldIdx && c.id === selCard.id) ||
       playerHand.some(c => c && c.id === selCard.id));
    if (canMerge) {
      ctx.fillStyle = 'rgba(255,215,0,0.9)';
      ctx.font      = `bold ${Math.max(8, fs * 0.78)}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillText('★ Drop same card to MERGE!', canvas.width * 0.5, cB.y - 4 * devicePixelRatio);
    }
  }
}

// ─── Drawing: perspective field grid ─────────────────────────────────────────
function drawFlatField() {
  const eF = ZONE.enemyField();
  const pF = ZONE.playerField();
  const cB = ZONE.centerBar();

  ctx.save();

  // Enemy field zone background
  ctx.fillStyle = 'rgba(0,10,30,0.55)';
  ctx.fillRect(0, eF.y, canvas.width, eF.h);

  // Player field zone background
  ctx.fillStyle = 'rgba(0,20,10,0.55)';
  ctx.fillRect(0, pF.y, canvas.width, pF.h);

  // Center bar background
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(0, cB.y, canvas.width, cB.h);

  // Glowing border lines on center bar
  setGlow('#88ccff', 8);
  ctx.strokeStyle = 'rgba(100,180,255,0.45)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, cB.y); ctx.lineTo(canvas.width, cB.y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, cB.y + cB.h); ctx.lineTo(canvas.width, cB.y + cB.h); ctx.stroke();
  clearGlow();

  ctx.restore();
}

function drawSideZones() {
  const cw = Math.min(canvas.width * 0.09, 72 * devicePixelRatio);
  const ch = cw * 1.45;
  ctx.save();
  ['enemy', 'player'].forEach(side => {
    const fz    = side === 'player' ? ZONE.playerField() : ZONE.enemyField();
    const cy    = fz.y + fz.h * 0.5;
    const color = side === 'enemy' ? 'rgba(180,40,40,0.5)' : 'rgba(40,100,200,0.5)';
    const dkX   = canvas.width * 0.02;
    const gyX   = canvas.width * 0.98 - cw;
    [dkX, gyX].forEach(bx => {
      ctx.fillStyle = 'rgba(5,5,20,0.75)';
      drawRoundRect(bx, cy - ch * 0.5, cw, ch, cw * 0.1); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 1.5;
      drawRoundRect(bx, cy - ch * 0.5, cw, ch, cw * 0.1); ctx.stroke();
    });
    // Labels
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = `bold ${Math.max(7, cw * 0.18)}px system-ui`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('DECK', dkX + cw * 0.5, cy - ch * 0.15);
    ctx.fillText('GY',   gyX + cw * 0.5, cy - ch * 0.15);
  });
  ctx.restore();
}

// ─── Drawing: background ─────────────────────────────────────────────────────
function drawBackground() {
  if (bgImage.complete && bgImage.naturalWidth) {
    ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#09090f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawFlatField();
  drawStars();
  drawSideZones();

  // ── Center bar: END TURN + mana ──────────────────────────────────────────
  const etR    = endTurnRect();
  const cB     = ZONE.centerBar();
  const canEnd = currentTurn === 'player' && !animLock && !gameOver;
  setGlow(canEnd ? '#3399ff' : 'transparent', canEnd ? 14 : 0);
  ctx.fillStyle = canEnd ? '#1455a0' : '#222230';
  drawRoundRect(etR.x, etR.y, etR.w, etR.h, etR.h * 0.3); ctx.fill();
  ctx.strokeStyle = canEnd ? '#55aaff' : '#333344';
  ctx.lineWidth = 2;
  drawRoundRect(etR.x, etR.y, etR.w, etR.h, etR.h * 0.3); ctx.stroke();
  clearGlow();
  ctx.fillStyle = canEnd ? '#ffffff' : 'rgba(255,255,255,0.25)';
  ctx.font = `bold ${Math.max(10, etR.h * 0.44)}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('END TURN', etR.cx, etR.cy);

  // Mana dots (left of END TURN in center bar)
  const dotR   = Math.max(5, cB.h * 0.18);
  const dotGap = dotR * 2.5;
  const manaY  = cB.y + cB.h * 0.5;
  const manaStartX = etR.x - dotGap * playerMaxMana - dotR * 1.5;
  for (let i = 0; i < playerMaxMana; i++) {
    const mx = manaStartX + dotR + i * dotGap;
    ctx.beginPath(); ctx.arc(mx, manaY, dotR, 0, Math.PI * 2);
    if (i < playerMana) {
      setGlow('#44aaff', 8); ctx.fillStyle = '#1E90FF';
    } else {
      ctx.fillStyle = 'rgba(30,144,255,0.22)';
    }
    ctx.fill(); clearGlow();
  }

  // ── Enemy avatar + HP bar (top HUD, left side) ───────────────────────────
  const tZ   = ZONE.topHud();
  const avPad = 8 * devicePixelRatio;
  const avSz  = Math.min(tZ.h * 0.82, 48 * devicePixelRatio);
  const avY   = tZ.y + (tZ.h - avSz) * 0.5;
  setGlow('#ff4444', 12);
  ctx.fillStyle = '#2a0808';
  drawRoundRect(avPad, avY, avSz, avSz, avSz * 0.2); ctx.fill();
  ctx.fillStyle = 'rgba(255,100,100,0.9)';
  ctx.font = `bold ${avSz * 0.6}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('👾', avPad + avSz * 0.5, avY + avSz * 0.5);
  clearGlow();
  const eBarX = avPad + avSz + 8 * devicePixelRatio;
  const eBarW = Math.min(canvas.width * 0.22, 140 * devicePixelRatio);
  const eBarH = Math.max(9, avSz * 0.28);
  const eBarY = avY + (avSz - eBarH) * 0.5;
  drawHealthBar(eBarX, eBarY, eBarW, eBarH, enemyHP / MAX_HP, '#ff4444', MAX_HP);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `bold ${Math.max(9, avSz * 0.32)}px system-ui`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('ENEMY  LP ' + enemyHP, eBarX, avY + avSz * 0.72);

  // ── Player avatar + HP bar (bottom HUD, left side) ───────────────────────
  const bZ   = ZONE.bottomHud();
  const pAvY = bZ.y + (bZ.h - avSz) * 0.5;
  setGlow('#22DD55', 12);
  ctx.fillStyle = '#082208';
  drawRoundRect(avPad, pAvY, avSz, avSz, avSz * 0.2); ctx.fill();
  ctx.font = `bold ${avSz * 0.6}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🧙', avPad + avSz * 0.5, pAvY + avSz * 0.5);
  clearGlow();
  const pBarX = avPad + avSz + 8 * devicePixelRatio;
  const pBarW = Math.min(canvas.width * 0.22, 140 * devicePixelRatio);
  const pBarH = Math.max(9, avSz * 0.28);
  const pBarY = pAvY + (avSz - pBarH) * 0.5;
  drawHealthBar(pBarX, pBarY, pBarW, pBarH, playerHP / MAX_HP, '#22DD55', MAX_HP);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `bold ${Math.max(9, avSz * 0.32)}px system-ui`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('YOU  LP ' + playerHP, pBarX, pAvY + avSz * 0.72);
}

// ─── Game over overlay ────────────────────────────────────────────────────────
function drawGameOver() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

  if (gameOver === 'win') {
    setGlow('#FFD700', 55);
    ctx.fillStyle = '#FFD700';
    ctx.font = `bold ${Math.max(30, canvas.width * 0.07)}px system-ui`;
    ctx.fillText('VICTORY!', canvas.width * 0.5, canvas.height * 0.38);
  } else {
    setGlow('#ff4444', 55);
    ctx.fillStyle = '#FF4444';
    ctx.font = `bold ${Math.max(30, canvas.width * 0.07)}px system-ui`;
    ctx.fillText('DEFEAT', canvas.width * 0.5, canvas.height * 0.38);
  }
  clearGlow();

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `${Math.max(13, canvas.width * 0.024)}px system-ui`;
  ctx.fillText('Tap anywhere to play again', canvas.width * 0.5, canvas.height * 0.55);
  ctx.restore();
}

// ─── Main loop ────────────────────────────────────────────────────────────────
let lastTime = 0;

function loop(ts) {
  const dt = Math.min(ts - lastTime, 50);
  lastTime = ts;

  // Shake
  if (shake.elapsed < shake.duration) shake.elapsed += dt;
  const sp = Math.max(0, 1 - shake.elapsed / shake.duration);
  const sx = sp > 0 ? (Math.random()-0.5) * shake.intensity * sp * 2 : 0;
  const sy = sp > 0 ? (Math.random()-0.5) * shake.intensity * sp * 2 : 0;

  updateStars(dt);
  drawBackground();

  ctx.save();
  ctx.translate(sx, sy);
  drawBattlefield();
  updateTweens(dt);
  updateParticles(dt);
  drawParticles();
  ctx.restore();

  drawHand();
  drawHUD();

  // Floating drag card — drawn on top of everything
  if (dragState && dragState.isDragging) {
    const cw = cardW(), ch = cardH();
    ctx.save(); ctx.globalAlpha = 0.93;
    drawCardShape(dragState.card, dragState.x - cw * 0.5, dragState.y - ch * 0.68, cw, ch, { selected: true });
    ctx.restore();
  }

  if (gameOver) drawGameOver();

  requestAnimationFrame(loop);
}

// ─── Start ────────────────────────────────────────────────────────────────────
dealOpening();
requestAnimationFrame(ts => { lastTime = ts; requestAnimationFrame(loop); });
