# Handoff — playtest readiness, end of 2026-09-20

Supersedes the **open-items lists** of `railroad-and-feed-race.md` and
`tv-feed-and-notifications.md`. Their diagnosis sections are still the best
account of *why* each bug existed and are not replaced — read them for
mechanism, read this for current state.

Four parallel tracks ran after those two were written. Everything below is
current against the working tree. **Nothing is committed** (this repo has no
commits at all — see §6) and **nothing has been applied to the hosted database**.

Verified independently at the end of the session, not just reported by the
agents that did the work: `npm run test:sql` → **81/81 green**,
`npm run build` → **passes**.

---

## 1. The headline: the patch both previous handoffs recommended was wrong

`railroad-and-feed-race.md` §4 proposed an ~8-line patch for `useTvFeed`, and
`tv-feed-and-notifications.md` independently agreed with it. It was written as
analysis only, never run. **It was run this session, verbatim, and it is
subtly wrong** — anyone who had applied it on trust would have shipped a new
visual defect in place of the old silent one.

It does achieve "exactly one feed per seq". But `useTvFeed` has **three
independent instances** (`BoardScreen`, `TvCenter`, `TvSide`), and the latter
two are handed the row the *reveal buffer is holding* (`shownGame`) while
`silent` is computed from the *raw* row. So with §4's patch the flag flips
false for those two the instant the live push lands — **while the dice are
still in the air**. Measured: the Chance card was dealt over a tumbling die for
**9 sampled frames**.

The fix as shipped therefore has a fourth piece of state that §4 did not
anticipate: `adopted`, the `game` **object** that carried `seen`. The rescue
additionally requires `game !== adopted`, i.e. a genuine new *delivery* rather
than a re-render in which `silent` merely changed. With the guard: 0 frames of
card-over-tumbling-dice. It also mirrors the phone more faithfully —
`useGameRoom`'s rescue fires on an `apply()` call (an arrival), and object
identity is the render-phase equivalent of that.

Second deviation from §4: `setShown(null)` on the `seq < seen` rewind. §4 leaves
a stale `shown` (say 42) behind after Host New Game, where it would sit in front
of the new room's first seqs and block the rescue there.

> **Sharp edge for whoever refactors next.** The rescue keys on `game` **object
> identity**. If a caller is ever changed to pass a freshly built object each
> render (`{...shownGame}` instead of `shownGame`), the guard silently degrades
> to §4's behaviour — still one feed per seq, but the card is dealt during the
> dice tumble again. The underlying mismatch (`TvCenter`/`TvSide` get the *held*
> row but a `silent` flag derived from the *raw* row) is pre-existing and is now
> contained inside `useTvFeed`, but it is still the trap.

**Observed, both directions.** 7 cases × 46 checks, 3 consecutive runs, plus a
clean run after the dev probe was removed. With the rescue disabled
(`NO_RESCUE=1`) cases A and F go red (12 checks) and the rest stay green — the
test can fail, and fails for the right reasons. Case A with the rescue off: **0
feeds in all three instances**, TV correct and completely mute — dice
materialising at rest, no card overlay, no pay FX, no fresh row. Case D (a real
`drop()` → `stepWhileDown` → `restore()`) stays **silent** with the fix on,
which is the documented intended behaviour and the thing most at risk from a
careless rescue.

Note for reproducing: the phone's `replyLag()` knob is **irrelevant on the TV**
— `boardAction` discards the RPC reply, so Realtime is the TV's only live
delivery path and `latency()` alone opens the window.

---

## 2. What else changed

### `CardFeedRow` retired — net −101 lines
`describeEvent`'s `card` case (`src/Client/EventView.jsx`) now takes an optional
`ev.cardAmount` and emits a badge, so the TV's card row goes through the shared
`EventRow` and the bespoke component plus ~110 lines of duplicated CSS are gone.
`events.module.css` gained one variable (`--ev-lines`, default `3`), and
`tvSide.module.css`'s `.evs` sets it to `2` — so the 2-line card clamp survives
without a second copy of the row's styling.

