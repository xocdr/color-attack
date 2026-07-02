import * as THREE from 'three';

import { makeFireDrake,  collectDrakeParts,  animateDrakeIdle,  animateDrakeAttack,  DRAKE_STATS  } from './monsters/fire-drake.js';
import { makeBladeImp,   collectImpParts,    animateImpIdle,    animateImpAttack,    IMP_STATS    } from './monsters/blade-imp.js';
import { makeTideLord,   collectTideParts,   animateTideIdle,   animateTideAttack,   TIDE_STATS   } from './monsters/tide-lord.js';
import { makeSporeKin,   collectSporeParts,  animateSporeIdle,  animateSporeAttack,  SPORE_STATS  } from './monsters/spore-kin.js';
import { makeBoneGiant,  collectBoneParts,   animateBoneIdle,   animateBoneAttack,   BONE_STATS   } from './monsters/bone-giant.js';
import { buildDuelist, animateDuelist } from './scene/duelist.js';
import { mapManager }    from './map/MapManager.js';
import { SandArenaMap }  from './map/maps/SandArenaMap.js';
import { DarkFantasyMap } from './map/maps/DarkFantasyMap.js';
import { getBackTex }    from './map/MapUtils.js';
import { createProjectileSystem }     from './systems/projectiles.js';
import { startAttack }                from './systems/attack-system.js';
import { FieldSlot }                  from './systems/field-slot.js';
import { SummonSystem }               from './systems/summon-system.js';
import { TurnManager }                from './systems/turn-manager.js';
import { EnemyAI, ENEMY_FIELD_POSITIONS } from './systems/enemy-ai.js';
import { applyBuff, removeBuff, tickBuffs, getBuffs, getAtkModifier, isStunned, consumeStun, absorbWithShield, BUFF_DEFS } from './systems/buff-system.js';

// ── Renderer ─────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
// clearColor is set by MapManager.load() from the active map's config
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Scene / Camera ────────────────────────────────────────────────────────────
const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 5, 18);
camera.lookAt(0, 1, 0);

// Camera tilt (mouse wheel + right-drag)
const CAM_TARGET = new THREE.Vector3(0, 1, 0);
const CAM_RADIUS = Math.sqrt(0 + (5 - 1) ** 2 + 18 ** 2);
let camPolarAngle = Math.atan2(Math.sqrt(18 * 18), 5 - 1);
const CAM_MIN = 0.18, CAM_MAX = 1.45;

function applyCameraAngle() {
  camera.position.x = CAM_TARGET.x;
  camera.position.y = CAM_TARGET.y + CAM_RADIUS * Math.cos(camPolarAngle);
  camera.position.z = CAM_TARGET.z + CAM_RADIUS * Math.sin(camPolarAngle);
  camera.lookAt(CAM_TARGET);
}

renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  camPolarAngle = Math.max(CAM_MIN, Math.min(CAM_MAX, camPolarAngle + e.deltaY * 0.0008));
  applyCameraAngle();
}, { passive: false });

let rightDragY = null;
renderer.domElement.addEventListener('mousedown',   e => { if (e.button === 2) { e.preventDefault(); rightDragY = e.clientY; } });
renderer.domElement.addEventListener('mousemove',   e => {
  if (rightDragY === null) return;
  camPolarAngle = Math.max(CAM_MIN, Math.min(CAM_MAX, camPolarAngle + (e.clientY - rightDragY) * 0.005));
  rightDragY = e.clientY; applyCameraAngle();
});
renderer.domElement.addEventListener('mouseup',     e => { if (e.button === 2) rightDragY = null; });
renderer.domElement.addEventListener('mouseleave',  () => { rightDragY = null; });
renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

// ── Map System ────────────────────────────────────────────────────────────────
mapManager.register('sand-arena',   new SandArenaMap());
mapManager.register('dark-fantasy', new DarkFantasyMap());

// Select map via ?map=dark-fantasy query param; default to sand-arena.
const _mapId = new URLSearchParams(window.location.search).get('map') ?? 'sand-arena';
mapManager.load(_mapId, scene, renderer);

// ── Duelist ───────────────────────────────────────────────────────────────────
const duelist = buildDuelist(scene);
duelist.position.set(0, -3, -9);
duelist.scale.setScalar(1.45);
scene.add(duelist);

