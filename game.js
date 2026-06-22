// ─── Color Attack Demo ───────────────────────────────────────────────────────
// Pure vanilla JS + HTML5 Canvas. No dependencies. No build step.

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ─── Layout constants ────────────────────────────────────────────────────────
const SQUARE_SIZE = () => Math.min(canvas.width, canvas.height) * 0.22;
const BUTTON_SIZE = () => Math.min(canvas.width * 0.13, canvas.height * 0.11, 90);
const HALF = () => canvas.height * 0.5;

// Color palette — damage, heal, cooldown (ms), shake intensity, card image
const COLORS = [
  { id: 'yellow', label: 'Yellow', hex: '#FFD700', dark: '#b89800', glow: '#ffe87a', damage: 10, heal: 0,  cooldown: 500,  shakeAmt: 3,  img: 'src/card-img/ai-image-generator-1780303159315.png' },
  { id: 'orange', label: 'Orange', hex: '#FF8C00', dark: '#c46000', glow: '#ffb84d', damage: 15, heal: 0,  cooldown: 1000, shakeAmt: 5,  img: 'src/card-img/ai-image-generator-1780302582434.png' },
  { id: 'red',    label: 'Red',    hex: '#FF2222', dark: '#bb0000', glow: '#ff7777', damage: 25, heal: 0,  cooldown: 1500, shakeAmt: 9,  img: 'src/card-img/ai-image-generator-1780302782081.png' },
  { id: 'purple', label: 'Purple', hex: '#9B30FF', dark: '#5a0099', glow: '#cc88ff', damage: 20, heal: 0,  cooldown: 2000, shakeAmt: 7,  img: 'src/card-img/ai-image-generator-1780302672969.png' },
  { id: 'blue',   label: 'Blue',   hex: '#1E90FF', dark: '#0050bb', glow: '#88ccff', damage: 12, heal: 0,  cooldown: 2000, shakeAmt: 4,  img: 'src/card-img/ai-image-generator-1780303293899.png' },
  { id: 'green',  label: 'Green',  hex: '#22DD55', dark: '#007722', glow: '#88ffaa', damage: 0,  heal: 20, cooldown: 1000, shakeAmt: 0,  img: 'src/card-img/ai-image-generator-1780303021745.png' },
];

const MAX_HP        = 100;
const COMBO_WINDOW  = 3000; // ms before hit-combo resets
const COMBO_SEQ_WINDOW = 2500; // ms window to press 2nd button for a sequence combo
const ATTACK_COLORS = COLORS.filter(c => c.id !== 'green');

// Two-color sequence combos
const COMBO_PAIRS = [
  { ids: ['yellow', 'blue'],   name: 'STATIC ICE STORM',
    beamColor: COLORS.find(c => c.id === 'yellow'), impactColor: COLORS.find(c => c.id === 'blue'),
    damage: 30, healAmount: 0,  shakeAmt: 8  },
  { ids: ['orange', 'red'],    name: 'MAGMA SURGE',
    beamColor: COLORS.find(c => c.id === 'orange'), impactColor: COLORS.find(c => c.id === 'red'),
    damage: 45, healAmount: 0,  shakeAmt: 12 },
  { ids: ['red', 'purple'],    name: 'VOID BLAST',
    beamColor: COLORS.find(c => c.id === 'red'),    impactColor: COLORS.find(c => c.id === 'purple'),
    damage: 38, healAmount: 0,  shakeAmt: 10 },
  { ids: ['purple', 'blue'],   name: 'CRYO PULSE',
    beamColor: COLORS.find(c => c.id === 'purple'), impactColor: COLORS.find(c => c.id === 'blue'),
    damage: 28, healAmount: 0,  shakeAmt: 7  },
  { ids: ['blue', 'green'],    name: 'GLACIAL HEAL',
    beamColor: COLORS.find(c => c.id === 'blue'),   impactColor: COLORS.find(c => c.id === 'blue'),
    damage: 18, healAmount: 30, shakeAmt: 5  },
];

// Preload card images
const cardImages = {};
COLORS.forEach(c => {
  const img = new Image();
  img.src = c.img;
  cardImages[c.id] = img;
});

// ─── State ───────────────────────────────────────────────────────────────────
let particles    = [];
let playerFlash  = null;   // { color, t } — player charges
let enemyFlash   = null;   // { color, t } — enemy charges before counter
let enemyImpact  = null;   // { color, t, spawned? } — enemy gets hit
let playerImpact = null;   // { color, t, spawned? } — player gets hit
let buttons      = [];
let busy         = false;

let playerHP  = MAX_HP;
let enemyHP   = MAX_HP;
let gameOver  = false;     // false | 'enemy'

// Wave progression
let wave             = 1;
let waveTransitioning = false;

const cooldowns = {};
let shake = { intensity: 0, duration: 0, elapsed: 0 };

// Score / hit-combo
let score      = 0;
let combo      = 0;
let comboTimer = 0;
let highScore  = parseInt(localStorage.getItem('colorAttackHigh') || '0');

// Sequence combo tracking
let lastAttack = null;  // { colorDef, time }

// Swipe gesture tracking
let swipeStart = null;  // { x, y, time }

// Starfield
const STAR_COUNT = 90;
const stars = [];
let bgPulse = 0;

// Web Audio
let audioCtx = null;

// ─── Audio ────────────────────────────────────────────────────────────────────
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
        const src = ac.createBufferSource();
        src.buffer = buf;
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
        o.type = 'sine';
        o.frequency.setValueAtTime(1047, now);
        o.connect(g); o.start(now); o.stop(now + 0.5);
        const g2 = ac.createGain();
        g2.gain.setValueAtTime(0.001, now);
        g2.gain.linearRampToValueAtTime(0.08, now + 0.02);
        g2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        g2.connect(ac.destination);
        const o2 = ac.createOscillator();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(2093, now);
        o2.connect(g2); o2.start(now); o2.stop(now + 0.3);
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
          o.type = 'sine';
          o.frequency.setValueAtTime(freq, now);
          o.connect(g); o.start(now); o.stop(now + 0.85);
        });
        break;
      }
    }
  } catch (_) { /* audio blocked — ignore */ }
}