Two things worth knowing:

* **A latent bug was found and fixed as a side effect.** The old `CardFeedRow`
  badge was silently inheriting `zoom: 0.8` from the *connection badge* rule —
  both were `s.badge`, so they compiled to the same hashed class and
  `.ev .badge` never overrode `zoom`. Card badges had been rendering ~20%
  smaller than the money badges beside them all along (measured: 42–48px vs
  52px). They now match. Side effect: the label box loses 4–10px, which moves
  the `payEach` wrap point by one word. Still 2 lines, still nothing clipped.
* **The card badge is signed and coloured for everyone**, which departs from
  `EventView.jsx`'s own "someone else's money is a neutral badge" rule. That
  rule can afford to be neutral because direction lives in the collect/pay row's
  arrow and tone — folding that row away takes the direction with it, and a deck
  icon cannot say whether $250 arrived or left. On the TV `meFig` is `null`, so
  the neutral path would have regressed the previously signed-off `−250$`.

Bonus: the card row now joins the `nth-child` stagger (40/80ms) in
`events.module.css`. The deleted CSS had no stagger rules, so a card row landing
in slot 2 or 3 of a batch used to enter *un*staggered while everything around it
was offset. The enter beat is now observed rather than assumed — the shared
`evIn` keyframe, `currentTime` monotonic `0→320` across every rAF sample (a
replay would reset to 0; it never does), and zero animations under
`prefers-reduced-motion: reduce`.

### `nearest` Chance cards — mock parity + server coverage
The server always had both (`mono_deck` lines 450–453: `c4` nearest utility,
`c5` nearest railroad). The **mock did not**, so the branch had never been
exercised through any UI. Both are now in `CHANCE_DECK` at indices **7 and 8**,
**appended, not renumbered**, so every pre-existing index and every script
written against one still means what it did.

> **The mock deck and the server deck are NOT index-aligned.** `nearest` is 7/8
> in the mock and **3/4** in `mono_deck`, where the mock has moveTo-Start and
> payEach. The mock deck has always been a smaller, differently-ordered subset.
> Harmless while everything forces cards by index, but a random mock draw is not
> distributed like a real one. Always say which deck you mean.

One trap caught while mirroring, worth recording because it would have been
invisible: in `mono_rent`, `road_mult` **multiplies** the count-based rate
(line 251) but `util_mult` sits inside a `coalesce` and **replaces** the 4×/10×
choice (line 258). Scaling an existing 4× answer by 10 would have produced a
**40× rent bug**. The mock computes the utility case from scratch instead, and
the SQL test asserts `sum * 10`; perturbing it to `sum * 40` was confirmed to go
red.

Server side now has **10 new tests** (`supabase/tests/auction_trade.test.mjs`,
new section 6; the smoke section renumbered 6 → 7), all through real forced
rolls *and* a forced deck via `game_action('roll')` — no hand-built state, no
direct `mono_apply_card` call. The `setseed` trick was extended from two
`random()` draws to three (two dice + the card pick). Target arithmetic for all
3 Chance cells × both kinds, the wrap from 37 paying $200 once, railroad rent
50/100/200/400 by count, utility 10× against three different rolled sums, own
cell charging nothing, unowned target staying buyable, and insufficient funds →
**immediate bankruptcy to the creditor, no debt, no partial payment**. Three
assertions were perturbed and confirmed to go red.

---