// ── Projectiles ───────────────────────────────────────────────────────────────
const { spawnProjectile, updateProjectiles } = createProjectileSystem(scene);

// ── Monster registry ──────────────────────────────────────────────────────────
const MONSTER_REGISTRY = {
  'Fire Drake': { builder: makeFireDrake, collect: collectDrakeParts, idle: animateDrakeIdle, attack: animateDrakeAttack, stats: DRAKE_STATS },
  'Blade Imp':  { builder: makeBladeImp,  collect: collectImpParts,   idle: animateImpIdle,  attack: animateImpAttack,  stats: IMP_STATS  },
  'Tide Lord':  { builder: makeTideLord,  collect: collectTideParts,  idle: animateTideIdle, attack: animateTideAttack, stats: TIDE_STATS },
  'Spore Kin':  { builder: makeSporeKin,  collect: collectSporeParts, idle: animateSporeIdle, attack: animateSporeAttack, stats: SPORE_STATS },
  'Bone Giant': { builder: makeBoneGiant, collect: collectBoneParts,  idle: animateBoneIdle, attack: animateBoneAttack, stats: BONE_STATS },
};

function registryFor(m) {
  return m.userData.registry;
}

// ── Effect / buff cards — non-monster cards resolved instantly on drop ────────
const EFFECT_CARD_REGISTRY = {
  'Rally Banner': { icon: '🚩', cost: 2, buffId: 'atk_up', duration: 3, value: 2 },
};

// ── Build template cache (GPU buffer sharing) ─────────────────────────────────
const templateCache = {};
Object.entries(MONSTER_REGISTRY).forEach(([name, reg]) => {
  templateCache[name] = reg.builder();
});

// ── Shader pre-warm — compile all monster shader permutations at load time ────
// Prevents a compile stall on the first summon of each monster type.
Object.values(templateCache).forEach(tmpl => { tmpl.position.set(0, -9999, 0); scene.add(tmpl); });
renderer.render(scene, camera);
Object.values(templateCache).forEach(tmpl => scene.remove(tmpl));

// ── Field positions — sourced from active map config ─────────────────────────
const PLAYER_POSITIONS = mapManager.getSpawnPoints('player');
const ENEMY_POSITIONS  = mapManager.getSpawnPoints('enemy');

// ── Field drop zone (single full-area target) ─────────────────────────────────
const fieldDropEl = document.createElement('div');
fieldDropEl.id = 'field-drop';
document.body.appendChild(fieldDropEl);

// ── State ─────────────────────────────────────────────────────────────────────
const activeMonsters   = [];
const playerField      = [];
let playerHP = 20;
let enemyHP  = 20;

function updateHPDisplay() {
  const el = document.getElementById('player-hp');
  if (el) el.textContent = `❤️ ${playerHP}`;
  const el2 = document.getElementById('enemy-hp');
  if (el2) el2.textContent = `💀 ${enemyHP}`;
}

function triggerGameOver(winner) {
  const overlay = document.getElementById('gameover-overlay');
  const text    = document.getElementById('gameover-text');
  if (!overlay || !text) return;
  text.textContent      = winner === 'player' ? '🏆 You Win!' : '💀 Game Over';
  overlay.style.display = 'flex';
}

const slotOccupied     = new Array(PLAYER_POSITIONS.length).fill(false);

// One FieldSlot per player position — owns the card-drop + monster-spawn pipeline.
const fieldSlots = PLAYER_POSITIONS.map((pos, i) =>
  new FieldSlot(pos, scene, i, monster => {
    activeMonsters.push(monster);
  })
);

// Auto-summon system — triggered by any card drop, picks the best free slot.
const summonSystem = new SummonSystem(
  scene, camera, slotOccupied, PLAYER_POSITIONS,
  MONSTER_REGISTRY, templateCache,
  addAura,
  monster => {
    activeMonsters.push(monster);
    const reg = MONSTER_REGISTRY[monster.userData.monsterName];
    if (reg) {
      monster._stats          = reg.stats;
      monster.userData.hp    = reg.stats.hp;
      monster.userData.maxHp = reg.stats.hp;
      monster.userData.atk   = reg.stats.atk;
      playerField.push({ mesh: monster, stats: reg.stats, hp: reg.stats.hp });
    }
  }
);