// ─── Starfield ────────────────────────────────────────────────────────────────
function initStars() {
  stars.length = 0;
  const layerSpeeds = [0.3, 0.6, 1.0];
  for (let i = 0; i < STAR_COUNT; i++) {
    const layer = i % 3;
    stars.push({
      nx:      Math.random(),
      ny:      Math.random(),
      size:    Math.random() * 1.2 + 0.4,
      speed:   (Math.random() * 0.04 + 0.01) * layerSpeeds[layer],
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
    ctx.arc(s.nx * canvas.width, s.ny * canvas.height,
            s.size * devicePixelRatio, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ─── Canvas resize ───────────────────────────────────────────────────────────
function resize() {
  canvas.width  = canvas.clientWidth  * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  buildButtons();
  initStars();
}

window.addEventListener('resize', resize);
resize();

// ─── Button layout ───────────────────────────────────────────────────────────
function buildButtons() {
  const bSize   = BUTTON_SIZE();
  const bottomY = HALF() + (HALF() - bSize) * 0.5;
  const totalW  = COLORS.length * bSize + (COLORS.length - 1) * bSize * 0.35;
  const startX  = (canvas.width - totalW) * 0.5;
  const step    = bSize + bSize * 0.35;

  buttons = COLORS.map((c, i) => ({
    ...c,
    x: startX + i * step,
    y: bottomY,
    w: bSize,
    h: bSize,
  }));
}

// ─── Input handling (mouse + touch) ──────────────────────────────────────────
function getEventPos(e) {
  const r = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / r.width;
  const scaleY = canvas.height / r.height;
  const src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - r.left) * scaleX,
    y: (src.clientY - r.top)  * scaleY,
  };
}

function handleInput(e) {
  e.preventDefault();
  if (gameOver) { resetGame(); return; }
  if (busy || waveTransitioning) return;
  const pos = getEventPos(e);
  for (const btn of buttons) {
    if (pos.x >= btn.x && pos.x <= btn.x + btn.w &&
        pos.y >= btn.y && pos.y <= btn.y + btn.h) {
      const cd = cooldowns[btn.id];
      if (cd && cd.remaining > 0) return;
      triggerColor(btn);
      return;
    }
  }
}

canvas.addEventListener('click',      handleInput);
canvas.addEventListener('touchstart', handleInput, { passive: false });

// Swipe gesture — touchstart records position, touchend evaluates direction
canvas.addEventListener('touchstart', e => {
  const pos = getEventPos(e);
  swipeStart = { x: pos.x, y: pos.y, time: performance.now() };
}, { passive: true });

canvas.addEventListener('touchend', e => {
  if (!swipeStart) return;
  const r      = canvas.getBoundingClientRect();
  const scaleX = canvas.width / r.width;
  const scaleY = canvas.height / r.height;
  const touch  = e.changedTouches[0];
  if (!touch) { swipeStart = null; return; }
  const endX    = (touch.clientX - r.left) * scaleX;
  const endY    = (touch.clientY - r.top)  * scaleY;
  const dx      = endX - swipeStart.x;
  const dy      = endY - swipeStart.y;
  const dist    = Math.hypot(dx, dy);
  const elapsed = performance.now() - swipeStart.time;
  swipeStart = null;
  if (dist < 45 || elapsed > 600) return; // too short/slow = tap, not swipe
  if (gameOver) { resetGame(); return; }
  if (busy || waveTransitioning) return;
  const color = resolveSwipeColor(dx, dy);
  if (color) {
    const cd = cooldowns[color.id];
    if (cd && cd.remaining > 0) return;
    triggerColor(color);
  }
}, { passive: true });

function resolveSwipeColor(dx, dy) {
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  // right=0°, down=90°, left=±180°, up=-90°
  if (angle > -135 && angle <= -45)  return COLORS.find(c => c.id === 'red');    // swipe up
  if (angle > -45  && angle <= 45)   return COLORS.find(c => c.id === 'blue');   // swipe right
  if (angle > 45   && angle <= 135)  return COLORS.find(c => c.id === 'green');  // swipe down
  return COLORS.find(c => c.id === 'yellow');                                      // swipe left
}

// ─── Game state helpers ───────────────────────────────────────────────────────
function waveMaxHP() { return MAX_HP + (wave - 1) * 25; }

function resetGame() {
  playerHP         = MAX_HP;
  enemyHP          = MAX_HP;
  gameOver         = false;
  busy             = false;
  wave             = 1;
  waveTransitioning = false;
  lastAttack       = null;
  swipeStart       = null;
  score            = 0;
  combo            = 0;
  comboTimer       = 0;
  particles        = [];
  playerFlash      = null;
  enemyFlash       = null;
  enemyImpact      = null;
  playerImpact     = null;
  shake            = { intensity: 0, duration: 0, elapsed: 0 };
  bgPulse          = 0;
  for (const id in cooldowns) cooldowns[id].remaining = 0;
}

function applyDamage(amount, colorDef) {
  if (gameOver) return;

  // Hit-combo multiplier
  combo = comboTimer > 0 ? combo + 1 : 1;
  comboTimer = COMBO_WINDOW;
  const multiplier = 1 + (combo - 1) * 0.15;
  const actual = Math.round(amount * multiplier);

  enemyHP = Math.max(0, enemyHP - actual);
  score  += actual;
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('colorAttackHigh', highScore);
  }

  spawnFloatingNumber('-' + actual, enemyRect(), colorDef.hex, colorDef.glow);
  if (combo >= 2) spawnComboIndicator(combo, colorDef);
  triggerShake(colorDef.shakeAmt);

  if (enemyHP <= 0) {
    // Wave cleared — transition to next wave
    wave++;
    waveTransitioning = true;
    spawnWaveTransition();
    setTimeout(startNextWave, 1800);
    return;
  }

  // Schedule enemy counter-attack — delay shortens with each wave
  const baseDelay = Math.max(600, 1000 - wave * 50);
  const delay = baseDelay + Math.random() * 600;
  setTimeout(enemyCounterAttack, delay);
}

function applyPlayerDamage(amount, colorDef) {
  if (gameOver) return;
  playerHP = Math.max(0, playerHP - amount);
  spawnFloatingNumber('-' + amount, playerRect(), colorDef.hex, colorDef.glow);
  triggerShake(colorDef.shakeAmt * 0.7);
  if (playerHP <= 0) { gameOver = 'enemy'; }
}

function applyHeal(amount) {
  if (gameOver) return;
  playerHP = Math.min(MAX_HP, playerHP + amount);
  spawnFloatingNumber('+' + amount, playerRect(), '#22DD55', '#88ffaa');
}

// ─── Screen shake ─────────────────────────────────────────────────────────────
function triggerShake(intensity) {
  shake.intensity = intensity * devicePixelRatio;
  shake.duration  = 320;
  shake.elapsed   = 0;
}

// ─── Wave transition ──────────────────────────────────────────────────────────
function spawnWaveTransition() {
  const e = enemyRect();
  triggerShake(12);
  // Big "WAVE N" label centered in arena
  particles.push({
    type: 'floatNum',
    text: 'WAVE ' + wave,
    color: '#FFD700',
    glow: '#fffacc',
    x: canvas.width * 0.5,
    y: HALF() * 0.44,
    life: 1, alpha: 1,
    fontSize: Math.max(36 * devicePixelRatio, e.w * 0.52),
  });
  // Burst of gold sparks at enemy position
  for (let i = 0; i < 30; i++) {
    const angle = (i / 30) * Math.PI * 2;
    const speed = rand(3, 8) * devicePixelRatio;
    particles.push({ type: 'spark', color: '#FFD700', glow: '#fffacc',
      x: e.cx, y: e.cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: rand(3, 8), life: 1, alpha: 1 });
  }
  particles.push({ type: 'ring', color: '#FFD700', glow: '#fffacc',
    x: e.cx, y: e.cy, radius: 0, maxRadius: e.w * 1.5,
    life: 1, alpha: 1, speed: 0.025 });
}

function startNextWave() {
  enemyHP          = waveMaxHP();
  enemyFlash       = null;
  playerImpact     = null;
  waveTransitioning = false;
  busy             = false;
}

// ─── Main sequence dispatcher ─────────────────────────────────────────────────
function triggerColor(colorDef) {
  // Check for two-color sequence combo BEFORE committing to normal attack
  const now = performance.now();
  if (lastAttack && (now - lastAttack.time) < COMBO_SEQ_WINDOW
      && lastAttack.colorDef.id !== colorDef.id) {
    const pair = findComboPair(lastAttack.colorDef, colorDef);
    if (pair) {
      lastAttack = null;
      triggerComboAttack(pair);
      return;
    }
  }
  lastAttack = { colorDef, time: now };

  busy    = true;
  bgPulse = 1;
  cooldowns[colorDef.id] = { remaining: colorDef.cooldown, total: colorDef.cooldown };
  playSound(colorDef.id);

  if (colorDef.id === 'green') {
    spawnHeal();
    applyHeal(colorDef.heal);
    setTimeout(() => { busy = false; }, 1200);
    return;
  }

  playerFlash = { color: colorDef, t: 0 };
  setTimeout(() => spawnBeam(colorDef), 200);
  setTimeout(() => {
    enemyImpact = { color: colorDef, t: 0 };
    applyDamage(colorDef.damage, colorDef);
    setTimeout(() => { if (!gameOver && !waveTransitioning) busy = false; }, 900);
  }, 700);
}

// ─── Two-color sequence combos ────────────────────────────────────────────────
function findComboPair(a, b) {
  return COMBO_PAIRS.find(p =>
    (p.ids[0] === a.id && p.ids[1] === b.id) ||
    (p.ids[0] === b.id && p.ids[1] === a.id)
  ) || null;
}

function triggerComboAttack(pair) {
  busy    = true;
  bgPulse = 1;
  // Both involved colors go on a 1.5× cooldown
  [pair.beamColor, pair.impactColor].forEach(c => {
    cooldowns[c.id] = { remaining: c.cooldown * 1.5, total: c.cooldown * 1.5 };
  });
  playSound(pair.beamColor.id);
  setTimeout(() => playSound(pair.impactColor.id), 180);
  spawnComboLabel(pair.name);
  playerFlash = { color: pair.beamColor, t: 0 };
  setTimeout(() => {
    _dispatchBeam(pair.beamColor, playerRect(), enemyRect());
    setTimeout(() => _dispatchBeam(pair.impactColor, playerRect(), enemyRect()), 160);
  }, 200);
  setTimeout(() => {
    enemyImpact = { color: pair.impactColor, t: 0 };
    applyDamage(pair.damage, { ...pair.beamColor, shakeAmt: pair.shakeAmt });
    if (pair.healAmount) applyHeal(pair.healAmount);
    setTimeout(() => { if (!gameOver && !waveTransitioning) busy = false; }, 900);
  }, 700);
}

function spawnComboLabel(name) {
  const e = enemyRect();
  particles.push({
    type: 'floatNum',
    text: name + '!',
    color: '#FFD700',
    glow: '#fffaaa',
    x: canvas.width * 0.5,
    y: HALF() * 0.38,
    life: 1, alpha: 1,
    fontSize: Math.max(20 * devicePixelRatio, e.w * 0.3),
  });
}

// ─── Enemy counter-attack ─────────────────────────────────────────────────────
function enemyCounterAttack() {
  if (gameOver || waveTransitioning) return;
  const colorDef = ATTACK_COLORS[Math.floor(Math.random() * ATTACK_COLORS.length)];
  bgPulse = 0.6;
  playSound(colorDef.id);
  enemyFlash = { color: colorDef, t: 0 };
  setTimeout(() => spawnBeamReversed(colorDef), 200);
  setTimeout(() => {
    playerImpact = { color: colorDef, t: 0 };
    applyPlayerDamage(colorDef.damage, colorDef);
  }, 700);
}

// ─── Player / Enemy square geometry helpers ───────────────────────────────────
function playerRect() {
  const s   = SQUARE_SIZE();
  const cx  = canvas.width * 0.5;
  const cy  = HALF() * 0.5;
  const gap = s * 0.25;
  return { x: cx - gap - s, y: cy - s * 0.5, w: s, h: s, cx: cx - gap - s * 0.5, cy };
}

function enemyRect() {
  const s   = SQUARE_SIZE();
  const cx  = canvas.width * 0.5;
  const cy  = HALF() * 0.5;
  const gap = s * 0.25;
  return { x: cx + gap, y: cy - s * 0.5, w: s, h: s, cx: cx + gap + s * 0.5, cy };
}

// ─── Beam spawners ────────────────────────────────────────────────────────────
function rand(min, max)    { return min + Math.random() * (max - min); }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

function spawnBeam(colorDef) {
  const p = playerRect(), e = enemyRect();
  _dispatchBeam(colorDef, p, e);
}

function spawnBeamReversed(colorDef) {
  const p = playerRect(), e = enemyRect();
  _dispatchBeam(colorDef, e, p); // swap src/dst
}

function _dispatchBeam(colorDef, src, dst) {
  switch (colorDef.id) {
    case 'yellow': spawnLightning(src, dst, colorDef); break;
    case 'orange': spawnFlame(src, dst, colorDef);     break;
    case 'red':    spawnBurst(src, dst, colorDef);     break;
    case 'purple': spawnSpiral(src, dst, colorDef);    break;
    case 'blue':   spawnWave(src, dst, colorDef);      break;
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
  const count = 28;
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
          sx: src.cx, sy: src.cy + row * 18 * devicePixelRatio,
          ex: dst.cx, ey: dst.cy + row * 18 * devicePixelRatio,
          t: 0, life: 1, speed: 0.025,
          size: rand(10, 18), alpha: 1, frozen: false,
        });
      }, col * 55);
    }
  }
}