## 3. Decisions closed — do not re-open these without new information

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Echo probe: should a refetch stamp `lastLiveEventAt`? | **No change** | A refetch proves HTTP works, not that the websocket does — which is the exact failure the probe exists to catch. Stamping it would make the probe unfalsifiable. The spurious-rebuild worry is already bounded twice: `onRealtime` resets `silentActions` on *any* arrival (`useGameRoom.js:232`), so reaching 3 needs three echoes that never arrive, not three late ones; and `canRebuild` also gates on `status === "live"` plus a 30s floor (lines 288–291). The probe's real collateral damage *was* the swallowed feed, and the `owed` rescue already removed that. |
| 2 | Merge a `moveTo` card's "Passing Start · $200" row into the card row? | **No — leave both rows** | The reported bug's events had `reason: 'card'` — money existing *only* because the card said so, on a row labelled "Card" that said nothing the card's row didn't. A Start credit is paid by a *board* rule, and its label carries information the card's sentence does not. Merging makes the feed inconsistent (passing Start costs a row when you rolled there, none when a card sent you), would be redundant with the card's own "Collect $200" text, and would desync `TvCenter`'s `cardAmount()`. Decisive detail: **the two `passGo` events in that log are byte-identical JSON**, distinguishable only by position relative to the `card` event — an ordering invariant the SQL never promises. |
| 3 | Move `passed` out of React state into the row? | **Deferred** | Needs a migration, which the owner applies to hosted Supabase by hand. The exposure it closes needs ~40 events in one turn and costs a re-offered BUY after a reload. Wrong week. |
| 4 | At 6 players a moving card's sentence is pushed off the 3-row feed by its own consequences | **Accept, change nothing** — *owner's decision* | See §4. |
| 5 | Git: commit the work? | **Yes — committed on a branch** (reversed later the same day) | Initially declined, then the owner asked for it. The work is now a series of commits on `playtest-prep-2026-09-20`, off `main`. See §6 and §10. |

---

## 4. Known, accepted, not a bug to fix

**At 6 players, a `nearest` card's own sentence never renders.** The draw emits
**6** describable rows in one seq (`roll · move · card · move · collect passGo ·
pay rent`; `land` is filtered by `describeEvent`). Newest-first against
`maxRowsFor(6) === 3`, the feed keeps Rent / Passing Start / destination, and the
card text ranks **4th**.

This is purely the cap, not a rendering fault: `scrollWidth === clientWidth ===
500` throughout (the crop fix holds), and the identical draw at 4 players
renders the card at 2 lines correctly. The cruelty is structural — `nearest` is
the one card whose consequences are *all* independently interesting, so it is
precisely the card that crowds itself out, and "what did Afo draw?" is the row
ranked last by recency.