// Deck/graveyard bob is handled inside the map's tick() — no activeMonster push needed.
let   selectedMonster  = null;
const raycaster        = new THREE.Raycaster();
const mouse            = new THREE.Vector2();

// ── Aura light helper (disabled) ─────────────────────────────────────────────
function addAura(monster, color) {
  // Aura PointLights temporarily removed — each one changed the WebGL light
  // count and triggered a shader recompile stall on summon.
}

// ── Turn / mana system ─────────────────────────────────────────────────────────
const MAX_MANA = 10;
let playerMana    = 2;
let playerMaxMana = 2;
let turnNumber    = 1;
let currentTurn   = 'player'; // 'player' | 'enemy'

const manaDotsEl  = document.getElementById('mana-dots');
const endTurnBtn  = document.getElementById('end-turn-btn');
const turnBadgeEl = document.getElementById('turn-badge');

function updateCardAffordability() {
  document.querySelectorAll('#hand .card').forEach(card => {
    const cost       = Number(card.dataset.cost);
    const affordable = currentTurn === 'player' && cost <= playerMana;
    card.classList.toggle('unaffordable', !affordable);
  });
}

function renderTurnHud() {
  manaDotsEl.innerHTML = '';
  for (let i = 0; i < playerMaxMana; i++) {
    const dot = document.createElement('div');
    dot.className = 'mana-dot' + (i < playerMana ? ' filled' : '');
    manaDotsEl.appendChild(dot);
  }
  turnBadgeEl.textContent = `Turn ${turnNumber}`;
  endTurnBtn.disabled = currentTurn !== 'player';
  updateCardAffordability();
}

function startPlayerTurn() {
  currentTurn   = 'player';
  playerMaxMana = Math.min(playerMaxMana + 1, MAX_MANA);
  playerMana    = playerMaxMana;
  renderTurnHud();
}

function endPlayerTurn() {
  if (currentTurn !== 'player') return;
  turnManager.endPlayerTurn(enemyAI);
}

endTurnBtn.addEventListener('click', endPlayerTurn);

// ── Enemy AI ──────────────────────────────────────────────────────────────────
const enemyMeshes = [];
const enemyAI = new EnemyAI();
enemyAI.init({
  scene,
  activeMonsters,
  playerField,
  enemyMeshes,
  registryFor,
  destroyMonster,
  getPlayerHP: () => playerHP,
  setPlayerHP: (n) => { playerHP = n; updateHPDisplay(); },
  getEnemyHP:  () => enemyHP,
  setEnemyHP:  (n) => { enemyHP  = n; updateHPDisplay(); },
  onGameOver:  triggerGameOver,
  enemyFieldPositions: ENEMY_FIELD_POSITIONS,
});

// ── Turn Manager ──────────────────────────────────────────────────────────────
const turnManager = new TurnManager();
turnManager.onTurnChange = (state) => {
  const indicator = document.getElementById('turn-indicator');
  const btn       = document.getElementById('end-turn-btn');
  const isPlayer  = state === 'PLAYER_TURN';
  if (indicator) indicator.textContent = isPlayer ? 'Player Turn' : 'Enemy Turn';
  if (btn) { btn.disabled = !isPlayer; btn.style.opacity = isPlayer ? '1' : '0.4'; }
  currentTurn = isPlayer ? 'player' : 'enemy';
  if (isPlayer) {
    startPlayerTurn();
    processBuffTick([...activeMonsters, ...enemyMeshes]);
  }
};

renderTurnHud();
updateHPDisplay();

// ── Drag-and-drop ─────────────────────────────────────────────────────────────
let dragName = null;

function canDragCard(card) {
  return currentTurn === 'player' && Number(card.dataset.cost) <= playerMana;
}

function bindHandCard(card) {
  card.addEventListener('dragstart', e => {
    if (!canDragCard(card)) { e.preventDefault(); return; }
    dragName = card.dataset.name;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragName);
    card.classList.add('dragging');
    fieldDropEl.classList.add('dragging');
    renderer.domElement.style.pointerEvents = 'none';
  });
  card.addEventListener('dragend', () => {
    dragName = null;
    card.classList.remove('dragging');
    fieldDropEl.classList.remove('dragging');
    fieldDropEl.classList.remove('drag-over');
    renderer.domElement.style.pointerEvents = '';
  });
}

