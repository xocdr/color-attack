# Tasks 1–4 Completion Report

## Overview
Tasks 1–4 from `plan-enemy-ai-turn-system.md` are complete. This report documents what was done, all findings, and flags anything uncertain.

---

## Task 1 — `src/systems/turn-manager.js`
**Status: Created**

Exact implementation as specified in the plan. Class `TurnManager` with:
- `state` (default `'PLAYER_TURN'`)
- `turnNumber` (default `1`)
- `onTurnChange` callback
- `endPlayerTurn(enemyAI)` method with 500ms delay before triggering enemy turn

---

## Task 2 — `src/systems/enemy-ai.js` (base class)
**Status: Created**

Full `EnemyAI` class as specified. Named exports: `EnemyAI`, `AI_DIFFICULTY`.
All external dependencies injected via `init(ctx)`. Imports stats from all 5 monster files directly.

---

## Task 3 — `ENEMY_FIELD_POSITIONS` in `enemy-ai.js`
**Status: Defined**

### Player Position Source
Player field positions are **not** hardcoded Vector3 literals in `arena.js`. They are sourced dynamically:

`arena.js:112` → `mapManager.getSpawnPoints('player')` → active map's `getSpawnPoints()` → `MapInterface.js:50-56` → reads from `config.playerSpawns`

Both `SandArenaMap.js:102-105` and `DarkFantasyMap.js:34-37` define identical player spawn coordinates:
```
{ x: -5, y: 0, z: 4 }
{ x: -2, y: 0, z: 4 }
{ x:  1, y: 0, z: 4 }
{ x:  4, y: 0, z: 4 }
{ x:  7, y: 0, z: 4 }
```

### Enemy Mirror Values (Z negated)
Hardcoded in `enemy-ai.js:23-29`:
```js
export const ENEMY_FIELD_POSITIONS = [
  new THREE.Vector3(-5, 0, -4),
  new THREE.Vector3(-2, 0, -4),
  new THREE.Vector3( 1, 0, -4),
  new THREE.Vector3( 4, 0, -4),
  new THREE.Vector3( 7, 0, -4),
];
```

These mirror the player slots exactly (Z negated: +4 → -4) and match the `enemySpawns` in both map configs.

**⚠️ Flagged:** If new maps with different spawn coordinates are added, `ENEMY_FIELD_POSITIONS` must be manually updated — it will not adapt automatically.

---

## Task 4 — `playerField`, `playerHP`, `enemyHP` in `arena.js`
**Status: Modified**

### Additions in `arena.js`

| Addition | Location | Code |
|----------|----------|------|
| `playerField` array | `arena.js:122` | `const playerField = [];` |
| `playerHP` | `arena.js:123` | `let playerHP = 20;` |
| `enemyHP` | `arena.js:124` | `let enemyHP = 20;` |
| FieldSlot callback push | `arena.js:130-134` | `monster._stats = reg.stats; playerField.push(...)` |
| SummonSystem callback push | `arena.js:145-153` | `monster._stats = reg.stats; playerField.push(...)` |
| `destroyMonster` splice | `arena.js:397-398` | `playerField.findIndex(e => e.mesh === target); splice` |

### Two Summon Completion Callbacks Identified

1. **FieldSlot `onActive`** (`arena.js:129`) — currently **never triggered** in the active code path. The fieldSlots array is created but its `summon()` method is never called. Worth keeping for future-proofing.

2. **SummonSystem `onComplete`** (`arena.js:144`) — this is the **active callback** that fires on every card-drop summon. Both callbacks now include `playerField.push()` and store `monster._stats`.

### `registryFor()` — Exposes Stats
**Yes**, `registryFor(m)` at `arena.js:95-97` returns `m.userData.registry`, which is the full MONSTER_REGISTRY entry including `.stats`. The plan's `mesh._stats` fallback is also set at summon time in both callbacks.

---

## ⚠️ Flagged Uncertainties

1. **Map-config-driven positions**: Player spawn positions derive from the active map config, not hardcoded in arena.js. If future maps differ, `ENEMY_FIELD_POSITIONS` needs manual update.

2. **Monster stats mismatch**: The actual source files have different values from the plan's "Monster Stats" table:
   | Monster | Plan table (atk/hp) | Actual source (atk/hp) |
   |---------|--------------------|----------------------|
   | Blade Imp | 2 / 2 | 5 / 5 |
   | Fire Drake | 4 / 3 | 4 / 8 |
   | Bone Giant | 5 / 8 | 5 / 8 (matches) |
   Since `enemy-ai.js` imports from actual source files, the AI uses real values — correct behavior.

3. **`animate*Attack()` callback support**: Not yet verified (task 8). The try/catch in `_attackPlayerMonster` (enemy-ai.js:204-208) serves as fallback if attack functions don't accept a 4th hit-callback argument.

4. **`playerField` double-push risk**: If both FieldSlot and SummonSystem callbacks fire for the same monster (currently they don't — only SummonSystem is active), a duplicate entry would be pushed. `destroyMonster` splice by mesh reference handles cleanup, but duplicate entries would cause incorrect targeting.

---

## Files Summary

| File | Action | Lines changed/added |
|------|--------|---------------------|
| `src/systems/turn-manager.js` | Created | 22 lines |
| `src/systems/enemy-ai.js` | Created | 284 lines |
| `src/arena.js` | Modified | +8 lines (state), +7 lines (callbacks), +3 lines (destroyMonster) |
