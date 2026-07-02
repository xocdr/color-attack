# Plan: Turn-Based Enemy AI Summoning System (3D Arena)

## Goal
Add a complete turn-based system to the 3D arena (`src/arena.js`) with an enemy AI that
summons monsters using existing factory functions, makes strategic attack decisions, and
executes its turn step-by-step with visual feedback. Three difficulty levels (Easy/Normal/Hard).
The 2D card game (`game.js`) is left completely untouched.

---

## Context

### Critical Files
| File | Role |
|------|------|
| `src/arena.js` | Three.js game loop, monster registry, player summon system, `enemyMeshes[]`, `selectableObjects()`, `destroyMonster()`, `registryFor()` |
| `src/monsters/fire-drake.js` | `DRAKE_STATS { name, icon, cost, auraColor, atk, hp }`, `makeFireDrake()`, `collectDrakeParts()`, `animateDrakeIdle()`, `animateDrakeAttack()` |
| `src/monsters/blade-imp.js` | `IMP_STATS`, `makeBladeImp()`, `collectImpParts()`, `animateImpIdle()`, `animateImpAttack()` |
| `src/monsters/tide-lord.js` | `TIDE_STATS`, `makeTideLord()`, `collectTideParts()`, `animateTideIdle()`, `animateTideAttack()` |
| `src/monsters/spore-kin.js` | `SPORE_STATS`, `makeSporeKin()`, `collectSporeParts()`, `animateSporeIdle()`, `animateSporeAttack()` |
| `src/monsters/bone-giant.js` | `BONE_STATS`, `makeBoneGiant()`, `collectBoneParts()`, `animateBoneIdle()`, `animateBoneAttack()` |
| `index2.html` | HTML file that loads arena.js — add UI elements here |

### Monster Stats (final, do not change)
| Monster | cost | atk | hp |
|---------|------|-----|----|
| Blade Imp | 1 | 2 | 2 |
| Spore Kin | 2 | 1 | 5 |
| Fire Drake | 3 | 4 | 3 |
| Tide Lord | 4 | 3 | 6 |
| Bone Giant | 5 | 5 | 8 |

### Key Existing Constructs in arena.js
- `activeMonsters` (array) — player monster meshes on field
- `enemyMeshes` (array, line 258) — already wired into `selectableObjects()` and `destroyMonster()`; currently always empty
- `selectableObjects()` (line 305) — `[...activeMonsters, ...enemyMeshes]`
- `destroyMonster(target)` (line 382–388) — removes from scene, splices from both `activeMonsters` and `enemyMeshes`
- `registryFor(mesh)` — returns registry entry with idle/attack animation functions
- Monster registry (line ~87–93) — maps name → make/collect/idle/attack exports

### What Does NOT Exist
- No turn system in arena.js (currently real-time)
- No enemy AI or enemy summon logic
- No "End Turn" button or turn indicator UI
- No enemy field slot positions
- No hero HP variables in arena.js
- No `playerField` data structure tracking per-monster HP

---

## Design Decisions

All values below are final. opencode must not invent alternatives.

---

### Turn State Machine
```
PLAYER_TURN
  ↓ (player clicks "End Turn")
ENEMY_TURN_START  →  0.5s pause, show "Enemy Turn" indicator
  ↓
ENEMY_SUMMON_PHASE  →  AI summons up to N monsters (700ms between each)
  ↓
ENEMY_ATTACK_PHASE  →  Each enemy attacks in sequence (950ms between each)
  ↓
ENEMY_TURN_END  →  resources reset, turn++ → back to PLAYER_TURN
```

---

### New Files to Create

#### `src/systems/turn-manager.js`
```js
export class TurnManager {
  constructor() {
    this.state = 'PLAYER_TURN';
    this.turnNumber = 1;
    this.onTurnChange = null;  // callback(newState: string)
  }

  endPlayerTurn(enemyAI) {
    if (this.state !== 'PLAYER_TURN') return;
    this.state = 'ENEMY_TURN_START';
    this.onTurnChange?.(this.state);
    setTimeout(() => {
      this.state = 'ENEMY_TURN';
      this.onTurnChange?.(this.state);
      enemyAI.executeTurn(this.turnNumber, () => {
        this.turnNumber++;
        this.state = 'PLAYER_TURN';
        this.onTurnChange?.(this.state);
      });
    }, 500);
  }
}
```