// ─── Heal effect ──────────────────────────────────────────────────────────────
function spawnHeal() {
  const p = playerRect();
  playerFlash = { color: COLORS[5], t: 0 };
  for (let i = 0; i < 22; i++) {
    particles.push({
      type: 'heal', color: COLORS[5].hex, glow: COLORS[5].glow,
      x: p.cx + rand(-p.w * 0.4, p.w * 0.4),
      y: p.cy + rand(-p.h * 0.4, p.h * 0.4),
      vy: rand(1.5, 3.5) * devicePixelRatio,
      size: rand(4, 9), life: 1, alpha: 1,
    });
  }
  particles.push({
    type: 'glowPulse', color: COLORS[5].hex, glow: COLORS[5].glow,
    x: p.cx, y: p.cy, radius: 0, maxRadius: p.w * 1.1,
    life: 1, alpha: 0.7, speed: 0.022,
  });
}

// ─── Floating numbers ─────────────────────────────────────────────────────────
function spawnFloatingNumber(text, rect, color, glow) {
  particles.push({
    type: 'floatNum', text, color, glow,
    x: rect.cx + rand(-rect.w * 0.15, rect.w * 0.15),
    y: rect.y + rect.h * 0.2,
    life: 1, alpha: 1,
    fontSize: Math.max(18 * devicePixelRatio, rect.w * 0.28),
  });
}

