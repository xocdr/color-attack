# Evaluation: Buff/Status Effect Card UI (all tasks)

## Coverage
All 5 tasks in `docs/plan.md` completed:
1. `src/systems/buff-system.js` created — matches the plan's API exactly (`BUFF_DEFS`, `applyBuff`, `removeBuff`, `tickBuffs`, `getBuffs`).
2. `src/arena.js` — import added, `tickBuffs` wired into `onTurnChange`'s `if (isPlayer)` branch (line 254-257), `updateStatusBar()` helper added and called from both `activeMonsters.forEach` and `enemyMeshes.forEach` in `animate()`, `_statusBar` cleanup added in `destroyMonster()`, `window.__buffDebug` hook added.
3/4. Identical `.status-bar`/`.status-badge` CSS added to both `battle.html` and `index2.html` at the same relative location.
5. Manual browser verification not run by opencode (expected — it's a manual step); left for the user or a follow-up `/verify` pass.

## Scope
No out-of-scope files touched for this feature. `game.js` and other pre-existing modified files (map/monster files) were already dirty before this task started (per initial `git status`) — unrelated to buff work.

## Correctness (verified against diff, not just opencode's summary)
- `applyBuff`: stacking capped at `def.maxStacks`, duration refreshed via `Math.max`, matches spec.
- `tickBuffs`: decrements duration, filters out `<= 0`, returns expired ids — matches spec.
- Render loop: status bar positioned using the same `wp.project(camera)` values as the HP bar, offset 20px above it, for both player and enemy monsters — consistent with existing HP-bar pattern.
- `_statusSig` caching avoids unnecessary `innerHTML` rebuilds — a reasonable perf guard per the plan's "not a strict requirement" language.
- `destroyMonster()` cleanup added right next to the existing `_hpBar` cleanup.
- `title` attribute used for tooltip text (name + description with `{value}` interpolated) — matches plan's "native title is sufficient" instruction.

## Convention fit
Matches existing code style: inline `<style>` blocks, vanilla DOM manipulation, lazy div creation cached on `userData`, per-frame screen-space projection identical to the HP bar technique.

## Flags raised
None — opencode reported no ambiguity, single onTurnChange call site as expected, no pre-existing `userData.buffs` usage collision.

## Resolved decisions
No open decisions to resolve; opencode followed the plan's design (data model, integration points, CSS) exactly with no deviation.

## Plan status
`docs/plan.md` does not need updates — it was executed in a single batch with no gaps.

## Outstanding
- Manual browser test (task 5) not yet performed. Suggested console command once a monster is on the field:
  `__buffDebug.applyBuff(__buffDebug.activeMonsters[0], 'burn', {duration:3, value:2})`
- Buffs are not yet triggered by any real combat action — by design (out of scope). Hooking specific monster abilities to `applyBuff` is future work.