#### `src/systems/enemy-ai.js`

Full class. All external dependencies injected via `init(ctx)` to avoid circular imports.

```js
import * as THREE from 'three';
import { DRAKE_STATS, makeFireDrake, collectDrakeParts } from '../monsters/fire-drake.js';
import { IMP_STATS,   makeBladeImp,  collectImpParts  } from '../monsters/blade-imp.js';
import { TIDE_STATS,  makeTideLord,  collectTideParts  } from '../monsters/tide-lord.js';
import { SPORE_STATS, makeSporeKin,  collectSporeParts } from '../monsters/spore-kin.js';
import { BONE_STATS,  makeBoneGiant, collectBoneParts  } from '../monsters/bone-giant.js';

// ── Difficulty ────────────────────────────────────────────────────────────────
export let AI_DIFFICULTY = 1; // 0=easy, 1=normal, 2=hard

const DIFFICULTY_MAX_SUMMONS    = [1,   3,   5  ];
const DIFFICULTY_NOISE_RANGE    = [0.5, 0.12, 0.0];
const DIFFICULTY_HOLD_THRESHOLD = [99,  0,   -2 ];
const DIFFICULTY_ADAPTIVE       = [false, false, true];

// ── Monster Pool (sorted cheapest→expensive) ──────────────────────────────────
const MONSTER_POOL = [
  { stats: IMP_STATS,   make: makeBladeImp,  collect: collectImpParts  },
  { stats: SPORE_STATS, make: makeSporeKin,  collect: collectSporeParts },
  { stats: DRAKE_STATS, make: makeFireDrake, collect: collectDrakeParts },
  { stats: TIDE_STATS,  make: makeTideLord,  collect: collectTideParts  },
  { stats: BONE_STATS,  make: makeBoneGiant, collect: collectBoneParts  },
];

export class EnemyAI {
  constructor() {
    // Injected context — set by init()
    this.scene = null;
    this.activeMonsters = null;   // ref to arena.js activeMonsters array
    this.playerField = null;      // ref to arena.js playerField array
    this.enemyMeshes = null;      // ref to arena.js enemyMeshes array
    this.registryFor = null;
    this.destroyMonster = null;
    this.getPlayerHP = null;      // () => number
    this.setPlayerHP = null;      // (n) => void
    this.getEnemyHP  = null;
    this.setEnemyHP  = null;
    this.onGameOver  = null;      // (winner: 'player'|'enemy') => void

    // Enemy field state: array of 5 slots
    // Each slot: null | { mesh, stats, hp, hasAttacked, summoningSickness, parts }
    this.enemyField = [null, null, null, null, null];

    // Enemy resources
    this.enemyMana    = 3;
    this.enemyMaxMana = 3;

    // Enemy field positions — set by init() after reading arena positions
    this.FIELD_POSITIONS = [];

    this._aiMode = 'balanced';
  }

  /** Call once after arena scene is ready */
  init(ctx) {
    this.scene          = ctx.scene;
    this.activeMonsters = ctx.activeMonsters;
    this.playerField    = ctx.playerField;
    this.enemyMeshes    = ctx.enemyMeshes;
    this.registryFor    = ctx.registryFor;
    this.destroyMonster = ctx.destroyMonster;
    this.getPlayerHP    = ctx.getPlayerHP;
    this.setPlayerHP    = ctx.setPlayerHP;
    this.getEnemyHP     = ctx.getEnemyHP;
    this.setEnemyHP     = ctx.setEnemyHP;
    this.onGameOver     = ctx.onGameOver;
    this.FIELD_POSITIONS = ctx.enemyFieldPositions; // array of 5 THREE.Vector3
  }

  // ── Resources ──────────────────────────────────────────────────────────────
  _startTurnResources(turnNumber) {
    this.enemyMaxMana = Math.min(10, 2 + turnNumber);
    this.enemyMana    = this.enemyMaxMana;
  }

  _clearSummoningSickness() {
    for (const slot of this.enemyField) {
      if (slot) slot.summoningSickness = false;
    }
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────
  _makeSnap(turnNumber) {
    const pf = this.playerField.filter(Boolean);
    const ef = this.enemyField.filter(Boolean);
    return {
      playerCount:    pf.length,
      enemyCount:     ef.length,
      playerTotalAtk: pf.reduce((s, m) => s + m.stats.atk, 0),
      enemyTotalAtk:  ef.reduce((s, m) => s + m.stats.atk, 0),
      playerTotalHp:  pf.reduce((s, m) => s + m.hp,        0),
      enemyTotalHp:   ef.reduce((s, m) => s + m.hp,        0),
      playerHP:       this.getPlayerHP(),
      enemyHP:        this.getEnemyHP(),
      turnNumber,
      enemyManaUsed:  this.enemyMaxMana - this.enemyMana,
    };
  }

  // ── AI Mode (hard only) ────────────────────────────────────────────────────
  _computeAiMode(snap) {
    this._aiMode = 'balanced';
    if (!DIFFICULTY_ADAPTIVE[AI_DIFFICULTY]) return;
    if (snap.enemyHP < 8)                              this._aiMode = 'defensive';
    if (snap.playerHP < 8)                             this._aiMode = 'aggro';
    if (snap.enemyCount >= 3 && snap.turnNumber > 5)   this._aiMode = 'control';
  }

  // ── Summon Scoring ─────────────────────────────────────────────────────────
  _scoreSummon(stats) {
    const freeSlots = this.enemyField.filter(s => s === null).length;
    let score = 0;
    score += stats.atk * 1.5;
    score += stats.hp  * 0.8;
    score -= stats.cost * 0.3;
    score += (freeSlots < 2 ? -5 : 0);
    if (this._aiMode === 'defensive') score += stats.hp  * 1.2;
    if (this._aiMode === 'aggro')     score += stats.atk * 1.5;
    const noise = DIFFICULTY_NOISE_RANGE[AI_DIFFICULTY];
    if (noise > 0) score *= (1 - noise + Math.random() * noise * 2);
    return score;
  }

  // ── Attack Scoring ─────────────────────────────────────────────────────────
  _scoreAttack(attackerStats, target, targetIsHero) {
    let score = 0;
    if (targetIsHero) {
      const kills = this.getPlayerHP() <= attackerStats.atk;
      score += kills ? 50 : 2;
      if (this._aiMode === 'defensive') score += -10;
      if (this._aiMode === 'aggro')     score += 5;
    } else {
      const kills    = target.hp <= attackerStats.atk;
      const survives = attackerStats.hp > target.stats.atk; // rough — ignores prior damage this turn
      score += kills    ? target.stats.atk * 2.0 : 0;
      score += survives ? 2.5 : -2.0;
      score += target.stats.atk * 0.5;
    }
    return score;
  }

  _chooseBestAttackAction(attackerSlotIdx) {
    const attacker = this.enemyField[attackerSlotIdx];
    if (!attacker) return null;

    let best = null;
    let bestScore = DIFFICULTY_HOLD_THRESHOLD[AI_DIFFICULTY];

    // Hero attack
    const heroScore = this._scoreAttack(attacker.stats, null, true);
    if (heroScore > bestScore) { bestScore = heroScore; best = { targetIsHero: true }; }

    // Each player monster
    for (let i = 0; i < this.playerField.length; i++) {
      const target = this.playerField[i];
      if (!target) continue;
      const s = this._scoreAttack(attacker.stats, target, false);
      if (s > bestScore) { bestScore = s; best = { targetIsHero: false, targetIdx: i }; }
    }

    return best; // null = skip (below hold threshold)
  }

  // ── Spawn ──────────────────────────────────────────────────────────────────
  _spawnEnemyMonster(monsterDef, slotIdx) {
    const mesh  = monsterDef.make();
    const parts = monsterDef.collect(mesh);
    mesh.position.copy(this.FIELD_POSITIONS[slotIdx]);
    mesh.scale.set(0, 0, 0);
    // Face toward player (rotate 180° on Y if needed — check orientation vs player monsters)
    mesh.rotation.y = Math.PI;
    this.scene.add(mesh);
    this.enemyMeshes.push(mesh);

    // Scale-in animation (smoothstep 400ms)
    const t0 = performance.now();
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / 400);
      const s = p * p * (3 - 2 * p);
      mesh.scale.setScalar(s);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    // Register slot after visual starts
    this.enemyField[slotIdx] = {
      mesh,
      stats: monsterDef.stats,
      hp:    monsterDef.stats.hp,
      hasAttacked:      false,
      summoningSickness: true,
      parts,
    };
  }

  // ── Attack Player Monster ──────────────────────────────────────────────────
  _attackPlayerMonster(attackerSlotIdx, targetIdx) {
    const attacker = this.enemyField[attackerSlotIdx];
    const target   = this.playerField[targetIdx];
    if (!attacker || !target) return;
    attacker.hasAttacked = true;

    const reg = this.registryFor(attacker.mesh);
    const onHit = () => {
      target.hp    -= attacker.stats.atk;
      attacker.hp  -= target.stats.atk;

      if (target.hp <= 0) {
        this.destroyMonster(target.mesh);
        this.playerField[targetIdx] = null;
      }
      if (attacker.hp <= 0) {
        this.destroyMonster(attacker.mesh);
        this.enemyField[attackerSlotIdx] = null;
      }
    };

    // If animate*Attack accepts (mesh, parts, targetMesh, onHitCb) — use it
    // If it does not accept a callback, use setTimeout with 600ms (animation duration)
    if (reg?.attack) {
      try {
        reg.attack(attacker.mesh, attacker.parts, target.mesh, onHit);
      } catch {
        setTimeout(onHit, 600);
      }
    } else {
      setTimeout(onHit, 600);
    }
  }

  // ── Attack Player Hero ─────────────────────────────────────────────────────
  _attackPlayerHero(attackerSlotIdx) {
    const attacker = this.enemyField[attackerSlotIdx];
    if (!attacker) return;
    attacker.hasAttacked = true;
    const newHP = this.getPlayerHP() - attacker.stats.atk;
    this.setPlayerHP(newHP);
    if (newHP <= 0) this.onGameOver('enemy');
  }

  // ── Execute Turn ───────────────────────────────────────────────────────────
  executeTurn(turnNumber, onComplete) {
    let delay = 0;

    // Phase 0: Resources + clear sickness
    this._startTurnResources(turnNumber);
    this._clearSummoningSickness();

    // Phase 1: Analyze
    const snap = this._makeSnap(turnNumber);
    this._computeAiMode(snap);

    // Lethal check
    const readyAttackers = this.enemyField.filter(
      e => e && !e.summoningSickness && !e.hasAttacked
    );
    const totalAtk = readyAttackers.reduce((s, e) => s + e.stats.atk, 0);
    const goingForLethal = totalAtk >= this.getPlayerHP();

    // Phase 2: Summon
    const freeSlots = this.enemyField
      .map((v, i) => (v === null ? i : -1))
      .filter(i => i >= 0);
    let summonsLeft = DIFFICULTY_MAX_SUMMONS[AI_DIFFICULTY];

    for (let si = 0; si < freeSlots.length && summonsLeft > 0; si++) {
      const slotIdx    = freeSlots[si];
      const affordable = MONSTER_POOL.filter(m => m.stats.cost <= this.enemyMana);
      if (!affordable.length) break;

      const scored = affordable.map(m => ({ m, score: this._scoreSummon(m.stats) }));
      scored.sort((a, b) => b.score - a.score);
      const pick = scored[0].m;

      // Deduct mana before the timeout so subsequent iterations see updated mana
      this.enemyMana -= pick.stats.cost;
      summonsLeft--;

      const capturedSlot = slotIdx;
      const capturedPick = pick;
      setTimeout(() => this._spawnEnemyMonster(capturedPick, capturedSlot), delay);
      delay += 700;
    }

    // Phase 3: Attack
    for (let i = 0; i < 5; i++) {
      const slot = this.enemyField[i];
      if (!slot || slot.summoningSickness || slot.hasAttacked) continue;

      const capturedIdx = i;
      setTimeout(() => {
        if (goingForLethal) {
          this._attackPlayerHero(capturedIdx);
          return;
        }
        const action = this._chooseBestAttackAction(capturedIdx);
        if (!action) return;
        if (action.targetIsHero) {
          this._attackPlayerHero(capturedIdx);
        } else {
          this._attackPlayerMonster(capturedIdx, action.targetIdx);
        }
      }, delay);
      delay += 950;
    }

    // Phase 4: End
    setTimeout(() => onComplete(), delay + 400);
  }
}
```