document.querySelectorAll('#hand .card').forEach(bindHandCard);

document.addEventListener('dragover', e => {
  if (!dragName) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (e.clientY < window.innerHeight - 130) {
    fieldDropEl.classList.add('drag-over');
  } else {
    fieldDropEl.classList.remove('drag-over');
  }
});
document.addEventListener('dragleave', e => {
  if (e.relatedTarget === null) fieldDropEl.classList.remove('drag-over');
});
document.addEventListener('drop', e => {
  if (!dragName) return;
  e.preventDefault();
  fieldDropEl.classList.remove('drag-over');
  if (e.clientY >= window.innerHeight - 130) return;

  const effectCard = EFFECT_CARD_REGISTRY[dragName];
  if (effectCard) {
    if (currentTurn !== 'player' || effectCard.cost > playerMana) return;
    if (activeMonsters.length === 0) return; // no valid target — card stays in hand
    playerMana -= effectCard.cost;
    renderTurnHud();
    activeMonsters.forEach(m => applyBuff(m, effectCard.buffId, {
      duration: effectCard.duration, value: effectCard.value,
    }));
    document.querySelector(`.card[data-name="${dragName}"]`)?.remove();
    return;
  }

  const reg = MONSTER_REGISTRY[dragName];
  if (!reg) return;
  const cost = reg.stats.cost;
  if (currentTurn !== 'player' || cost > playerMana) return;
  playerMana -= cost;
  renderTurnHud();
  summonSystem.executeSummonSequence({
    name: dragName, icon: reg.stats.icon,
    cost: reg.stats.cost, auraColor: reg.stats.auraColor,
  });
  document.querySelector(`.card[data-name="${dragName}"]`)?.remove();
});

// ── Deck click — draw a card ──────────────────────────────────────────────────
const CARD_POOL = [
  { name: 'Fire Drake', icon: '🐉', cost: 3 },
  { name: 'Blade Imp',  icon: '🗡️', cost: 2 },
  { name: 'Tide Lord',  icon: '🌊', cost: 4 },
  { name: 'Spore Kin',  icon: '🍄', cost: 1 },
  { name: 'Bone Giant', icon: '💀', cost: 5 },
  { name: 'Rally Banner', icon: '🚩', cost: 2 },
];

const _deckZone     = mapManager.getConfig().deckZone;
const deckWorldPos  = new THREE.Vector3(_deckZone.center.x, _deckZone.center.y, _deckZone.center.z);
const flyCardGeo    = new THREE.BoxGeometry(1.4, 0.022, 1.9);
const _flyCardSide  = new THREE.MeshStandardMaterial({ color: 0x1a1a2e });
const _flyCardFace  = new THREE.MeshStandardMaterial({ map: getBackTex() });
const flyCardMat    = [_flyCardSide, _flyCardSide, _flyCardFace, _flyCardSide, _flyCardSide, _flyCardSide];
let flyCard     = null;
let flyProgress = 0;
let flyTarget   = null;
const FLY_DUR   = 0.7;

function addCardToHand(cardData) {
  const div = document.createElement('div');
  div.className   = 'card dealing';
  div.draggable   = true;
  div.dataset.name = cardData.name;
  div.dataset.icon = cardData.icon;
  div.dataset.cost = String(cardData.cost);
  div.innerHTML = `
    <span class="card-cost">${cardData.cost}</span>
    <span class="card-icon">${cardData.icon}</span>
    <span class="card-name">${cardData.name}</span>
  `;
  bindHandCard(div);
  div.addEventListener('animationend', () => div.classList.remove('dealing'));
  document.getElementById('hand').appendChild(div);
  updateCardAffordability();
}

// Deck meshes for raycasting — sourced from active map
const deckMeshes = mapManager.getRaycastTargets('deck');

// ── Click selection + attack targeting ───────────────────────────────────────
const selectableObjects = () => [...activeMonsters, ...enemyMeshes];

let hoveredEnemy = null;

function setHoveredEnemy(enemy) {
  if (hoveredEnemy === enemy) return;
  if (hoveredEnemy) highlightMonster(hoveredEnemy, false);
  hoveredEnemy = enemy;
  if (hoveredEnemy) highlightMonster(hoveredEnemy, true, 0xff2200);
}

