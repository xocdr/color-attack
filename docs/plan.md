# Plan: Buff/Status Effect Card UI

## Goal
Add a status-effect system: monsters can have buffs/debuffs with name, icon, duration (in turns) and stack count. Each monster with active effects shows a small "status card" strip near its HP bar, which updates live as effects are applied, ticked down each turn, and expire. Hovering a status badge shows a detail tooltip (reusing the existing `#card-detail`-style popup pattern).

## Context
- Relevant files:
  - `src/arena.js` — main render loop (`animate()`, lines 538-634), HP bar creation/update for `activeMonsters` (lines 549-576) and `enemyMeshes` (lines 579-604), `resolveAttack()` (line 478), `destroyMonster()` (line 511).
  - `src/systems/turn-manager.js` — `TurnManager` class, fires `onTurnChange(state)` with states `'PLAYER_TURN'`, `'ENEMY_TURN_START'`, `'ENEMY_TURN'`.
  - `battle.html` and `index2.html` — both contain duplicate inline `<style>` blocks and duplicate HUD markup (`.player-hp-bar`, `.enemy-hp-bar`, `#card-detail`, `.cd-*` classes around lines 260-420). Both files must get the same CSS additions since there is no shared stylesheet.
  - No existing buff system. `monster.userData` currently only has `.hp`, `.maxHp`, `.atk`, `.monsterName`.
- Existing patterns to follow:
  - HP bars are plain `div`s created lazily, cached on `monster.userData._hpBar`, positioned every frame via `mesh.position.clone().project(camera)` → screen space. Status badges must follow this exact same per-frame projection pattern, cached on `monster.userData._statusBar`.
  - Card detail popup (`#card-detail`, `.cd-header`, `.cd-icon`, `.cd-name`, `.cd-rarity-line`, `.cd-effect`) is the existing "hover for detail" visual language — reuse its color/shape language (dark gradient bg, rarity-style colored border, small pill shapes) for the new badges/tooltip, but it does not need to reuse the exact same DOM element (that popup is wired to card hover, not monster hover).
  - No external CSS/JS framework; everything is vanilla DOM + inline `<style>` per HTML file.

## Data model & API design (do not deviate — this is the load-bearing decision)

Create `src/systems/buff-system.js` exporting:

```js
// Buff definition (static data, not per-instance)
// { id, name, icon, kind: 'buff' | 'debuff', description, maxStacks (default 1) }

export const BUFF_DEFS = {
  atk_up:    { id: 'atk_up',    name: 'Attack Up',    icon: '🗡️', kind: 'buff',   description: '+{value} ATK', maxStacks: 5 },
  atk_down:  { id: 'atk_down',  name: 'Weakened',     icon: '💢', kind: 'debuff', description: '-{value} ATK', maxStacks: 5 },
  shield:    { id: 'shield',    name: 'Shield',       icon: '🛡️', kind: 'buff',   description: 'Blocks next {value} dmg instances', maxStacks: 3 },
  burn:      { id: 'burn',      name: 'Burn',         icon: '🔥', kind: 'debuff', description: '{value} dmg per turn', maxStacks: 5 },
  stun:      { id: 'stun',      name: 'Stunned',      icon: '💫', kind: 'debuff', description: 'Skips next attack', maxStacks: 1 },
};

// applyBuff(monster, buffId, { duration = 1, value = 0, stacks = 1 })
//   - duration is in "player turns remaining" (decremented once per full turn cycle)
//   - if the monster already has this buffId, stacks are added (capped at maxStacks) and duration is refreshed to max(existing, new)
//   - stores active effects in monster.userData.buffs = [{ id, duration, value, stacks }]
export function applyBuff(monster, buffId, opts) { ... }

// removeBuff(monster, buffId) — removes it entirely regardless of stacks
export function removeBuff(monster, buffId) { ... }

// tickBuffs(monster) — called once per monster at the start of each PLAYER_TURN
//   (i.e. once per full round, not per individual turn-state change).
//   Decrements duration by 1, removes any buff whose duration reaches 0.
//   Returns array of buff ids that expired this tick (for potential future use — not required to be consumed by anything yet).
export function tickBuffs(monster) { ... }

// getBuffs(monster) — returns monster.userData.buffs ?? []
export function getBuffs(monster) { ... }
```

`monster.userData.buffs` is the single source of truth; do not duplicate state elsewhere.

## Integration points

1. **arena.js — monster init**: no change needed; `userData.buffs` is created lazily by `applyBuff`, and `getBuffs()` defaults to `[]`.

2. **arena.js — turn hook**: Find where `turnManager.onTurnChange` is wired (search `onTurnChange` in arena.js). Add a branch: when `state === 'PLAYER_TURN'`, call `tickBuffs(m)` for every monster in `[...activeMonsters, ...enemyMeshes]`, then re-render each monster's status badges (calling the same update function used in the render loop, see task 3).

3. **arena.js — render loop**: Inside both the `activeMonsters.forEach` block (~line 549) and the `enemyMeshes.forEach` block (~line 579), after the existing HP bar block, add a status-badge-strip update block:
   - Lazily create `monster.userData._statusBar` div (className `status-bar`), appended to `document.body`.
   - Position it using the same `wp.project(camera)` values already computed for the HP bar in that block, offset vertically so it sits directly above the HP bar (HP bar is already offset with `+ 80` for player, `+2.2` world-y for enemy — add the status bar ~18-20px further up in screen space, i.e. same `left`, `top` minus ~20px).
   - Rebuild its `innerHTML` from `getBuffs(m)`, each buff rendered as a small `.status-badge` span: icon + stack count superscript (if stacks > 1) + duration number. Skip DOM rebuild if the buffs array reference hasn't changed since last frame (cache a serialized signature on `monster.userData._statusSig` to avoid needless innerHTML churn) — do this as a simple perf guard, not a strict requirement.
   - If `getBuffs(m).length === 0`, hide the bar (`display: none`) instead of rendering an empty strip.
   - Add a `mouseenter`/`mouseleave` (or simpler: `title` attribute) on each `.status-badge` showing the buff's full name + description with `{value}` interpolated — a native `title` tooltip is sufficient, no need to build a custom popup element.