---

### `playerField` Tracking in arena.js

Add alongside `activeMonsters` (near line 258):
```js
const playerField = []; // { mesh, stats, hp } — parallel to activeMonsters
```

Wherever a player monster finishes spawning (the summon completion callback that pushes to
`activeMonsters`), also push:
```js
playerField.push({ mesh, stats: <stats from registry or stored on mesh>, hp: <stats.hp> });
```

In `destroyMonster(target)`: add splice to remove the matching entry from `playerField` by
checking `entry.mesh === target`.

**To get stats on a player mesh:** Store them at summon time with `mesh._stats = stats`, then
read `mesh._stats` in destroyMonster and when building the playerField entry.

---

### Enemy Field Positions

In `src/systems/enemy-ai.js`, `FIELD_POSITIONS` is an array of 5 `THREE.Vector3`. These must
mirror the player field slot positions exactly with the **Z axis negated**.

**opencode must:** read arena.js to find where player monsters are positioned (look for
`FieldSlot`, `PLAYER_POSITIONS`, or Vector3 literals near slot summon logic). Then define:
```js
// Example — replace with actual values found in arena.js:
export const ENEMY_FIELD_POSITIONS = [
  new THREE.Vector3(playerSlot0.x,  playerSlot0.y,  -playerSlot0.z),
  new THREE.Vector3(playerSlot1.x,  playerSlot1.y,  -playerSlot1.z),
  // ... slots 2–4
];
```
Pass this array into `EnemyAI.init()` as `ctx.enemyFieldPositions`.