function spawnComboIndicator(comboCount, colorDef) {
  const e = enemyRect();
  particles.push({
    type: 'floatNum',
    text: 'x' + comboCount + ' COMBO!',
    color: colorDef.glow,
    glow: colorDef.hex,
    x: e.cx,
    y: e.y - e.h * 0.18,
    life: 1, alpha: 1,
    fontSize: Math.max(14 * devicePixelRatio, e.w * 0.2),
  });
}

// ─── Impact spawners ──────────────────────────────────────────────────────────
function spawnImpact(colorDef) {
  const e = enemyRect();
  _dispatchImpact(colorDef, e);
}

function spawnPlayerImpact(colorDef) {
  const p = playerRect();
  _dispatchImpact(colorDef, p);
}

function _dispatchImpact(colorDef, rect) {
  switch (colorDef.id) {
    case 'yellow': spawnElectricBurst(rect, colorDef); break;
    case 'orange': spawnFireSplash(rect, colorDef);    break;
    case 'red':    spawnShrapnel(rect, colorDef);      break;
    case 'purple': spawnImplosion(rect, colorDef);     break;
    case 'blue':   spawnIceShatter(rect, colorDef);    break;
  }
}

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
  for (let i = 0; i < 30; i++) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(2, 8) * devicePixelRatio;
    particles.push({ type: 'fireDrop', color: c.hex, glow: c.glow,
      x: e.cx, y: e.cy,
      vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - rand(1,3)*devicePixelRatio,
      size: rand(8, 20), life: 1, alpha: 1 });
  }
}

function spawnShrapnel(e, c) {
  for (let i = 0; i < 36; i++) {
    const angle = (i / 36) * Math.PI * 2 + rand(-0.1, 0.1);
    const speed = rand(5, 14) * devicePixelRatio;
    particles.push({ type: 'shrapnel', color: c.hex, glow: c.glow,
      x: e.cx, y: e.cy,
      vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      size: rand(2, 6), life: 1, alpha: 1 });
  }
}

function spawnImplosion(e, c) {
  for (let i = 0; i < 20; i++) {
    const angle = rand(0, Math.PI * 2);
    const dist  = rand(e.w * 0.6, e.w * 1.4);
    particles.push({ type: 'implode', color: c.hex, glow: c.glow,
      x: e.cx + Math.cos(angle)*dist, y: e.cy + Math.sin(angle)*dist,
      tx: e.cx, ty: e.cy, size: rand(6, 14), life: 1, alpha: 1, phase: 'in' });
  }
  setTimeout(() => {
    for (let i = 0; i < 22; i++) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(3, 9) * devicePixelRatio;
      particles.push({ type: 'spark', color: c.glow, glow: c.glow,
        x: e.cx, y: e.cy, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
        size: rand(4, 10), life: 1, alpha: 1 });
    }
  }, 400);
}

function spawnIceShatter(e, c) {
  particles.push({ type: 'iceRing', color: c.hex, glow: c.glow,
    x: e.cx, y: e.cy, radius: 0, maxRadius: e.w * 1.3,
    life: 1, alpha: 0.85, speed: 0.02 });
  for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2;
    const speed = rand(1, 4) * devicePixelRatio;
    particles.push({ type: 'iceShard', color: c.hex, glow: c.glow,
      x: e.cx + Math.cos(angle)*e.w*0.09, y: e.cy + Math.sin(angle)*e.w*0.09,
      vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      size: rand(6, 18), angle: rand(0, Math.PI*2), life: 1, alpha: 0.9 });
  }
}

