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

// ── Renderer ─────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
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
const slotOccupied     = new Array(PLAYER_POSITIONS.length).fill(false);

// One FieldSlot per player position — owns the card-drop + monster-spawn pipeline.
const fieldSlots = PLAYER_POSITIONS.map((pos, i) =>
  new FieldSlot(pos, scene, i, monster => {
    // Called when MONSTER_SPAWNING completes → register monster for idle/attack updates.
    activeMonsters.push(monster);
  })
);

// Auto-summon system — triggered by any card drop, picks the best free slot.
const summonSystem = new SummonSystem(
  scene, camera, slotOccupied, PLAYER_POSITIONS,
  MONSTER_REGISTRY, templateCache,
  addAura,
  monster => { activeMonsters.push(monster); }
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

// ── Drag-and-drop ─────────────────────────────────────────────────────────────
let dragName = null;
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('dragstart', e => {
    dragName = card.dataset.name;
    card.classList.add('dragging');
    fieldDropEl.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    dragName = null;
    card.classList.remove('dragging');
    fieldDropEl.classList.remove('dragging');
    fieldDropEl.classList.remove('drag-over');
  });
});

fieldDropEl.addEventListener('dragover', e => {
  e.preventDefault();
  if (dragName) fieldDropEl.classList.add('drag-over');
});
fieldDropEl.addEventListener('dragleave', () => fieldDropEl.classList.remove('drag-over'));
fieldDropEl.addEventListener('drop', e => {
  e.preventDefault();
  fieldDropEl.classList.remove('drag-over');
  if (!dragName) return;
  const reg = MONSTER_REGISTRY[dragName];
  if (!reg) return;
  summonSystem.executeSummonSequence({
    name: dragName, icon: reg.stats.icon,
    cost: reg.stats.cost, auraColor: reg.stats.auraColor,
  });
  document.querySelector(`.card[data-name="${dragName}"]`)?.remove();
});

// ── Enemy spawn (demo) ────────────────────────────────────────────────────────
const ENEMY_NAMES = ['Fire Drake', 'Blade Imp', 'Tide Lord', 'Spore Kin', 'Bone Giant'];
const enemyMeshes = [];
ENEMY_NAMES.forEach((name, i) => {
  if (i >= ENEMY_POSITIONS.length) return;
  const reg = MONSTER_REGISTRY[name];
  const m   = templateCache[name].clone();
  m.position.copy(ENEMY_POSITIONS[i]);
  m.rotation.y = Math.PI;
  m.userData.baseY = 0;
  m.userData.monsterName = name;
  m.userData.registry = reg;
  m.userData.phase = i * 1.1;
  m.userData.isEnemy = true;
  addAura(m, reg.stats.auraColor);
  scene.add(m);
  enemyMeshes.push(m);
});

// ── Deck click — draw a card ──────────────────────────────────────────────────
const CARD_POOL = [
  { name: 'Fire Drake', icon: '🐉', cost: 3 },
  { name: 'Blade Imp',  icon: '🗡️', cost: 2 },
  { name: 'Tide Lord',  icon: '🌊', cost: 4 },
  { name: 'Spore Kin',  icon: '🍄', cost: 1 },
  { name: 'Bone Giant', icon: '💀', cost: 5 },
  { name: 'Storm Hawk', icon: '⚡', cost: 3 },
  { name: 'Iron Golem', icon: '🪨', cost: 4 },
  { name: 'Shadow Fox', icon: '🦊', cost: 2 },
];

const _deckZone     = mapManager.getZoneById('deck');
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
  div.addEventListener('dragstart', e => {
    dragName = div.dataset.name;
    div.classList.add('dragging');
    fieldDropEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  div.addEventListener('dragend', () => {
    dragName = null;
    div.classList.remove('dragging');
    fieldDropEl.classList.remove('dragging');
    fieldDropEl.classList.remove('drag-over');
  });
  div.addEventListener('animationend', () => div.classList.remove('dealing'));
  document.getElementById('hand').appendChild(div);
}

// Deck meshes for raycasting — sourced from active map
const deckMeshes = mapManager.getRaycastTargets('deck');

// ── Click selection + attack targeting ───────────────────────────────────────
const selectableObjects = () => [...activeMonsters, ...enemyMeshes];

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
  if (!hits.length) { clearSelection(); return; }

  let clicked = hits[0].object;
  while (clicked.parent && clicked.parent !== scene && !clicked.userData.monsterName) clicked = clicked.parent;
  if (!clicked.userData.monsterName) return;

  if (clicked.userData.isEnemy) {
    if (selectedMonster && !selectedMonster.userData.isEnemy && !selectedMonster._attacking) {
      startAttack(selectedMonster, clicked);
      clearSelection();
    }
    return;
  }

  if (selectedMonster === clicked) { clearSelection(); return; }
  clearSelection();
  selectedMonster = clicked;
  if (selectedMonster.userData.aura) selectedMonster.userData.aura.intensity = 3.0;
});

function clearSelection() {
  if (selectedMonster && selectedMonster.userData.aura) selectedMonster.userData.aura.intensity = 1.0;
  selectedMonster = null;
}

// Environment animation state is managed inside the active MapInterface instance.

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

  // Monsters — idle or attacking
  activeMonsters.forEach(m => {
    const reg = registryFor(m);
    if (!reg) return;
    if (m._attacking) { reg.attack(m, t, delta, spawnProjectile); }
    else              { reg.idle(m, t); }
  });

  // Enemy idle animations
  enemyMeshes.forEach(m => {
    const reg = registryFor(m);
    if (reg && !m._attacking) reg.idle(m, t);
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
