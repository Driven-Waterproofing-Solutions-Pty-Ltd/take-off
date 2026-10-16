# Codex P2 review — full investigation (PR #2, 2026-06-18)

Codex posted 6 P2 review comments on PR #2 covering pre-existing code in
`take-off-web/apps/`. User directive: investigate, do not fix yet.

Method: 6 parallel investigation agents, one per bug. Each agent read the
flagged file end-to-end, traced callers, confirmed or refuted the claim with
code snippets and `path:line` markers. Output: per-bug markdown in this
directory.

## Verdict matrix — all 6 confirmed

| # | File | Bug | Verdict | $ impact | Frequency | Fix size |
|---|---|---|---|---|---|---|
| 1 | `apps/web/src/components/NewItemModal.tsx:205` | Volume template `depth` not unit-rebased on drop | ✅ confirmed | **high (3.28× overstatement)** | low-med | tiny (helper exists) |
| 2 | `apps/web/src/lib/agentTools.ts:144` | `get_page_image` ignores `viewport` and `dpi` schema inputs | ✅ confirmed | medium (vertex precision lost on big sheets) | **every multi-page takeoff** | medium (renderer extension) |
| 3 | `apps/worker/src/mcp/server.ts:51` | `snap_to_vector` MCP handler skips 2× cache scaling | ✅ confirmed | high *if MCP used* (2× geometry) | low today (MCP only) | small (extract helper) |
| 4 | `apps/worker/src/tools/items.ts:133` | Raw `updateItem`/`createItem` accept unvalidated `assembly_id` | ✅ confirmed | high (silent item drop from quote) | low (UI routes through applyAssembly) | tiny (mirror existing check) |
| 5 | `apps/worker/src/db/queries.ts:148` | Shape `INSERT OR IGNORE` swallows retry payload + hook trusts every 2xx | ✅ confirmed end-to-end | high (silent shape corruption) | rare-but-real (lost-response race) | medium (upsert + dual recalc + response shape) |
| 6 | `apps/worker/src/tools/memory.ts:193` | `applyAssembly` doesn't check unit-family compatibility | ✅ confirmed | high (silent quote misprice) | low (humans usually align units; **agents will not**) | small (family check, machinery exists) |

> Codex's diagnoses are accurate on every count. None were false positives.
> Several are corroborated by comments the team themselves wrote elsewhere in
> the codebase — bugs 1, 3, 4 all have explicit "this pattern fails because..."
> comments in sibling files that document the exact failure mode being
> re-introduced here.

## Cross-cutting patterns

**Pattern 1: Incomplete migration.** Bugs 1, 3, 4, 6 all share a structure:
"the fix was applied in path X but missed in sibling path Y."

- Bug 1: `scale.ts:180-191` cites the same 3.28× in its comment; `NewItemModal.tsx` was missed
- Bug 3: `tools/measure.ts:23` and `agentTools.ts:253` both wrap snap with 2× and warn "keep both in lockstep"; `mcp/server.ts` is the orphan
- Bug 4: `applyAssembly` validates; `updateItem`/`createItem` do not. The team even wrote a warning comment at `api.ts:318-327` telling agents not to use the raw path — half-fix.
- Bug 6: `getOrCreateItem` and `updateShape` enforce family/linear-base policy; `applyAssembly` doesn't.

→ The codebase has the right primitives. They're just not consistently wired.

**Pattern 2: Silent failures across the board.** All 6 bugs fail with no
toast, no log, no exception. The user sees a plausible-looking number that's
wrong. No telemetry on quote correctness exists. This is the bigger problem —
the bugs would have been caught months ago if there were post-quote
sanity-check invariants.

**Pattern 3: Schema ↔ implementation drift.** Bug 2 (schema declares
`viewport`/`dpi`, executor ignores them) and Bug 4 (schema warns about a path
that still exists) both reflect the same issue: the schema is the contract
the LLM/agent reads, and divergence silently misleads the agent without ever
throwing.

**Pattern 4: Direct $ impact.** 5 of 6 bugs affect quote totals or
measurement accuracy. The remaining one (bug 5) affects measurement
persistence — same downstream effect.

## Recommended fix order (when user gives go-ahead)