// ─── Draw helpers ─────────────────────────────────────────────────────────────
function setGlow(color, blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
function clearGlow()           { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; }

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

// ─── Health bars ──────────────────────────────────────────────────────────────
function drawHealthBar(x, y, w, h, pct, glowColor, maxHp) {
  const hp = maxHp || MAX_HP;
  const r = h * 0.4;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  drawRoundRect(x, y, w, h, r); ctx.fill();

  if (pct > 0) {
    const fillW  = Math.max(r * 2, (w - 2) * pct);
    const barCol = pct > 0.5
      ? lerpColor('#22DD55', '#FFD700', (1 - pct) * 2)
      : lerpColor('#FFD700', '#FF2222', (0.5 - pct) * 2);
    if (pct < 0.3) setGlow(glowColor, 14);
    const grad = ctx.createLinearGradient(x + 1, y, x + 1 + fillW, y);
    grad.addColorStop(0, barCol);
    grad.addColorStop(1, barCol + '99');
    ctx.fillStyle = grad;
    drawRoundRect(x + 1, y + 1, fillW, h - 2, r); ctx.fill();
    clearGlow();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
  drawRoundRect(x, y, w, h, r); ctx.stroke();

  ctx.fillStyle    = 'rgba(255,255,255,0.85)';
  ctx.font         = `bold ${Math.max(9, h * 0.72)}px system-ui`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(Math.ceil(pct * hp) + ' HP', x + w * 0.5, y + h * 0.5);
}

function drawHUD() {
  const p    = playerRect();
  const e    = enemyRect();
  const barH = Math.max(10, p.w * 0.07);
  const barY = p.y - barH - 10;
  const eMax = waveMaxHP();
  drawHealthBar(p.x, barY, p.w, barH, playerHP / MAX_HP, COLORS[5].glow);
  drawHealthBar(e.x, barY, e.w, barH, enemyHP / eMax,    COLORS[2].glow, eMax);

  // Score (centered)
  const scoreSize = Math.max(11, canvas.width * 0.022);
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle    = 'rgba(255,255,255,0.82)';
  ctx.font         = `bold ${scoreSize}px system-ui`;
  ctx.fillText('SCORE  ' + score, canvas.width * 0.5, 12);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font      = `${scoreSize * 0.78}px system-ui`;
  ctx.fillText('BEST  ' + highScore, canvas.width * 0.5, 14 + scoreSize);

  // Wave (right-aligned)
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,215,0,0.88)';
  ctx.font      = `bold ${scoreSize}px system-ui`;
  ctx.fillText('WAVE ' + wave, canvas.width - 14, 12);

  // Combo decay bar
  if (combo >= 2 && comboTimer > 0) {
    const pct    = comboTimer / COMBO_WINDOW;
    const barW   = canvas.width * 0.18;
    const barX   = canvas.width * 0.5 - barW * 0.5;
    const barYy  = 16 + scoreSize * 2;
    const barHH  = Math.max(6, scoreSize * 0.55);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    drawRoundRect(barX, barYy, barW, barHH, barHH * 0.4); ctx.fill();
    setGlow('#ff88ff', 8);
    ctx.fillStyle = lerpColor('#FFD700', '#cc88ff', 1 - pct);
    drawRoundRect(barX, barYy, barW * pct, barHH, barHH * 0.4); ctx.fill();
    clearGlow();
  }
}

// ─── Game-over overlay ────────────────────────────────────────────────────────
function drawGameOver() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  setGlow('#ff8888', 50);
  ctx.fillStyle = '#FF4444';
  ctx.font = `bold ${Math.max(32, canvas.width * 0.075)}px system-ui`;
  ctx.fillText('YOU LOSE!', canvas.width * 0.5, canvas.height * 0.35);
  clearGlow();

  ctx.fillStyle = 'rgba(255,215,0,0.7)';
  ctx.font = `bold ${Math.max(14, canvas.width * 0.025)}px system-ui`;
  ctx.fillText('Reached Wave ' + wave, canvas.width * 0.5, canvas.height * 0.44);

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `bold ${Math.max(16, canvas.width * 0.032)}px system-ui`;
  ctx.fillText('SCORE  ' + score, canvas.width * 0.5, canvas.height * 0.52);

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = `${Math.max(13, canvas.width * 0.024)}px system-ui`;
  ctx.fillText('BEST  ' + highScore, canvas.width * 0.5, canvas.height * 0.59);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `${Math.max(12, canvas.width * 0.022)}px system-ui`;
  ctx.fillText('Tap anywhere to play again', canvas.width * 0.5, canvas.height * 0.68);
  ctx.restore();
}

