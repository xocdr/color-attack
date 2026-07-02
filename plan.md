# Plan: Yu-Gi-Oh!-Style AI Opponent

## Goal
Replace the hardcoded demo enemy monsters in `src/arena.js` with a clean slate,
and overhaul the enemy AI in `game.js` into a multi-phase, scoring-based strategic
AI (similar to Yu-Gi-Oh! opponent logic) with three difficulty levels.

---

## Context

- **Primary AI file:** `game.js` — contains all TCG state, turn logic, and current AI (`runEnemyAI`, lines ~501–727)
- **3D demo enemy field:** `src/arena.js` lines 193–213 — hardcoded `ENEMY_NAMES.forEach` block that statics clones all five monsters at `ENEMY_POSITIONS`. Remove this block entirely (keep `enemyMeshes` as an empty array so the click/attack wiring below it still compiles).
- **Card definitions:** `game.js` lines 18–41 — `CARD_DEFS`, abilities: `charge` (deal 2 dmg on play), `taunt` (forces target), `heal` (restore 3 HP on turn start)
- **Game constants:** `MAX_HP=20`, `MAX_MANA=10`, `MAX_SLOTS=5`, `MAX_HAND=7`, `MAX_LEVEL=3`
- **Turn structure already wired:** `startEnemyTurn()` calls `setTimeout(runEnemyAI, 500)` — the AI must fit inside `runEnemyAI()`.
- **Merge helpers exist:** `mergeEnemyCards(keepIdx, removeIdx)` and `mergeEnemyFromHand(handCard, fieldIdx)` — reuse them.
- **Combat helper exists:** `resolveAttack(atkIsPlayer, atkIdx, targetIsHero, tgtIdx)` — reuse it.
- **All AI actions must be delayed** with sequential `setTimeout` calls (delay counter pattern already in place), so animation frames don't overlap.

---

## Design Decisions

### Board Evaluation Scoring (`aiEvaluateBoard`)

Replace the current function with this exact scoring formula. All weights listed
are final — do not adjust them:

```
score = 0

// ── HP advantage ──────────────────────────────────────────────────────────────
hpDiff      = snap.enemyHP - snap.playerHP
hpWeight    = snap.enemyHP < 8 ? 4.5   // defensive urgency
            : snap.playerHP < 8 ? 1.5   // aggro opportunity
            : 2.5
score += hpDiff * hpWeight

// ── Enemy field power ─────────────────────────────────────────────────────────
score += ef.totalAtk  * 1.2
score += ef.totalDef  * 0.55
score += ef.levelSum  * 1.8            // levels above 1 count as +1.8 each
score += (ef.hasTaunt ? 3.5 : 0)
score += ef.healCount * 2.5

// ── Player threat (negative) ─────────────────────────────────────────────────
score -= pf.totalAtk  * 1.4
score -= (pf.hasTaunt ? 5.0 : 0)       // taunt on player field = high threat
score -= pf.healCount * 1.5

// ── Lethal danger detector ────────────────────────────────────────────────────
// If player total ATK can kill the AI hero next turn, penalise heavily
if (pf.totalAtk >= snap.enemyHP) score -= 12

// ── Lethal opportunity reward ─────────────────────────────────────────────────
// If AI total ATK can kill the player next turn, reward heavily
if (ef.totalAtk >= snap.playerHP) score += 15

// ── Hand / resource advantage ─────────────────────────────────────────────────
score += (snap.enemyHandLen - snap.playerHandLen) * 0.9

// ── Mana efficiency ───────────────────────────────────────────────────────────
score += snap.enemyManaUsed * 0.6      // reward spending mana productively
```

Where `ef` and `pf` are derived from the respective field arrays before calling
the function:
```js
function deriveFieldStats(field) {
  const cards = field.filter(Boolean);
  return {
    totalAtk:  cards.reduce((s, c) => s + c.attack,  0),
    totalDef:  cards.reduce((s, c) => s + c.defense, 0),
    levelSum:  cards.reduce((s, c) => s + (c.level - 1), 0),
    hasTaunt:  cards.some(c => c.ability === 'taunt'),
    healCount: cards.filter(c => c.ability === 'heal').length,
    count:     cards.length,
  };
}
```

Add `enemyManaUsed` to the snapshot: `enemyMaxMana - snap.enemyMana`.

---

### Threat Assessment (`aiThreatAssess`)

```js
function aiThreatAssess(card) {
  if (!card) return 0;
  let t = card.attack * 1.8 + card.defense * 0.4 + (card.level - 1) * 2.5;
  if (card.ability === 'charge') t += 5;
  if (card.ability === 'taunt')  t += 4;
  if (card.ability === 'heal')   t += 2.5;
  return t;
}
```

---

### Synergy Bonus (`aiGetSynergyBonus`)