renderer.domElement.addEventListener('mousemove', e => {
  if (!selectedMonster || selectedMonster.userData.isEnemy) {
    setHoveredEnemy(null);
    renderer.domElement.style.cursor = '';
    return;
  }
  const mx =  (e.clientX / window.innerWidth)  * 2 - 1;
  const my = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);
  const hits = raycaster.intersectObjects(enemyMeshes, true);
  if (!hits.length) {
    setHoveredEnemy(null);
    renderer.domElement.style.cursor = '';
    return;
  }
  let root = hits[0].object;
  while (root.parent && root.parent !== scene && !root.userData.monsterName) root = root.parent;
  if (root.userData.isEnemy) {
    setHoveredEnemy(root);
    renderer.domElement.style.cursor = 'crosshair';
  } else {
    setHoveredEnemy(null);
    renderer.domElement.style.cursor = '';
  }
});

renderer.domElement.addEventListener('click', e => {
  if (rightDragY !== null) return;
  mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  // 1. Check deck click first
  const deckHits = raycaster.intersectObjects(deckMeshes, false);
  if (deckHits.length > 0 && !flyCard) {
    const card = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
    if (flyCard) scene.remove(flyCard);
    flyCard = new THREE.Mesh(flyCardGeo, flyCardMat);
    flyCard.position.copy(deckWorldPos);
    flyCard.rotation.x = 0.1;
    scene.add(flyCard);
    flyProgress = 0;
    flyTarget   = card;
    return;
  }

  // 2. Monster selection / attack
  const hits = raycaster.intersectObjects(selectableObjects(), true);
  if (!hits.length) {
    // Hero attack: selected player monster clicking empty enemy territory
    if (selectedMonster && !selectedMonster.userData.isEnemy && !selectedMonster._attacking) {
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const pt = new THREE.Vector3();
      raycaster.ray.intersectPlane(groundPlane, pt);
      if (pt && pt.z < 0) {
        if (consumeStun(selectedMonster)) { clearSelection(); return; }
        const dmg = (selectedMonster.userData.atk ?? 0) + getAtkModifier(selectedMonster);
        enemyHP = Math.max(0, enemyHP - dmg);
        showDamageNumber(dmg, new THREE.Vector3(1, 0.5, -3));
        flashRed(selectedMonster); // brief flash on attacker
        updateHPDisplay();
        if (enemyHP <= 0) triggerGameOver('player');
        clearSelection();
        return;
      }
    }
    clearSelection();
    return;
  }

  let clicked = hits[0].object;
  while (clicked.parent && clicked.parent !== scene && !clicked.userData.monsterName) clicked = clicked.parent;
  if (!clicked.userData.monsterName) return;

  if (clicked.userData.isEnemy) {
    if (selectedMonster && !selectedMonster.userData.isEnemy && !selectedMonster._attacking) {
      if (consumeStun(selectedMonster)) { clearSelection(); return; }
      setHoveredEnemy(null);
      renderer.domElement.style.cursor = '';
      startAttack(selectedMonster, clicked, resolveAttack);
      clearSelection();
    }
    return;
  }

  if (selectedMonster === clicked) { clearSelection(); return; }
  clearSelection();
  selectedMonster = clicked;
  highlightMonster(selectedMonster, true);
});

function highlightMonster(monster, on, color = 0x00ffff) {
  monster.traverse(c => {
    if (!c.isMesh) return;
    if (on) {
      c.userData._selMat = c.material;
      c.material = c.material.clone();
      c.material.emissive = new THREE.Color(color);
      c.material.emissiveIntensity = 0.7;
    } else if (c.userData._selMat) {
      c.material = c.userData._selMat;
      delete c.userData._selMat;
    }
  });
}

// Player-field and enemy-field slot entries mirror each mesh's hp separately
// from mesh.userData.hp (used for HP-bar display) — keep both in sync here.
function findFieldEntry(mesh) {
  return playerField.find(e => e && e.mesh === mesh)
      ?? enemyAI.enemyField.find(e => e && e.mesh === mesh)
      ?? null;
}

