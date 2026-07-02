---
name: opencode-delegate
description: Use this skill when a coding task involves a lot of repetitive execution work that would burn context if Claude did it directly, such as generating boilerplate, refactoring across many files, running/parsing logs, or applying the same change pattern repeatedly. Also trigger whenever the user says things like "delegate this to opencode", "let's plan and hand this off", "use the plan-delegate-review workflow", or asks how to split work between Claude and opencode/local models to save context. This skill has Claude write a self-contained plan file under docs/, hand execution to opencode, then review opencode's output and take over only the hard problems. Do NOT trigger this for small, one-off changes (a single file edit, a quick bug fix) where planning overhead exceeds just doing the task directly.
---

# Plan → Delegate → Review

## Why this exists

Claude is expensive context, not a general-purpose worker. Reading 100+ files, generating boilerplate, and re-reading it all back to review burns the context window on tasks that don't need reasoning. The valuable work Claude should spend context on is: deciding what to build, catching design mistakes early, and solving the specific problems that come up during execution.

opencode (a separate CLI coding agent, invoked by running `opencode`) can run the repetitive middle step: generating boilerplate, refactoring, executing the plan file by file. It doesn't need Claude's judgment for that, just clear instructions.

The workflow has three phases, each with a different job:

1. **Claude plans** — decide what to build, write it down as a plan opencode can execute without asking follow-up questions.
2. **opencode executes** — works through the plan mechanically.
3. **Claude reviews** — checks the output against the plan, fixes what's wrong, solves anything opencode flagged or got stuck on.

This only pays off when the execution step is genuinely repetitive or file-heavy. If a task is small enough that planning it out takes as long as just doing it, skip this workflow and do it directly.

## Step 0: Confirm opencode is available

Before using this workflow, check that opencode is installed and reachable:
```bash
opencode --version
```
If it's not installed, tell the user this skill needs opencode (https://opencode.ai) set up first, and stop here rather than trying to proceed without it. Don't assume it's already configured, every teammate's machine may differ.

## Step 1: Write the plan

Before writing the plan, make sure you (Claude) actually understand the codebase context needed — check the relevant files, existing patterns, and conventions first. The plan should reflect real decisions, not placeholders.

Write the plan to `docs/<task-name>.plan.md` (e.g. `docs/enemy-ai.plan.md`, `docs/invoice-export.plan.md`). Use a name specific enough that it's identifiable if the project ends up with multiple plans running or completed. This whole workflow keeps its paper trail in `docs/` — the plan, opencode's reports, and Claude's evaluations all live there so the user never has to hunt across tools for what happened.

The plan must be self-contained. opencode will likely run on a different, less context-aware model, so it can't ask clarifying questions the way Claude would. Anything ambiguous in the plan becomes either a wrong guess or a stalled task. Use this structure:

```markdown
# Plan: <short task name>

## Goal
One or two sentences: what should exist when this is done.

## Context
- Relevant files/directories: <paths>
- Existing patterns to follow: <e.g. "Resource conventions used in ExistingModuleResource.php">
- Stack/conventions: <the project's actual stack and conventions, pulled from the codebase, not assumed>

## Tasks
Numbered, concrete, in execution order. Each task should be something opencode
can do without needing a design decision — the decisions belong in this plan,
not left for opencode to make.
1. ...
2. ...
3. ...

## Out of scope
Explicitly list anything adjacent that should NOT be touched, to prevent
scope creep during execution.

## Acceptance criteria
How to know each task succeeded — tests pass, the project builds/runs clean,
output matches an existing pattern, a specific in-game behavior occurs, etc.
Use criteria that fit the actual project (web app, game, service), not a
generic checklist.

## Flag for review
Anything opencode is uncertain about should be noted in its own output
rather than guessed at. Tell it explicitly to do this in the handoff prompt.
```

Keep tasks granular enough that a wrong step is easy to spot in review, but don't over-specify implementation details that are genuinely mechanical (variable names, standard CRUD boilerplate, etc.) — that's exactly the part opencode should just handle.

## Step 2: Run opencode directly, in batches

Claude runs opencode itself via its bash tool — the user does not need to switch to a terminal. Don't hand off all tasks in one shot, even if the plan has a clean numbered list. Batch them (e.g. tasks 1-4, then 5-9) so each review happens against a diff small enough to actually check, and so any flagged uncertainty gets resolved before later tasks build on top of a guess.

Run opencode in non-interactive mode, in the `build` agent (not `plan` — that agent is read-only/analysis-only by design and will not write files), with output captured straight to the docs trail. **The filenames below are illustrative** — always substitute the actual plan file created in Step 1 and the actual batch's task numbers, never copy the example filename literally.