---

### UI Elements (add to `index2.html`)

Inside the arena canvas container div, add:

```html
<!-- Turn indicator -->
<div id="turn-indicator" style="
  position:absolute; top:20px; left:50%; transform:translateX(-50%);
  padding:8px 20px; background:rgba(0,0,0,0.7); color:#fff;
  border-radius:20px; font-size:14px; z-index:100;
  font-family:'Segoe UI',sans-serif; pointer-events:none;
">Player Turn</div>

<!-- End Turn button -->
<button id="end-turn-btn" style="
  position:absolute; bottom:20px; right:20px;
  padding:12px 24px; background:#e74c3c; color:#fff;
  border:none; border-radius:8px; font-size:16px;
  cursor:pointer; z-index:100; font-family:'Segoe UI',sans-serif; font-weight:bold;
">End Turn</button>

<!-- Player HP -->
<div id="player-hp" style="
  position:absolute; bottom:20px; left:20px;
  padding:8px 16px; background:rgba(0,0,0,0.7); color:#2ecc71;
  border-radius:12px; font-size:16px; z-index:100;
  font-family:'Segoe UI',sans-serif; font-weight:bold;
">❤️ 20</div>

<!-- Enemy HP -->
<div id="enemy-hp" style="
  position:absolute; top:60px; left:20px;
  padding:8px 16px; background:rgba(0,0,0,0.7); color:#e74c3c;
  border-radius:12px; font-size:16px; z-index:100;
  font-family:'Segoe UI',sans-serif; font-weight:bold;
">💀 20</div>

<!-- Game Over overlay (hidden by default) -->
<div id="gameover-overlay" style="
  display:none; position:absolute; inset:0;
  background:rgba(0,0,0,0.8); color:#fff;
  flex-direction:column; align-items:center; justify-content:center;
  z-index:200; font-family:'Segoe UI',sans-serif;
">
  <div id="gameover-text" style="font-size:48px; font-weight:bold; margin-bottom:24px;"></div>
  <button onclick="location.reload()" style="
    padding:12px 32px; background:#3498db; color:#fff;
    border:none; border-radius:8px; font-size:18px; cursor:pointer;
  ">Play Again</button>
</div>
```