// ─── Draw squares ─────────────────────────────────────────────────────────────
function drawSquares() {
  const p = playerRect();
  const e = enemyRect();
  const r = p.w * 0.1;

  // ── Player square ──────────────────────────────────────────────────────────
  let pColor = '#4a4a5a';
  if (playerFlash) {
    const ease = Math.sin(playerFlash.t * Math.PI);
    pColor = lerpColor('#4a4a5a', playerFlash.color.hex, ease);
    setGlow(playerFlash.color.glow, ease * 30);
  }
  if (playerImpact) {
    const ease = Math.sin(playerImpact.t * Math.PI);
    pColor = lerpColor(pColor, playerImpact.color.hex, ease * 0.6);
    setGlow(playerImpact.color.glow, ease * 30);
  }
  drawRoundRect(p.x, p.y, p.w, p.h, r);
  ctx.fillStyle = pColor; ctx.fill();
  clearGlow();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `bold ${p.w * 0.14}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('PLAYER', p.cx, p.cy);

  // ── Enemy square ───────────────────────────────────────────────────────────
  let eColor = '#4a4a5a';
  if (enemyFlash) {
    const ease = Math.sin(enemyFlash.t * Math.PI);
    eColor = lerpColor('#4a4a5a', enemyFlash.color.hex, ease);
    setGlow(enemyFlash.color.glow, ease * 30);
  }
  if (enemyImpact) {
    const ease = Math.sin(enemyImpact.t * Math.PI);
    eColor = lerpColor(eColor, enemyImpact.color.hex, ease * 0.6);
    setGlow(enemyImpact.color.glow, ease * 30);
  }
  drawRoundRect(e.x, e.y, e.w, e.h, r);
  ctx.fillStyle = eColor; ctx.fill();
  clearGlow();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `bold ${e.w * 0.14}px system-ui`;
  ctx.fillText('ENEMY', e.cx, e.cy);

  // Wave transitioning — draw enemy HP bar on top of the dead enemy square
  if (waveTransitioning) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    drawRoundRect(e.x, e.y, e.w, e.h, r); ctx.fill();
  }
}

// ─── Draw buttons ─────────────────────────────────────────────────────────────
function drawButtons() {
  const fontSize = Math.max(10, BUTTON_SIZE() * 0.15);
  const now = performance.now();

  for (const btn of buttons) {
    const r  = btn.w * 0.14;
    const cx = btn.x + btn.w * 0.5;
    const cy = btn.y + btn.h * 0.5;

    // ── Card image (clipped to rounded rect) ──────────────────────────────
    ctx.save();
    drawRoundRect(btn.x, btn.y, btn.w, btn.h, r);
    ctx.clip();
    const img = cardImages[btn.id];
    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, btn.x, btn.y, btn.w, btn.h);
    } else {
      // Gradient fallback while image loads
      const grad = ctx.createLinearGradient(btn.x, btn.y, btn.x, btn.y + btn.h);
      grad.addColorStop(0, btn.hex); grad.addColorStop(1, btn.dark);
      ctx.fillStyle = grad;
      drawRoundRect(btn.x, btn.y, btn.w, btn.h, r); ctx.fill();
    }
    // Subtle vignette so the border stays readable
    const vignette = ctx.createRadialGradient(cx, cy, btn.w * 0.12, cx, cy, btn.w * 0.72);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vignette;
    drawRoundRect(btn.x, btn.y, btn.w, btn.h, r); ctx.fill();
    ctx.restore();

    // ── Glow border ───────────────────────────────────────────────────────
    setGlow(btn.glow, 14);
    ctx.strokeStyle = btn.hex;
    ctx.lineWidth   = Math.max(1.5, btn.w * 0.025);
    drawRoundRect(btn.x, btn.y, btn.w, btn.h, r); ctx.stroke();
    clearGlow();

    // ── Combo-pending highlight: pulse white ring around first button pressed ──
    if (lastAttack && (now - lastAttack.time) < COMBO_SEQ_WINDOW
        && btn.id === lastAttack.colorDef.id) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
      setGlow('#ffffff', 22 * pulse);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = Math.max(2, btn.w * 0.04) * pulse;
      drawRoundRect(btn.x - 3, btn.y - 3, btn.w + 6, btn.h + 6, r + 3);
      ctx.stroke();
      clearGlow();
    }

    // ── Label below button ────────────────────────────────────────────────
    ctx.fillStyle    = 'rgba(255,255,255,0.75)';
    ctx.font         = `bold ${fontSize}px system-ui`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(btn.label, cx, btn.y + btn.h + 6);

    // ── Cooldown overlay ──────────────────────────────────────────────────
    const cd = cooldowns[btn.id];
    if (cd && cd.remaining > 0) {
      const pct = cd.remaining / cd.total;
      drawRoundRect(btn.x, btn.y, btn.w, btn.h, r);
      ctx.fillStyle = 'rgba(0,0,0,0.58)'; ctx.fill();
      const arcR = btn.w * 0.32;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = Math.max(2, btn.w * 0.05);
      ctx.lineCap = 'round';
      setGlow('white', 8);
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, -Math.PI * 0.5, -Math.PI * 0.5 + pct * Math.PI * 2);
      ctx.stroke();
      clearGlow();
      ctx.fillStyle = 'white';
      ctx.font = `bold ${Math.max(10, btn.w * 0.26)}px system-ui`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText((cd.remaining / 1000).toFixed(1), cx, cy);
    }
  }
}

// ─── Particle system — update ─────────────────────────────────────────────────
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

// ─── Particle system — draw ───────────────────────────────────────────────────
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

// ── Lightning ─────────────────────────────────────────────────────────────────
function updateLightning(p, dt) {
  p.t += p.speed * dt;
  if (p.t >= 1) { p.life = 0; return; }
  p.alpha = p.t < 0.5 ? 1 : 1 - (p.t - 0.5) * 2;
}
function drawLightning(p) {
  const pts = [];
  for (let i = 0; i <= p.segments; i++) {
    const tt  = i / p.segments;
    const bx  = p.sx + (p.ex - p.sx) * tt;
    const by  = p.sy + (p.ey - p.sy) * tt;
    const perp = { x: -(p.ey - p.sy), y: p.ex - p.sx };
    const len  = Math.sqrt(perp.x*perp.x + perp.y*perp.y);
    const jit  = (i > 0 && i < p.segments) ? (Math.random()-0.5)*p.amp : 0;
    pts.push({ x: bx + (perp.x/len)*jit, y: by + (perp.y/len)*jit });
  }
  ctx.save();
  ctx.globalAlpha = p.alpha * p.alpha;
  setGlow(p.glow, 18);
  ctx.strokeStyle = p.color; ctx.lineWidth = p.width; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke(); clearGlow(); ctx.restore();
}

// ── Flame ─────────────────────────────────────────────────────────────────────
function updateFlame(p, dt) {
  p.t += p.speed * dt;
  if (p.t >= 1) { p.life = 0; return; }
  p.alpha   = p.t < 0.7 ? 1 : 1 - (p.t - 0.7) / 0.3;
  p.wobble += p.wobbleSpeed * dt * 0.016;
}
function drawFlame(p) {
  const x    = p.x + (p.tx - p.x)*p.t + Math.sin(p.wobble)*12;
  const y    = p.y + (p.ty - p.y)*p.t + Math.cos(p.wobble*0.7)*8;
  const size = p.size * (1 - p.t*0.5);
  ctx.save(); ctx.globalAlpha = p.alpha;
  const grad = ctx.createRadialGradient(x, y, 0, x, y, size);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.3, p.color); grad.addColorStop(1, 'transparent');
  setGlow(p.glow, 14); ctx.fillStyle = grad;
  ctx.beginPath(); ctx.ellipse(x, y, size*0.6, size, 0, 0, Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

// ── Projectile ────────────────────────────────────────────────────────────────
function updateProjectile(p, dt) {
  p.x += p.vx * dt * 0.016; p.y += p.vy * dt * 0.016;
  const dx = p.tx - p.x, dy = p.ty - p.y;
  const dist = Math.sqrt(dx*dx + dy*dy);
  p.life = dist > 5 ? 1 : 0;
  p.alpha = Math.min(1, dist / 60);
}
function drawProjectile(p) {
  ctx.save(); ctx.globalAlpha = p.alpha;
  setGlow(p.glow, 10); ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

// ── Spiral ────────────────────────────────────────────────────────────────────
function updateSpiral(p, dt) {
  p.t += p.speed * dt;
  if (p.t >= 1) { p.life = 0; return; }
  p.orbitAngle += p.orbitSpeed * dt * 0.016;
  p.alpha = p.t < 0.8 ? 1 : 1 - (p.t - 0.8) / 0.2;
}
function drawSpiral(p) {
  const bx    = p.sx + (p.ex - p.sx)*p.t;
  const by    = p.sy + (p.ey - p.sy)*p.t;
  const decay = 1 - p.t;
  const x     = bx + Math.cos(p.orbitAngle)*p.orbitRadius*decay;
  const y     = by + Math.sin(p.orbitAngle)*p.orbitRadius*decay;
  ctx.save(); ctx.globalAlpha = p.alpha;
  setGlow(p.glow, 16);
  const grad = ctx.createRadialGradient(x, y, 0, x, y, p.size);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.4, p.color); grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

// ── Wave ──────────────────────────────────────────────────────────────────────
function updateWave(p, dt) {
  p.t += p.speed * dt;
  if (p.t >= 1) { p.life = 0; return; }
  p.alpha = p.t < 0.85 ? 1 : 1 - (p.t - 0.85) / 0.15;
}
function drawWave(p) {
  const x = p.sx + (p.ex - p.sx)*p.t, y = p.sy + (p.ey - p.sy)*p.t;
  ctx.save(); ctx.globalAlpha = p.alpha * 0.85;
  setGlow(p.glow, 16);
  const grad = ctx.createRadialGradient(x, y, 0, x, y, p.size);
  grad.addColorStop(0, '#eef8ff'); grad.addColorStop(0.4, p.color); grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, p.size, 0, Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

// ── Heal ──────────────────────────────────────────────────────────────────────
function updateHeal(p, dt) {
  p.y -= p.vy * dt * 0.016; p.life -= 0.018 * dt; p.alpha = p.life;
}
function drawHeal(p) {
  ctx.save(); ctx.globalAlpha = p.alpha;
  setGlow(p.glow, 12); ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

// ── Glow pulse ────────────────────────────────────────────────────────────────
function updateGlowPulse(p, dt) {
  p.radius += p.speed * dt * p.maxRadius; p.alpha -= 0.018 * dt;
  if (p.alpha <= 0 || p.radius >= p.maxRadius) p.life = 0;
}
function drawGlowPulse(p) {
  ctx.save(); ctx.globalAlpha = p.alpha;
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
  grad.addColorStop(0, 'transparent'); grad.addColorStop(0.6, p.color + '44'); grad.addColorStop(1, p.glow + '00');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2); ctx.fill(); ctx.restore();
}

// ── Ring ──────────────────────────────────────────────────────────────────────
function updateRing(p, dt) {
  p.radius += p.speed * dt * p.maxRadius; p.alpha -= 0.025 * dt;
  if (p.alpha <= 0 || p.radius >= p.maxRadius) p.life = 0;
}
function drawRing(p) {
  ctx.save(); ctx.globalAlpha = p.alpha;
  setGlow(p.glow, 20); ctx.strokeStyle = p.color; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2); ctx.stroke();
  clearGlow(); ctx.restore();
}

// ── Spark ─────────────────────────────────────────────────────────────────────
function updateSpark(p, dt) {
  p.x += p.vx * dt * 0.016; p.y += p.vy * dt * 0.016;
  p.life -= 0.022 * dt; p.alpha = p.life;
}
function drawSpark(p) {
  ctx.save(); ctx.globalAlpha = p.alpha;
  setGlow(p.glow, 10); ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.alpha, 0, Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

// ── Fire drop ─────────────────────────────────────────────────────────────────
function updateFireDrop(p, dt) {
  p.x += p.vx * dt * 0.016; p.y += p.vy * dt * 0.016;
  p.vy += 0.15 * dt; p.life -= 0.016 * dt; p.alpha = p.life;
}
function drawFireDrop(p) {
  ctx.save(); ctx.globalAlpha = p.alpha;
  setGlow(p.glow, 14);
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size*p.life);
  grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.3, p.color); grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, p.size*p.life, 0, Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

// ── Shrapnel ─────────────────────────────────────────────────────────────────
function updateShrapnel(p, dt) {
  p.x += p.vx * dt * 0.016; p.y += p.vy * dt * 0.016;
  p.vx *= 0.97; p.vy *= 0.97; p.life -= 0.018 * dt; p.alpha = p.life;
}
function drawShrapnel(p) {
  ctx.save(); ctx.globalAlpha = p.alpha;
  setGlow(p.glow, 8); ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.rect(p.x - p.size*0.5, p.y - p.size*0.5, p.size, p.size*0.4); ctx.fill();
  clearGlow(); ctx.restore();
}

// ── Implode ───────────────────────────────────────────────────────────────────
function updateImplode(p, dt) {
  if (p.phase === 'in') {
    p.x += (p.tx - p.x) * 0.08 * dt; p.y += (p.ty - p.y) * 0.08 * dt;
    const dx = p.tx - p.x, dy = p.ty - p.y;
    if (Math.sqrt(dx*dx + dy*dy) < 4) { p.life = 0; return; }
  }
  p.life -= 0.012 * dt; p.alpha = p.life;
}
function drawImplode(p) {
  ctx.save(); ctx.globalAlpha = p.alpha;
  setGlow(p.glow, 14);
  const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
  grad.addColorStop(0, '#ffffff44'); grad.addColorStop(0.4, p.color); grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
  clearGlow(); ctx.restore();
}

// ── Ice ring ──────────────────────────────────────────────────────────────────
function updateIceRing(p, dt) {
  p.radius += p.speed * dt * p.maxRadius; p.alpha -= 0.02 * dt;
  if (p.alpha <= 0 || p.radius >= p.maxRadius) p.life = 0;
}
function drawIceRing(p) {
  ctx.save(); ctx.globalAlpha = p.alpha;
  setGlow(p.glow, 24);
  const grad = ctx.createRadialGradient(p.x, p.y, p.radius*0.7, p.x, p.y, p.radius);
  grad.addColorStop(0, p.color + 'aa'); grad.addColorStop(1, p.glow + '00');
  ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#eef8ff'; ctx.lineWidth = 2; ctx.stroke();
  clearGlow(); ctx.restore();
}

// ── Ice shard ─────────────────────────────────────────────────────────────────
function updateIceShard(p, dt) {
  p.x += p.vx * dt * 0.016; p.y += p.vy * dt * 0.016;
  p.angle += 0.05 * dt; p.life -= 0.015 * dt; p.alpha = p.life;
}
function drawIceShard(p) {
  ctx.save(); ctx.globalAlpha = p.alpha * 0.9;
  ctx.translate(p.x, p.y); ctx.rotate(p.angle);
  setGlow(p.glow, 12); ctx.fillStyle = p.color + 'bb'; ctx.strokeStyle = '#eef8ff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -p.size); ctx.lineTo(p.size*0.4, 0);
  ctx.lineTo(0, p.size); ctx.lineTo(-p.size*0.4, 0); ctx.closePath();
  ctx.fill(); ctx.stroke(); clearGlow(); ctx.restore();
}

// ── Float number ─────────────────────────────────────────────────────────────
function updateFloatNum(p, dt) {
  p.y    -= (dt / 1000) * 55 * devicePixelRatio;
  p.life -= dt / 1400;
  p.alpha = Math.min(1, p.life * 4);
}
function drawFloatNum(p) {
  ctx.save(); ctx.globalAlpha = Math.max(0, p.alpha);
  ctx.font = `bold ${p.fontSize}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = p.fontSize * 0.1; ctx.lineJoin = 'round';
  ctx.strokeText(p.text, p.x, p.y);
  setGlow(p.glow, 14); ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
  clearGlow(); ctx.restore();
}