**Checkpoint before each batch.** Confirm the working tree is clean (`git status`) before running opencode, and if it isn't, commit or stash first so a bad batch can be cleanly reverted with `git checkout -- .` or `git reset --hard` without losing unrelated work. This matters more for subtle bad changes (a physics constant, a balance value, a race condition) that won't show up as a build failure and are easy to miss in review.

Report naming: `docs/<task-name>.report.md` if the whole plan runs in one shot, or `docs/<task-name>.report-<range>.md` (e.g. `.report-1-4.md`) if it's batched — batches must not share a filename, or the earlier batch's report gets overwritten and the trail is lost.

For a plan at `docs/enemy-ai.plan.md`, batching tasks 1-4:

```bash
opencode run --agent build "Execute tasks 1-4 in @docs/enemy-ai.plan.md. Stop after task 4. If you're uncertain about a decision, don't guess — note it clearly in your summary instead of silently picking an approach." > docs/enemy-ai.report-1-4.md
```
(add `--model <provider/model>` if a specific model/provider is wanted)

**Verify the report is real before trusting it.** Non-interactive `opencode run` has known reliability gaps — it can report a task as done without actually writing/editing the files, depending on version and permission presets. After the command finishes, run `git status` and `git diff --stat` and confirm files actually changed in a way consistent with the report. If the report claims work was done but nothing changed on disk, that's a failure to surface immediately, not something to pass through to the evaluation as a pass. If this happens, fall back to telling the user to run the batch interactively themselves (`opencode`, then `@docs/<task-name>.plan.md` inside the session) and paste the result back.

## Step 3: Read the report and evaluate, with a paper trail

Once the batch finishes, read the report file (Claude's own file read, no copy-paste needed) and write a matching evaluation file alongside it, e.g. `docs/enemy-ai.evaluation-1-4.md` next to `docs/enemy-ai.report-1-4.md` (or `docs/<task-name>.evaluation.md` next to `docs/<task-name>.report.md` if it ran unbatched). Review against the plan, not just against "does this look reasonable":

- **Coverage** — did every task in the batch get done? Anything skipped or partially done?
- **Scope** — did it touch anything listed as out of scope?
- **Correctness** — check against the actual diff (`git diff`), not just opencode's summary text. A summary can say "implemented X" while the code does something slightly different — the diff is the ground truth.
- **Convention fit** — does it match existing codebase patterns, or did it improvise its own?
- **Flags raised** — anything opencode explicitly said it was uncertain about gets resolved here, explicitly, before moving to the next batch. Don't let a flagged decision carry forward as "still open" into later tasks that depend on it. This is the highest-value part of the review, since it's exactly the judgment call this workflow was designed to preserve for Claude.

End the evaluation file with a clear "resolved decisions" section (what was flagged, what was decided, why) and a note on whether the plan file itself needs updating before the next batch runs. A stale plan is worse than no plan if opencode is still reading from it.

Fix what needs fixing directly, or write a short, targeted follow-up plan for opencode if the fix is itself repetitive (e.g. "apply this same correction across 12 more files"). If the batch is bad enough that reverting is cleaner than fixing forward, use the checkpoint from Step 2 (`git checkout -- .` or `git reset --hard` back to it) rather than manually undoing scattered changes. Don't fall back into doing the repetitive work yourself just because you're already looking at it — that defeats the point.

## Good candidates for delegation

- Generating boilerplate/scaffolding for new modules following an existing pattern in the codebase
- Refactors that repeat the same change across many files
- Parsing/summarizing logs
- Repetitive migration, seeder, or test-fixture work

## When NOT to delegate

- Small, one-off changes where writing the plan takes longer than doing the task
- Tasks with real design decisions embedded in the request (scoring/weighting logic, algorithm behavior, balance/tuning values, anything where "strategically," "intelligently," "appropriately," or "feels right" is doing real work). This applies whether the decision lives in code or in data (a balance table, a state machine config, an animation curve) — either way, put the actual values/logic into the plan file itself rather than leaving them as task bullets. Whichever model executes the plan will invent an interpretation for vague bullets, but it can't invent exact values you've already specified.
- Work centered on non-text assets (art, audio, models, scenes edited through an editor UI rather than a text file) — opencode operates on files it can read and write as text, so it's a poor fit for anything that isn't reachable that way. Still fine for the code/config layer around those assets (e.g. wiring up an already-exported asset, generating asset metadata).

File count spread across a task is often a better delegation signal than task complexity — a task touching 30 files in a repeatable pattern is a better fit than a "hard" task confined to 2 files.