**Phase A — quick wins, ~1 hour, single PR or batched commits:**
1. **Bug 1** — `NewItemModal.tsx` template-drop: convert `depth` via existing `convertLinearUnit` helper when `rebasedUnit` changes
2. **Bug 4** — `items.ts` raw paths: mirror the `applyAssembly` existence check in `updateItem` + `createItem` (extract to one helper)
3. **Bug 6** — `applyAssembly`: add family/linear-base check using existing `getLinearBase` + a small `assemblyFamily` helper

All three are tiny diffs, leverage existing helpers, and reduce silent-failure
surface immediately. They share the same family of tests (unit validation).

**Phase B — sync correctness, ~2-3 hours, dedicated PR:**

4. **Bug 5** — `queries.ts` + `useShapeSync.ts`: swap `INSERT OR IGNORE` for `INSERT ... ON CONFLICT DO UPDATE`, double-recalc both source and destination item totals on reparent, have worker return re-SELECTed row so hook can detect divergence

Needs careful test coverage (lost-response race is hard to reproduce
naturally). Includes a Playwright E2E or a worker integration test that
simulates "commit succeeded, response lost, user mutated, retry arrives."

**Phase C — tool contracts, ~3-4 hours, design call first:**

5. **Bug 2** — `get_page_image`: policy decision required — honour `viewport`/`dpi` (recommended) or remove them from schema. Honouring needs renderer extension + return-contract update so the agent knows the crop's offset/scale.
6. **Bug 3** — extract `maybeSnap`'s scale wrapping into a shared helper, route both MCP handler (`server.ts:51`) and REST endpoint (`measurements.ts:66-70`) through it. Optionally simplify `agentTools.ts` to deduplicate.

Phase C is more surface area; if Copilot/MCP traffic is still low today, Phase
C can wait until Hermes's tool registration pass (consolidation plan §7.5) —
which will re-touch these tools anyway.

## Connection to the consolidation plan

This investigation surfaces several findings relevant to the broader cowork
consolidation:

- **Bug-class invariants belong in the W1 + W3 inventory pass.** The W3
  audit's "secrets-risk" file should be twinned with a "behavioural-invariants"
  file flagging silent-failure paths. The consolidation plan now mentions
  this; the Codex review independently validated the gap.
- **Hermes §7.7's "validation gates merges" point is well-motivated.** Three
  of the six bugs would have been caught by a smarter pre-merge invariant
  check on the schema↔executor and policy↔attach pairings.
- **Hermes skill loop could prevent Bug 6.** A learned skill "before
  attaching assembly X to item Y, check unit families match" is exactly the
  pattern §7.4 is designed to compound. Future Hermes work in this area
  should treat assembly-attach as a canonical seed skill.
- **Bug 2's schema/executor drift maps to the wider problem of stale
  agent contracts.** When the inventory pass touches `tool-schemas.ts`, also
  diff against actual executor reads — catches the same drift in any other
  tool.

## File index

- `bug1-volume-depth.md` — confirmed, ~3.28× overstatement on cross-unit volume templates
- `bug2-viewport-dpi.md` — confirmed, large-sheet detail unreadable, schema/executor drift
- `bug3-snap-scaling.md` — confirmed, MCP handler bypasses 2× cache scaling (+ identical bug in REST endpoint, accidentally safe)
- `bug4-assembly-id.md` — confirmed, raw item-write paths skip the validation `applyAssembly` performs
- `bug5-shape-upsert.md` — confirmed end-to-end, silent shape corruption on lost-response race
- `bug6-assembly-units.md` — confirmed, assembly attach skips unit-family check that exists elsewhere in the codebase

Each file follows the same structure: VERDICT / EVIDENCE (with `path:line`
snippets) / BLAST RADIUS / ROOT CAUSE / FIX SKETCH / TEST PLAN.

## What's pending

User said "hold on, we have other agents working." This investigation report
is the deliverable. Fixes are NOT pushed.

Next steps require user direction:

1. Approve Phase A (bugs 1, 4, 6) for immediate fix — small, contained
2. Approve / defer Phase B (bug 5) — needs test-coverage care
3. Make a policy call on Phase C bug 2 (honour vs remove `viewport`/`dpi`)
4. Decide whether to coordinate with the other agents already in flight (to
   avoid merge conflicts on the same files) before any of Phase A lands

GitHub PR thread: each bug already has a Codex comment — once fixes land,
push the commit and the threads auto-resolve. Investigation files in this
directory can be referenced inline for any thread that needs more context.