function applyDamage(mesh, dmg) {
  mesh.userData.hp = (mesh.userData.hp ?? 0) - dmg;
  const entry = findFieldEntry(mesh);
  if (entry) entry.hp = mesh.userData.hp;
  showDamageNumber(dmg, mesh.position);
  flashRed(mesh);
  if (mesh.userData.hp <= 0) destroyMonster(mesh);
}

function processBuffTick(meshes) {
  meshes.forEach(m => {
    if (!m.parent) return; // already destroyed
    const burn = getBuffs(m).find(b => b.id === 'burn');
    if (burn) applyDamage(m, burn.value * burn.stacks);
    tickBuffs(m);
  });
}

function resolveAttack(attacker, target) {
  if (!target.parent) return; // already destroyed
  const dmg = (attacker.userData.atk ?? 0) + getAtkModifier(attacker);
  if (absorbWithShield(target)) return;
  applyDamage(target, dmg);
}

function showDamageNumber(amount, worldPos) {
  const pos = worldPos.clone();
  pos.y += 1.8;
  pos.project(camera);
  const x = (pos.x *  0.5 + 0.5) * window.innerWidth;
  const y = (pos.y * -0.5 + 0.5) * window.innerHeight;
  const div = document.createElement('div');
  div.className   = 'dmg-number';
  div.textContent = '-' + amount;
  div.style.left  = x + 'px';
  div.style.top   = y + 'px';
  document.body.appendChild(div);
  div.addEventListener('animationend', () => div.remove());
}

function flashRed(target) {
  const redMat = new THREE.MeshStandardMaterial({ color: 0xff1111, emissive: 0xff0000, emissiveIntensity: 2 });
  const origMats = [];
  target.traverse(c => {
    if (c.isMesh) { origMats.push({ mesh: c, mat: c.material }); c.material = redMat; }
  });
  setTimeout(() => { origMats.forEach(({ mesh, mat }) => { mesh.material = mat; }); redMat.dispose(); }, 220);
}

function destroyMonster(target) {
  scene.remove(target);
  if (target.userData._hpBar) { target.userData._hpBar.remove(); target.userData._hpBar = null; }
  if (target.userData._statusBar) { target.userData._statusBar.remove(); target.userData._statusBar = null; }
  if (target.userData._cardIndicator) { scene.remove(target.userData._cardIndicator); target.userData._cardIndicator = null; }
  const ei = enemyMeshes.indexOf(target);
  if (ei !== -1) enemyMeshes.splice(ei, 1);
  const ai = activeMonsters.indexOf(target);
  if (ai !== -1) activeMonsters.splice(ai, 1);
  const pi = playerField.findIndex(e => e.mesh === target);
  if (pi !== -1) playerField.splice(pi, 1);
  const fi = enemyAI.enemyField.findIndex(e => e?.mesh === target);
  if (fi !== -1) enemyAI.enemyField[fi] = null;
}

function clearSelection() {
  if (selectedMonster) highlightMonster(selectedMonster, false);
  selectedMonster = null;
  setHoveredEnemy(null);
  renderer.domElement.style.cursor = '';
}

// Environment animation state is managed inside the active MapInterface instance.

// ── Status bar helper ─────────────────────────────────────────────────────────
function updateStatusBar(m, sx, sy) {
  let bar = m.userData._statusBar;
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'status-bar';
    document.body.appendChild(bar);
    m.userData._statusBar = bar;
  }
  const buffs = getBuffs(m);
  if (!buffs.length) {
    bar.style.display = 'none';
    m.userData._statusSig = '';
    return;
  }
  bar.style.display = 'flex';
  bar.style.left = sx + 'px';
  bar.style.top = sy + 'px';
  const sig = buffs.map(b => `${b.id}:${b.duration}:${b.stacks}`).join('|');
  if (sig === m.userData._statusSig) return;
  m.userData._statusSig = sig;
  bar.innerHTML = buffs.map(b => {
    const def = BUFF_DEFS[b.id];
    if (!def) return '';
    const stacks = b.stacks > 1 ? `<sup class="stacks">${b.stacks}</sup>` : '';
    const dur = `<span class="duration">${b.duration}</span>`;
    const desc = (def.description || '').replace(/\{value\}/g, b.value);
    return `<span class="status-badge ${def.kind}" title="${def.name}: ${desc}">${def.icon}${stacks}${dur}</span>`;
  }).join('');
}