// ─── Background ───────────────────────────────────────────────────────────────
function drawBackground() {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Stars only in the top (arena) half
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, HALF());
  ctx.clip();
  drawStars();
  ctx.restore();

  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, HALF()); ctx.lineTo(canvas.width, HALF()); ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.font = `${Math.max(11, canvas.width * 0.018)}px system-ui`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('ARENA', 14, 12);
  ctx.fillText('ABILITIES', 14, HALF() + 10);
}

// ─── Color lerp ───────────────────────────────────────────────────────────────
function lerpColor(a, b, t) {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const rr = Math.round(ar + (br-ar)*t), rg = Math.round(ag + (bg-ag)*t), rb = Math.round(ab + (bb-ab)*t);
  return '#' + ((1<<24)|(rr<<16)|(rg<<8)|rb).toString(16).slice(1);
}

// ─── Tween updates ────────────────────────────────────────────────────────────
function updateTweens(dt) {
  if (playerFlash) {
    playerFlash.t += 0.025 * dt;
    if (playerFlash.t >= 1) playerFlash = null;
  }
  if (enemyFlash) {
    enemyFlash.t += 0.025 * dt;
    if (enemyFlash.t >= 1) enemyFlash = null;
  }
  if (enemyImpact) {
    enemyImpact.t += 0.022 * dt;
    if (enemyImpact.t >= 1) {
      enemyImpact = null;
    } else if (enemyImpact.t > 0.05 && !enemyImpact.spawned) {
      enemyImpact.spawned = true;
      spawnImpact(enemyImpact.color);
    }
  }
  if (playerImpact) {
    playerImpact.t += 0.022 * dt;
    if (playerImpact.t >= 1) {
      playerImpact = null;
    } else if (playerImpact.t > 0.05 && !playerImpact.spawned) {
      playerImpact.spawned = true;
      spawnPlayerImpact(playerImpact.color);
    }
  }
}