4. **arena.js — cleanup**: In `destroyMonster()` (line 511), add removal of `target.userData._statusBar` (mirroring the existing `_hpBar` cleanup at line 513): `if (target.userData._statusBar) { target.userData._statusBar.remove(); target.userData._statusBar = null; }`.

5. **CSS — battle.html and index2.html** (apply identically to both files, near the existing `.enemy-hp-bar`/`.player-hp-bar` rules around line 267-297):
   ```css
   .status-bar {
     position: fixed;
     pointer-events: none;
     z-index: 90;
     transform: translateX(-50%);
     display: flex;
     gap: 3px;
   }
   .status-badge {
     pointer-events: auto;
     display: inline-flex;
     align-items: center;
     gap: 2px;
     background: linear-gradient(160deg, #1e1e38 0%, #12122a 100%);
     border-radius: 8px;
     padding: 1px 5px;
     font-size: 0.62rem;
     font-weight: 700;
     white-space: nowrap;
   }
   .status-badge.buff   { border: 1px solid rgba(60,255,140,0.5);  color: #8effc4; box-shadow: 0 0 5px rgba(60,255,140,0.25); }
   .status-badge.debuff { border: 1px solid rgba(255,80,80,0.5);   color: #ff9a9a; box-shadow: 0 0 5px rgba(255,60,60,0.25); }
   .status-badge .stacks   { font-size: 0.55rem; opacity: 0.85; }
   .status-badge .duration { font-size: 0.55rem; opacity: 0.7; margin-left: 1px; }
   ```

6. **Import**: `src/arena.js` must `import { applyBuff, removeBuff, tickBuffs, getBuffs, BUFF_DEFS } from './systems/buff-system.js';` at the top with the other imports.

7. **Manual test hook (temporary, for verification only, keep it)**: expose `applyBuff`, `BUFF_DEFS`, `activeMonsters`, `enemyMeshes` on `window.__buffDebug = { applyBuff, BUFF_DEFS, activeMonsters, enemyMeshes }` near the bottom of arena.js so the buff UI can be manually exercised from the browser console (e.g. `__buffDebug.applyBuff(__buffDebug.activeMonsters[0], 'burn', {duration:3, value:2})`) without needing a real combat trigger to exist yet. Nothing else should wire buffs into actual combat logic (e.g. auto-applying burn/stun from specific monster attacks) — that is out of scope.

## Tasks
1. Create `src/systems/buff-system.js` implementing `BUFF_DEFS`, `applyBuff`, `removeBuff`, `tickBuffs`, `getBuffs` exactly per the API above.
2. In `src/arena.js`, add the import, wire `tickBuffs` into the `onTurnChange` handler for `'PLAYER_TURN'`, add the status-badge-strip creation/update logic inside both the `activeMonsters.forEach` and `enemyMeshes.forEach` blocks in `animate()`, add `_statusBar` cleanup in `destroyMonster()`, and add the `window.__buffDebug` hook.
3. Add the `.status-bar` / `.status-badge` CSS block to `battle.html`'s `<style>` section (near `.player-hp-bar`/`.enemy-hp-bar`).
4. Add the identical CSS block to `index2.html`'s `<style>` section in the same relative location.
5. Manually verify in a browser: load `battle.html`, open devtools console, run `__buffDebug.applyBuff(__buffDebug.activeMonsters[0], 'burn', {duration:3, value:2})` (spawn a monster first if `activeMonsters` is empty) and confirm a red-bordered badge with 🔥, stack/duration text appears above that monster's HP bar and follows it as the camera/monster moves. Also verify a buff (e.g. `atk_up`) renders with green styling, and that ending a player turn (via the existing "End Turn" UI control) decrements duration and the badge eventually disappears when it hits 0. Repeat the same check on `index2.html`.

## Out of scope
- Do not wire any real monster attack/ability to actually apply buffs automatically — that's future combat-design work, not this task.
- Do not touch `enemy-ai.js` decision logic beyond what's strictly needed (nothing should be needed).
- Do not build a custom hover-popup component; native `title` attribute tooltips are sufficient for this pass.
- Do not modify `src/monsters/*.js` stat/attack files.
- Do not add persistence/save-state for buffs across page reloads.

## Acceptance criteria
- `src/systems/buff-system.js` exists and exports the 5 functions/constants listed, matching the described behavior (stacking caps at `maxStacks`, duration refresh takes the max, `tickBuffs` decrements and removes expired).
- Status badges appear above both player and enemy monster HP bars, styled distinctly for buff vs debuff, and disappear when no buffs are active.
- Badges reposition correctly every frame following the monster (same projection technique as HP bars).
- Duration visibly ticks down once per player-turn cycle and the badge is removed from the DOM when a buff expires.
- No console errors when applying/removing buffs, destroying a monster with active buffs, or ending turns repeatedly.
- Both `battle.html` and `index2.html` have matching CSS and both work identically (test both).

## Flag for review
If `onTurnChange` wiring in `arena.js` isn't a single obvious call site (e.g. it's split across multiple listeners), note where you added the tick call and why, instead of guessing at duplicating it. If any existing code already uses `monster.userData.buffs` for something unrelated, stop and flag it instead of overwriting.