// ── Animate loop ──────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
let lastT = 0;

function animate() {
  requestAnimationFrame(animate);
  const t     = clock.getElapsedTime();
  const delta = t - lastT;
  lastT = t;

  // Drive card-drop + monster-spawn animations for each player slot.
  fieldSlots.forEach(slot => slot.update(delta));
  summonSystem.update(delta);

  // Monsters — idle or attacking + player HP bars
  activeMonsters.forEach(m => {
    const reg = registryFor(m);
    if (reg) {
      if (m._attacking) { reg.attack(m, t, delta, spawnProjectile); }
      else              { reg.idle(m, t); }
    }

    // HP bar — always rendered regardless of registry
    let bar = m.userData._hpBar;
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'player-hp-bar';
      document.body.appendChild(bar);
      m.userData._hpBar = bar;
    }
    const wp = m.position.clone();
    wp.project(camera);
    if (wp.z > 1) { bar.style.display = 'none'; }
    else {
      bar.style.display = '';
      bar.style.left = ((wp.x * 0.5 + 0.5) * window.innerWidth) + 'px';
      bar.style.top  = ((wp.y * -0.5 + 0.5) * window.innerHeight + 80) + 'px';
      const hp    = m.userData.hp    ?? '?';
      const maxHp = m.userData.maxHp ?? hp;
      const name  = m.userData.monsterName ?? '';
      bar.textContent = `${name}  ${hp}/${maxHp} ♥`;
    }

    // Status bar — above HP bar
    const sx = (wp.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (wp.y * -0.5 + 0.5) * window.innerHeight + 80;
    updateStatusBar(m, sx, sy - 20);
  });

  // Enemy animations + HP bars
  enemyMeshes.forEach(m => {
    const reg = registryFor(m);
    if (!reg) return;
    if (m._attacking) reg.attack(m, t, delta, spawnProjectile);
    else              reg.idle(m, t);

    // HP bar overlay
    let bar = m.userData._hpBar;
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'enemy-hp-bar';
      document.body.appendChild(bar);
      m.userData._hpBar = bar;
    }
    const wp = m.position.clone(); wp.y += 2.2;
    wp.project(camera);
    if (wp.z > 1) { bar.style.display = 'none'; }
    else {
      bar.style.display = '';
      bar.style.left = ((wp.x * 0.5 + 0.5) * window.innerWidth) + 'px';
      bar.style.top  = ((wp.y * -0.5 + 0.5) * window.innerHeight) + 'px';
      const hp    = m.userData.hp    ?? '?';
      const maxHp = m.userData.maxHp ?? hp;
      bar.textContent = `${hp}/${maxHp} ❤`;
    }

    // Status bar — above HP bar
    const sx = (wp.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (wp.y * -0.5 + 0.5) * window.innerHeight;
    updateStatusBar(m, sx, sy - 20);
  });

  updateProjectiles(delta);

  // Flying card draw animation
  if (flyCard) {
    flyProgress = Math.min(flyProgress + delta / FLY_DUR, 1);
    const ease = flyProgress * flyProgress * (3 - 2 * flyProgress);
    flyCard.position.x = deckWorldPos.x * (1 - ease);
    flyCard.position.z = deckWorldPos.z + (camera.position.z - deckWorldPos.z) * ease * 0.55;
    flyCard.position.y = deckWorldPos.y + Math.sin(ease * Math.PI) * 3.0;
    flyCard.rotation.x = 0.1 + ease * (Math.PI * 0.55);
    flyCard.rotation.z = Math.sin(ease * Math.PI) * 0.15;
    flyCard.scale.setScalar(1 + Math.sin(ease * Math.PI) * 0.25);
    if (flyProgress >= 1) {
      scene.remove(flyCard);
      flyCard = null;
      flyProgress = 0;
      addCardToHand(flyTarget);
      flyTarget = null;
    }
  }

  // Duelist
  animateDuelist(duelist, t, delta);

  // Environment animation (torches, particles, fog, deck bob) — delegated to active map
  mapManager.tick(t, delta);

  renderer.render(scene, camera);
}

animate();

// Debug hook for manual browser-console testing
window.__buffDebug = { applyBuff, removeBuff, isStunned, BUFF_DEFS, activeMonsters, enemyMeshes };