```js
function aiGetSynergyBonus(card, snapEnemyField) {
  const field = snapEnemyField.filter(Boolean);
  let bonus = 0;
  const hasTaunt  = field.some(c => c.ability === 'taunt');
  const hasHeal   = field.some(c => c.ability === 'heal');
  const attackers = field.filter(c => c.attack >= 3).length;

  if (card.ability === 'heal'   && hasTaunt)    bonus += 6;  // heal+taunt = fortress
  if (card.ability === 'taunt'  && hasHeal)     bonus += 6;
  if (card.ability === 'charge' && attackers >= 2) bonus += 6; // charge amplified by board pressure
  if (card.ability === 'heal'   && field.length >= 3) bonus += 3; // wide board benefits from heal

  // Merge opportunity is the most valuable synergy
  const mergeTarget = field.find(c => c.id === card.id && c.level < MAX_LEVEL);
  if (mergeTarget) bonus += 10 + mergeTarget.level * 3; // higher merge = bigger bonus

  // Counter-strategy: player has taunt → reward high-ATK cards that trade through it
  const playerHasTaunt = playerField.some(c => c && c.ability === 'taunt');
  if (playerHasTaunt && card.attack >= 4) bonus += 4;

  return bonus * DIFFICULTY_COMBO_WEIGHT[AI_DIFFICULTY];
}
```

---

### Noise (`aiApplyNoise`)

```js
function aiApplyNoise(score) {
  if (AI_DIFFICULTY === 0) return score * (0.65 + Math.random() * 0.7); // ±35%
  if (AI_DIFFICULTY === 1) return score * (0.92 + Math.random() * 0.16); // ±8%
  return score; // advanced: deterministic
}
```

---

### Snapshot (`aiMakeSnap`)

```js
function aiMakeSnap() {
  return {
    enemyHP, playerHP,
    enemyMana, enemyMaxMana,
    enemyManaUsed: enemyMaxMana - enemyMana,
    enemyField:    [...enemyField],
    playerField:   [...playerField],
    enemyHandLen:  enemyHand.length,
    playerHandLen: playerHand.length,
  };
}
```

---

### Difficulty Level Constants

```js
const AI_DIFFICULTY = 1;  // 0=beginner, 1=normal, 2=advanced

const DIFFICULTY_COMBO_WEIGHT   = [0.0,  0.5,  1.0 ];
const DIFFICULTY_HOLD_THRESHOLD = [Infinity, -4, -1 ]; // skip attack if best score below this
const DIFFICULTY_MAX_PLAYS      = [1,    5,    5   ]; // max cards played per turn
const DIFFICULTY_MERGE_LIMIT    = [1,    2,    3   ]; // max merges per turn
const DIFFICULTY_ADAPTIVE       = [false, false, true]; // HP-based mode switching
```

---

### `runEnemyAI()` — Phase Logic

Replace the entire function with these phases. Keep the delay-counter pattern.

**Phase 0 — Adaptive Mode Detection (advanced only)**

At the start of `runEnemyAI`, compute a mode string used in later phases:

```js
let aiMode = 'balanced';
if (DIFFICULTY_ADAPTIVE[AI_DIFFICULTY]) {
  if (enemyHP < 8)      aiMode = 'defensive'; // protect the AI hero
  if (playerHP < 8)     aiMode = 'aggro';     // go for the kill
  if (turnNumber > 7 && enemyField.filter(Boolean).length >= 3) aiMode = 'control';
}
```

**Phase A — Lethal Check (before any other action)**

Before spending any delay slots, compute: if the AI can kill the player hero
this turn with cards already on the field (ignoring summoning sickness),
set `aiGoingForLethal = true`. This flag forces the battle phase to attack
hero-only with every available attacker, skipping all other scoring.

```js
const readyAttackers = enemyField.filter(c => c && !c.hasAttacked && !c.summoningSickness && c.attack > 0);
const totalLethalDmg = readyAttackers.reduce((s, c) => s + c.attack, 0);
const aiGoingForLethal = (totalLethalDmg >= playerHP);
```

**Phase B — Field-to-Field Merges**

Enumerate all `(i, j)` pairs where `enemyField[i].id === enemyField[j].id && level < MAX_LEVEL`.
Score each merge using `aiEvaluateBoard` on the projected board.
Sort descending by score (or random for beginner).
Execute up to `DIFFICULTY_MERGE_LIMIT[AI_DIFFICULTY]` merges, each at +800ms delay.

**Phase C — Hand-to-Field Merges**

Same approach: for each hand card that matches a field card of the same id and upgradeable level,
score the projected board, sort, execute up to `DIFFICULTY_MERGE_LIMIT[AI_DIFFICULTY]` merges.

Track `usedFieldSlots` set to prevent double-merging the same slot.

**Phase D — Summon Cards from Hand**

Loop up to `DIFFICULTY_MAX_PLAYS[AI_DIFFICULTY]` rounds.
Each round: build `playCandidates` from `enemyHand` cards affordable by current `enemyMana`.

Score = `aiEvaluateBoard(projected) + aiGetSynergyBonus(card, currentEnemyField)`, then `aiApplyNoise`.

Mode-based overrides (applied before sorting):
- `aiMode === 'defensive'`: add +8 to cards with `ability === 'taunt'` or `ability === 'heal'`
- `aiMode === 'aggro'`: add +6 to cards with `attack >= 4`; subtract 3 from taunt/heal cards
- `aiMode === 'control'`: add +4 to cards that match a field card for merge opportunity