---

### Wiring in arena.js (after scene initialisation)

```js
import { TurnManager } from './systems/turn-manager.js';
import { EnemyAI, ENEMY_FIELD_POSITIONS } from './systems/enemy-ai.js';

// ── HP state ──────────────────────────────────────────────────────────────────
let playerHP = 20;
let enemyHP  = 20;

function updateHPDisplay() {
  document.getElementById('player-hp').textContent = `❤️ ${playerHP}`;
  document.getElementById('enemy-hp').textContent  = `💀 ${enemyHP}`;
}

function triggerGameOver(winner) {
  const overlay = document.getElementById('gameover-overlay');
  const text    = document.getElementById('gameover-text');
  text.textContent      = winner === 'player' ? '🏆 You Win!' : '💀 Game Over';
  overlay.style.display = 'flex';
}

// ── Enemy AI ──────────────────────────────────────────────────────────────────
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
  indicator.textContent = isPlayer ? 'Player Turn' : 'Enemy Turn';
  btn.disabled          = !isPlayer;
  btn.style.opacity     = isPlayer ? '1' : '0.4';
};

document.getElementById('end-turn-btn').addEventListener('click', () => {
  turnManager.endPlayerTurn(enemyAI);
});
```

---

### Idle Animation Integration

In the arena render loop (where `activeMonsters` idles are called), add an identical block
for enemy monsters:

```js
enemyMeshes.forEach(m => {
  const reg = registryFor(m);
  if (reg && !m._attacking) reg.idle(m, t);
});
```

This already exists in arena.js (line ~420–423 for `enemyMeshes`) — verify it's present; if
not, add it.

---

## Tasks

### Batch 1 — Core Systems

1. **Create `src/systems/turn-manager.js`**
   Implement `TurnManager` exactly as specified above. Named export `TurnManager`.

2. **Create `src/systems/enemy-ai.js`**
   Implement the full `EnemyAI` class exactly as specified above. Named exports:
   `EnemyAI`, `AI_DIFFICULTY`.

3. **Define `ENEMY_FIELD_POSITIONS` in `src/systems/enemy-ai.js`**
   Read arena.js to find player field slot positions. Mirror them with Z negated.
   Export `ENEMY_FIELD_POSITIONS` as a named export.

4. **Add `playerField` array and `playerHP`/`enemyHP` to `src/arena.js`**
   - Add `const playerField = [];` near line 258 alongside `activeMonsters`
   - Add `let playerHP = 20, enemyHP = 20;` near the same area
   - In the player summon completion callback: store `mesh._stats = stats` and push
     `{ mesh, stats, hp: stats.hp }` into `playerField`
   - In `destroyMonster(target)`: splice matching entry from `playerField`
     (`entry.mesh === target`)

### Batch 2 — UI + Wiring

5. **Add UI elements to `index2.html`**
   Add all 5 HTML elements specified in "UI Elements" inside the canvas container div:
   `#turn-indicator`, `#end-turn-btn`, `#player-hp`, `#enemy-hp`, `#gameover-overlay`.

6. **Wire `TurnManager` and `EnemyAI` into `src/arena.js`**
   Add all wiring code from "Wiring in arena.js" section after scene initialisation.
   Import both classes at the top of arena.js.

7. **Verify idle animation loop covers `enemyMeshes`**
   Check arena.js render loop (line ~420). If the `enemyMeshes.forEach idle` block already
   exists, leave it. If not, add it after the `activeMonsters` idle block.

### Batch 3 — Combat + Game Over