**The owner has decided to accept this.** `TvCenter`'s centre overlay does deal
the card face with its full sentence during its own beat, so the room is told
what the card said — by the centre, not the feed. Do not change `maxRowsFor`:
the 3-row cap encodes an explicit priority ("players have priority over the
log"). If it is ever revisited, the cheapest option that does *not* touch the cap
is to rank the card row ahead of its own consequences within a seq.

---

## 5. Still NOT verified — the honest list

* **Nothing has run against real Supabase or real hardware.** Every finding in
  this document and both predecessors is headless Chromium against the mock plus
  pglite for the SQL. Both feed races are *by definition* real-latency bugs. A
  live playtest is still the only proof that matters, and it is the top
  remaining task.
* The pay-FX coins were not asserted individually (the selector was too
  fragile); the card overlay, dice tumble and fresh-row marker all hang off the
  same feed and were asserted.
* The feed race was tested only against roll+card batches, **not** against
  auction / trade / bankruptcy batches. The code path is identical (the feed is
  opaque to event types) but it is untested for those.
* `useTvFeed`'s `seq < seen` rewind is reachable only via Host New Game; a
  server-side `new_game` does not rewind (seq is monotonic), so that branch is
  near-dead code.
* 5-player TV layout (4 and 6 were covered).
* Server `nearest` gaps: the `target is null` no-op (unreachable without
  hand-crafting a board); doubles → `nearest` → follow-up roll; a `nearest` card
  drawn on a roll that *itself* wrapped Start, which would pay $200 twice in one
  action.
* `declinedHere` still reads `game.log`, capped server-side at 40 entries — see
  decision 3.

### Two rules divergences the table may argue about
1. **The utility `nearest` card does not re-throw the dice.** `mono_apply_card`
   reuses the `dice_sum` it was passed — the roll that landed you on Chance — so
   the charge is 10× that roll, not 10× a fresh one. Official Monopoly
   re-throws. This is deviation-by-design: the migration header (line 48)
   records it. Confirmed by execution (three different sums) and by the absence
   of any `random()` call in the branch.
2. The railroad double-rent *does* match Hasbro.

### Cosmetic, reported but not fixed
* `TvCenter.jsx`'s card footer badge reads `—` for a `nearest` card:
  `cardAmount()` only sums `reason` `card`/`repairs`, and a `nearest` card's
  money is `rent`/`passGo`. Consistent with `moveTo` and `goJail`, so judged
  intentional. Same family as decision 2.
* The phone deed ticket shows the *standing* rent, not the card's one-off — "4×
  roll RENT" while 10× was charged. Arguably right for a deed card, but
  confusable mid-card. `rentFor()` in `src/Hooks/rules.js` has no multiplier
  parameters at all, unlike `mono_rent`; it will need them if the client ever
  has to *predict* a `nearest` charge.
* A dead selector in `tvSide.module.css`
  (`.latest .evs > li > span[aria-hidden="true"]:not([style])`) matches nothing
  now that both row shapes nest spans inside `.evIn`. Harmless; left alone.

---

## 6. Git: there are TWO nested repos, and it is easy to look at the wrong one

This caused a wrong conclusion earlier in the session, recorded here so nobody
repeats it:

| repo root | state |
|---|---|
| `Web/Active Projects/Monopoly/monopoly/` | **the real project repo.** Branch `main`, full history, `origin/main` remote, a proper `.gitignore` (`.env`, `dist`, `node_modules` all ignored). |
| `Web/` | an outer repo with **no commits at all** and ~2230 untracked files — `.vscode`, `Done Projects`, `FrontEndGroup`, `References`, `Reserve Backups`, `Test`, a stray top-level `supabase/`, and `Новая папка`. |

Running `git log` or `git status` from `Active Projects/Monopoly` (one level
*above* `monopoly/`) hits the **outer** repo and makes it look as though the
project has no history whatsoever. It has plenty. Always `cd` into `monopoly/`
first, or pass `-C monopoly`.

The uncommitted tree was ~70 files / ~6100 insertions spanning several
sessions, none of it committed until now. It is being committed on branch
**`playtest-prep-2026-09-20`**, cut from `main`, so `main` is untouched and the
whole batch can be reviewed or discarded as one unit. See §10 for the commits.

A scratchpad snapshot of `src/`, `supabase/` and `handoff/` (197 files) was also
taken partway through this session at
`…/8b312aa2-5333-4ff1-8009-3eb0525d57f5/scratchpad/snapshot-123646/`. It is
mid-edit and session-scoped — irrelevant now that the work is in git, but noted
in case a later comparison is ever useful.

---

## 7. Files touched this session

| file | change |
|---|---|
| `src/Board/TvFeed.js` | the feed race: `shown` + `adopted` + the rescue branch |
| `src/Client/EventView.jsx` | `card` case takes `cardAmount` → badge; `· ±N$` appended to the SR sentence |
| `src/Client/events.module.css` | `-webkit-line-clamp: var(--ev-lines, 3)`; no rule added or removed |
| `src/Board/TvSide.jsx` | `CardFeedRow` deleted; fold stamped onto a copy of the card event; single `EventRow` with `wrap` |
| `src/Board/tvSide.module.css` | `CardFeedRow` block deleted (−106); `.evs` sets `--ev-lines: 2` |
| `src/dev/mockSupabase.js` | `nearest` cards at indices 7/8, `nearestOfKind`, `rentWithMults`, `land()` multiplier params |
| `src/dev/scenarios.js` | 4 new phone scenarios (`my-card-nearest-road`, `-road-wrap`, `-road-rent`, `-utility`) |
| `supabase/tests/auction_trade.test.mjs` | new section 6, 10 `nearest` tests; smoke renumbered 6 → 7 |
| `handoff/tv-feed-and-notifications.md` | card-index table corrected + mock/server misalignment warning |

**Not touched:** `supabase/migrations/**` (no migration needed and none written),
`src/Hooks/**`, `src/Board/BoardScreen.jsx`, `src/Board/TvCenter.jsx`,
`src/Board/BoardGrid.jsx`, `src/Client/ClientScreen.jsx`, `.env`.

---

## 8. How to reproduce

```
cd "D:/Projects/Hobby/Web/Active Projects/Monopoly/monopoly"
npm run dev:mock -- --port 3091 --strictPort
```
`npm run dev` WITHOUT `--mode mock` talks to the **real backend** — do not use it.

* TV: `http://127.0.0.1:3091/tv-harness.html?chrome=0&s=<scenario>`
* Phone: `http://127.0.0.1:3091/client-harness.html?chrome=0&s=<scenario>` @390×844

Knobs (`src/dev/mockSupabase.js`): `window.__mockConn.latency(ms)` — socket
delivery lag, **the one that opens the TV race**; `.replyLag(ms)` — RPC return
leg, phone only; `.drop()` / `.stepWhileDown(action, payload)` / `.restore()`;
`window.mockDev.forceNextRoll([d1,d2])`; and
`window.mockGameAction(room, 'roll', { playerId, __forceTarget, __forceCard })`.

Evidence and drivers from this session, in
`…/8b312aa2-5333-4ff1-8009-3eb0525d57f5/scratchpad/`:

* `tv/tv-race.mjs` — the 7-case feed-race harness. `NO_RESCUE=1` to watch it
  fail. `tv/race-before-fix.png` / `race-after-fix.png` are the same moment with
  and without.
* `tv/sweep.mjs` — 12-scenario TV regression sweep.
* `tvcardrow/` — true before/after frames for the `CardFeedRow` refactor (the
  pre-refactor files were reconstructed and swapped in, so both sides are the
  same harness the same minute), `anim/` for the enter-beat samples.
* `nr.mjs`, `matrix.mjs`, `buy.mjs` — the `nearest` target matrix and a real BUY
  press.

Playwright is vendored in the **previous** session's scratchpad at
`…/7a0b20df-f887-4be3-a248-d5c0d26a1158/scratchpad/conn/node_modules`, reached
by junction from this one. If that directory is ever cleaned up, reinstall it
before expecting any of these scripts to run.

> Vite HMR full-reloads caused by concurrent editing spoiled headless runs
> repeatedly. If you run agents in parallel again, have the driver detect a real
> reload with a `window` token — Playwright's `framenavigated` also fires for the
> board's own `replaceState`, so it is a false-positive detector here.

---

## 9. TODO, in priority order

1. **Play a real game against the hosted backend before the table starts.**
   Both feed races are real-latency bugs and everything here is mock-only. This
   is the only item that can still find something serious.
2. Watch specifically for: a card overlay or dice tumble that fails to play
   after a phone has been locked and unlocked mid-turn (the race, on real
   latency), and for the BUY offer appearing on a free property after a reload.
3. If the SQL gaps in §5 matter later, the `setseed`-plus-forced-deck helper in
   `auction_trade.test.mjs` section 6 makes doubles-into-`nearest` and
   double-$200 cheap to add.
4. Decide whether `TvCenter`'s `—` badge for `nearest`/`moveTo`/`goJail` cards
   should show the card's net effect (same family as decision 2).

---

## 10. The commits

Nineteen commits on `playtest-prep-2026-09-20`, cut from `main` at `12429e7`.
`main` is untouched; merge or discard the branch as one unit. Ordered so that
each commit's imports resolve against the one before it — six of them were
build-checked individually (the new-files commit, the six-player client, the
reconnect rewrite, the phone commit, the TV reconnect commit and the harness),
and the tip is verified at `81/81` tests with a passing build.

```
Hold the room together when the network wobbles      connection.js, ConnectionBadge
Seat six players and eight figures on the server     the migration (NOT yet applied)
Grow the room to six players and eight figures       rules/figures/login + 16 SVGs
Reconnect the room instead of waiting for Realtime   supabase.jsx, useGameRoom.js
Draw the die as a solid cube                         RollDice
Play the doubles and busted cues                     useSound
Draw the Minecraft mark as a glyph                   marks, Mark
Say jail in one voice and show the card you hold     format, Ticket, MineSheet
Open an event row that does not fit                  EventRow, EventView, GameSheet
Fix the buy offer and play the doubles run …         ClientScreen, screen.css, ActRow
Widen the board and grow the type on the tiles       Tile, fitName, tv.css, TvControls
Fit five and six players onto the board              TvTokens, TvAuction, TvPayFx
Show what each player holds as one slot per group    TvSide
Play the doubles run and the trip to jail …          TvCenter
Keep the TV correct and quiet when it reconnects     BoardScreen, BoardGrid, TvFeed
Preview six seats, jail and the nearest card …       mockSupabase, scenarios
Test six players, jail, railroads and the nearest …  auction_trade.test.mjs (35→81)
Update the status, readme and test plan              README, TESTING, LAUNCH_STATUS
Add the handoff notes …                              handoff/
```

Because whole files had to be staged (no hunk splitting was available), two
commits carry more than their subject says. `ClientScreen.jsx` and
`screen.module.css` each hold six to eight concerns, and `TvSide.jsx` holds the
holdings rework, the jail chips, the reconnect threading and the card fold. The
bodies say so where it matters.

### Loose ends found while reading the diffs, none of them fixed

These are pre-existing in the work as it was written and were committed as-is,
because folding fixes into "record what exists" would have misdescribed the
commits and added untested changes hours before a playtest.

* **The doubles haptics fire twice and the two tables disagree.**
  `ClientScreen.jsx` calls `navigator.vibrate(DICE_FX_VIBE[kind])` and then
  `sound.play(cue)`, and `useSound`'s `play` calls `navigator.vibrate` itself.
  `vibrate` cancels any running pattern, so the second wins and `DICE_FX_VIBE`
  is dead for `d1`/`d2`/`d3` — only `jail`, whose cue is null, uses it. The
  values conflict too (`d1 = [16]` against `doubles = [30,40,30]`). Pick one
  table and delete the other.
* `data-heat` on `ActRow.jsx:74` has no CSS selector anywhere. Dead markup.
* `MARK_VIEWBOX` in `marks.js` is an empty object; every mark resolves to the
  default box, so the whole per-mark-viewBox mechanism is unused scaffolding.
* `resyncNow` in `connection.js` is built and returned and has no caller.
* `TvSide.jsx`'s density comment (lines ~36-49) contradicts `baseDens` below it:
  it says five players start at `d1` and six at `d2`, the code says zero and one.
  It was written before `maxRowsFor` freed the space back. This is the one thing
  in the tree that is actively wrong rather than merely dead.
* `.d1` is a no-op step — densities 0/1/2 all give a 26px slot.
* `tvSide.module.css`'s `.badge` patches `ConnectionBadge` from the call site
  with `zoom: 0.8` and a colour override, because its Reconnect button came out
  white-on-white in dark mode. That is a live bug in the component being papered
  over, and `zoom` on a shared `.badge` class is exactly what made card badges
  render 20% small before.
* Two `setNotice` writers in `ClientScreen.jsx` can collide in one batch.
* `src/dev/tvHarness.jsx` still calls `useRealtimeUpdates(uuid, cb)` with no
  third argument, so the TV harness gets no resync callback. May be deliberate.
* Several comments cite "the report", meaning agent scratchpads that are not in
  the repo, and two in `src/dev/*` refer to files being "owned by another agent".