Beginner: sort cheapest-cost-first. Normal/Advanced: sort by final score descending.
Play the best card. If no playable card remains, break.
Delay: +700ms per card played.

**Phase E — Battle Phase**

If `aiGoingForLethal` is true:
- Attack hero with every non-sick, non-attacked, non-zero-ATK card in sequence. Done.

Otherwise, for each slot `idx` 0–4:
1. If card is null, sick, already attacked, or has 0 ATK, skip.
2. Taunt override: if `playerField` has any `taunt` card, must attack it.
3. Score all possible actions:
   - Attack hero: `heroKills ? 1000 : card.attack * 1.8`
   - Attack each player field card: score formula below
4. Mode overrides:
   - `aiMode === 'defensive'`: set hero-attack score to -999 (don't go face when defending)
   - `aiMode === 'aggro'`: hero-attack score gets +5
5. Sort actions descending by score. Skip attack entirely if best score < `DIFFICULTY_HOLD_THRESHOLD[AI_DIFFICULTY]`.

**Card-vs-card attack score:**
```
kills    = target.defense <= card.attack
survives = card.defense   >  target.attack
score    = kills ? (aiThreatAssess(target) * 1.5) : 0
score   += survives ? 2 : -3              // risk/reward of the trade
score   += aiThreatAssess(target) * 0.4   // always worth softening a threat
score   -= kills && !survives ? 1 : 0     // kamikaze kill: slight penalty
```

Delay: +950ms per attacker.

**Phase F — End Turn**

After all delays: `setTimeout(() => { if (!gameOver) startPlayerTurn(); }, delay + 400)`.

---

## Tasks

1. **arena.js — clear enemy field**
   In `src/arena.js`, delete lines 193–213 (the `ENEMY_NAMES.forEach` block that spawns
   hardcoded enemy clones). Keep `const enemyMeshes = [];` so the click/attack wiring
   at line ~270 (`selectableObjects`) still compiles without errors.

2. **game.js — add `deriveFieldStats` helper**
   Insert `deriveFieldStats(field)` function (as specified above) near the AI section
   (after the `DIFFICULTY_*` constants, before `aiEvaluateBoard`).

3. **game.js — replace `aiEvaluateBoard`**
   Rewrite using the new formula with `deriveFieldStats`, `hpWeight` branching,
   lethal detector, lethal opportunity, and mana efficiency.
   Signature stays: `aiEvaluateBoard(snap)`.

4. **game.js — replace `aiThreatAssess`**
   Use the new weights listed above.

5. **game.js — replace `aiGetSynergyBonus`**
   Use the new formula (heal+taunt=6, merge bonus = 10 + level*3, counter-taunt bonus).

6. **game.js — replace `aiApplyNoise`**
   Use the new noise bands (±35% beginner, ±8% normal, 0% advanced).

7. **game.js — update `aiMakeSnap`**
   Add `enemyMaxMana` and `enemyManaUsed` fields.

8. **game.js — update difficulty constants**
   Replace the three `DIFFICULTY_*` consts with the five listed above:
   `DIFFICULTY_COMBO_WEIGHT`, `DIFFICULTY_HOLD_THRESHOLD`, `DIFFICULTY_MAX_PLAYS`,
   `DIFFICULTY_MERGE_LIMIT`, `DIFFICULTY_ADAPTIVE`.

9. **game.js — rewrite `runEnemyAI`**
   Implement the full 6-phase logic (adaptive mode, lethal check, field merges,
   hand merges, summon, battle, end turn) exactly as described in the Design Decisions
   section. Keep the delay counter pattern. Keep using `mergeEnemyCards`,
   `mergeEnemyFromHand`, `resolveAttack` helpers unchanged.

---

## Out of Scope
- Do NOT add new card types, abilities, or monsters.
- Do NOT change game.js draw logic, player input, or rendering code.
- Do NOT change arena.js beyond removing the hardcoded enemy spawn block.
- Do NOT add new files or split the AI into a module.
- Do NOT change the `AI_DIFFICULTY` default value (leave it at 1).

---

## Acceptance Criteria
- `src/arena.js` compiles without errors; `selectableObjects()` still works (just returns active player monsters).
- `runEnemyAI()` executes all 6 phases in the right order without syntax errors.
- Beginner AI plays at most 1 card per turn, uses random/cheapest ordering, and often skips good attacks.
- Normal AI plays multiple cards, merges up to 2x, and usually avoids bad trades.
- Advanced AI detects lethal, goes full aggro or full defense based on HP, and never uses noise.
- No changes to player-side logic, animations, or rendering.

## Flag for Review
- If the adaptive mode detection interacts badly with the taunt-override in battle phase (taunt must be respected even in aggro mode), note the conflict and leave taunt override as the higher priority.
- If the lethal check fires but summoning sickness blocks all attackers (0 ready), flag it — don't skip the normal battle phase in that case.