8. **Test and fix attack animation callback**
   If `animate*Attack()` functions do not accept a hit callback (4th argument), the
   `_attackPlayerMonster` try/catch fallback to `setTimeout(onHit, 600)` will fire instead.
   Verify by checking one monster file (e.g. `fire-drake.js`). If the callback is not
   supported, remove the try/catch and use only the setTimeout path with a comment explaining
   why.

9. **Implement `updateHPDisplay()` + game over in `src/arena.js`**
   Ensure `updateHPDisplay()` is called after any HP change. Ensure `triggerGameOver()`
   shows the overlay and stops further turn processing.

10. **Confirm `enemyHP` is decremented when player attacks enemy monsters/hero**
    Check existing player-attack logic in arena.js. If there is already a path where player
    monsters attack the enemy hero, wire it to call `setEnemyHP(enemyHP - dmg)` and check
    for game over. If no such path exists, note it clearly in the review report.

---

## Out of Scope
- Do NOT touch `game.js` — the 2D card game is completely separate
- Do NOT add card abilities (charge/taunt/heal) to arena AI — raw atk/hp stats only
- Do NOT add multiplayer, networking, or server logic
- Do NOT add new monster types or change existing monster factory functions
- Do NOT add sound effects beyond what already exists
- Do NOT add player-side turn restrictions (player attacks freely on their turn as before)
- Do NOT split EnemyAI into more than one file

---

## Acceptance Criteria

**Batch 1:**
- `src/systems/turn-manager.js` and `src/systems/enemy-ai.js` exist and have no syntax errors
- `ENEMY_FIELD_POSITIONS` exports 5 `THREE.Vector3` values mirroring player slots
- `playerField` populates when player summons a monster; entry is removed on `destroyMonster`

**Batch 2:**
- `#end-turn-btn` appears bottom-right; becomes disabled (opacity 0.4) during enemy turn
- `#turn-indicator` switches "Player Turn" ↔ "Enemy Turn" correctly
- Enemy AI begins 500ms after "End Turn" is clicked
- Enemy monsters appear on the far side of the arena with scale-in animation

**Batch 3:**
- Enemy monsters execute attack animation against player monsters
- Mutual damage applied; dead monsters removed via `destroyMonster()`
- `#player-hp` and `#enemy-hp` update live
- Player HP → 0: `#gameover-overlay` shows "Game Over"
- Enemy HP → 0: `#gameover-overlay` shows "You Win!"

---

## Flag for Review
- If `registryFor(mesh)` does not expose stats (only animation functions), note it —
  the plan uses `mesh._stats` as the fallback; confirm that is set correctly at summon time.
- If `animate*Attack()` in any monster file does not accept a 4th hit-callback argument,
  use the `setTimeout(onHit, 600)` path and flag which monsters are affected.
- If player slot positions in arena.js are not static Vector3 literals (e.g. computed
  per-frame by FieldSlot), report the exact mechanism so enemy mirror positions can be
  recalculated correctly.
- If `destroyMonster()` already handles `playerField` cleanup through a different mechanism,
  note it — do not add duplicate splice logic.
- Taunt (from game.js) does not exist in the arena. Do not implement it.

---

## opencode Handoff Prompts

### Batch 1
```
Execute tasks 1–4 in @docs/plan-enemy-ai-turn-system.md. Stop after task 4 and report:
- Where player field positions were found in arena.js and the exact enemy mirror values used
- Whether registryFor() exposes stats or only animation functions
- Whether the summon completion callback was identifiable and where playerField push was added
Flag anything uncertain instead of guessing.
```

### Batch 2
```
Execute tasks 5–7 in @docs/plan-enemy-ai-turn-system.md. Stop after task 7 and report:
- Which HTML file / div the UI elements were added to
- Whether the idle animation loop for enemyMeshes already existed or was added
Flag anything uncertain instead of guessing.
```

### Batch 3
```
Execute tasks 8–10 in @docs/plan-enemy-ai-turn-system.md. Stop after task 10 and report:
- Whether animate*Attack() accepts a hit-callback or the setTimeout fallback was used (and for which monsters)
- Whether any existing player-attack-hero path was found and wired to enemyHP
Flag anything uncertain instead of guessing.
```