// ─── Cooldown tick ────────────────────────────────────────────────────────────
function updateCooldowns(dt) {
  for (const id in cooldowns) {
    if (cooldowns[id].remaining > 0)
      cooldowns[id].remaining = Math.max(0, cooldowns[id].remaining - dt);
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────
let lastTime = 0;

function loop(ts) {
  const dt = Math.min(ts - lastTime, 50);
  lastTime = ts;

  // Shake
  if (shake.elapsed < shake.duration) shake.elapsed += dt;
  const shakeProgress = Math.max(0, 1 - shake.elapsed / shake.duration);
  const sx = shakeProgress > 0 ? (Math.random()-0.5) * shake.intensity * shakeProgress * 2 : 0;
  const sy = shakeProgress > 0 ? (Math.random()-0.5) * shake.intensity * shakeProgress * 2 : 0;

  // Hit-combo timer
  if (comboTimer > 0) comboTimer = Math.max(0, comboTimer - dt);

  updateStars(dt);
  drawBackground();

  // Arena — shakes on impact
  ctx.save();
  ctx.translate(sx, sy);
  drawSquares();
  updateTweens(dt);
  updateParticles(dt);
  drawParticles();
  ctx.restore();

  // UI — no shake
  updateCooldowns(dt);
  drawButtons();
  drawHUD();

  if (gameOver) drawGameOver();

  requestAnimationFrame(loop);
}

requestAnimationFrame(ts => { lastTime = ts; requestAnimationFrame(loop); });
