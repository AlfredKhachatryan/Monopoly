# TV feed / duplicate-notification bug — handoff

Written for a fresh agent with zero context, before the first playtest. Scope
was `src/Board/*` only; `src/Client/*`, `src/Hooks/rules.js`, `src/dev/*`,
`supabase/*` belong to a concurrent agent working an unrelated bug.

> **SUPERSEDED IN PART — read `playtest-readiness-2026-09-20.md` first.**
> The diagnosis below still stands. But all three "Remaining TODOs" are now
> closed there: the resync race is **fixed** (and the patch the cross-agent note
> pointed at turned out to be subtly wrong — see that document's §1), the
> `moveTo`+Passing Start merge was **decided against** with reasons, and
> `CardFeedRow` has been **retired** in favour of a badge slot on
> `describeEvent`'s `card` case, so the parts of "Report 1" and "Report 2" that
> describe `CardFeedRow` and its CSS no longer describe the code.

## The owner's three reports (verbatim)

1. "When I'm getting Chance I'm getting 2 notifications on the TV, I need
   only 1."
2. The right column's "LATEST" feed rows are cropped on the right edge on the
   TV (amount chips sliced, a dice chip showing half its number, a long card
   sentence running off the box with no ellipsis).
3. With 5–6 players the log must be shorter, because players have priority
   over it — at 6 players at most 3 feed rows (2 acceptable), at 5 at most 4,
   only grow the feed past that when ≤4 players and there is spare room.

## Report 1 — duplicate card notification

**Root cause (confirmed, not a hypothesis).** A card draw is TWO events in
the server's log, not one:

- `supabase/migrations/20260918140000_game_rules.sql`, function `mono_land`
  (starts line 628): line 672-674 pushes `{'type':'card', figure, deck, id,
  text}`, then line 678 calls `mono_apply_card` (starts line 529), which for
  a `collect`/`pay`/`repairs`/`payEach`/`collectEach` card pushes its OWN
  `collect`/`pay` event (reason `'card'` or `'repairs'`) — SAME `seq` as the
  card event (the whole action is one `game_action` call; every event of it
  gets the same seq stamped in `supabase/migrations/20260918160000_game_log.sql`
  around line 474).
- The mock mirrors this exactly: `src/dev/mockSupabase.js`, `land()`
  (~line 576) pushes the `card` event then calls `applyCard()`
  (~line 520s), which pushes its own money event. No mock/SQL mismatch —
  verified by reading both side by side.
- `src/Client/EventView.jsx`'s `describeEvent()` gives BOTH events a valid
  row (the `card` case ~line 148, the `collect`/`pay` cases ~line 109/121).
  `src/Board/TvSide.jsx`'s "Latest" list mapped every describable event to a
  row with no de-duplication, so one card draw produced two rows: a bare
  "Card · 10$" row and, right under it, the card's full sentence. This is
  what the owner saw as "2 notifications" — the centre overlay (`TvCenter.jsx`)
  was already correct (one card face, one beat); the duplicate was in the
  right-column feed.

**Real server event order for one card landing** (confirmed from the SQL,
matches the mock):
```
roll → move → land → card → [collect|pay (reason:card|repairs), possibly N of them for payEach/collectEach] → [jail, if goJail]
```
All of the above share one `seq`. `land` itself is filtered out by
`describeEvent`'s default case (returns `null` for `land`/`turn`/`skip`), so
it was never part of the duplicate.

**What I changed (state: DONE, build passes, verified).**
`src/Board/TvSide.jsx`, `rowsData` (`useMemo`, ~line 460-540):
- Added a forward scan from each `card` event (same logic as `TvCenter.jsx`'s
  existing `cardAmount()` helper, ~line 82-94): walks events with the SAME
  `seq` until the next `card` or a different seq, and for `collect`/`pay`
  events matching the card's figure with reason `card`/`repairs` (or a `pay`
  TO the card's figure with reason `card`, for `collectEach`), adds the
  signed amount to a running total and marks that event's index `consumed`.
- The main row-building loop now skips `consumed` indices, and stores the
  computed total as `cardAmount` on the card's own row entry.
- New `CardFeedRow` component (~line 366-403 in `TvSide.jsx`) renders the
  card's row by hand (icon, actor token, sentence, optional amount badge) —
  NOT through the shared `EventRow`, because `describeEvent`'s `card` case
  has no badge slot and `EventView.jsx` isn't mine to touch today. Its label
  wraps to 2 lines with a CSS line-clamp instead of one nowrap+ellipsis line.
- The render map (`shown.map(...)`) picks `CardFeedRow` for `ev.type ===
  'card'`, `EventRow` for everything else.

**Verified**: before/after frame sequences in the scratchpad (see
"Reproduce" below) — `before-chance-3000.png` shows both rows for one
Chance draw; `after-chance-6000.png` shows one row with a `+50$` badge. Also
re-verified for: a plain pay card, a `moveTo` card ("Advance to Старт"), a
go-to-jail card, and a Community Chest pay card — all single-row. One
borderline case left as-is: a `moveTo` card that also passes/lands on Start
gets an extra "Passing Start · $200" row, because that credit's `reason` is
`passGo`, not `card` — a different code path from the reported bug, and
arguably a second real fact, but flagged in case the owner still calls it a
duplicate.

## Report 2 — right column cropped on the right edge

**Root cause (confirmed).** `src/Board/tvSide.module.css`, `.evs` (the
`<ul>` around the Latest rows) was `display: grid` with NO
`grid-template-columns`. A grid container with no explicit column template
gets one implicit column sized `auto`, and `auto` tracks size to the widest
item's max-content contribution — NOT to the space actually available.
`EventRow`'s `.evName` (`src/Client/events.module.css`) is
`white-space: nowrap`, and its unwrapped sentence width counts toward that
max-content contribution even though `overflow: hidden` /
`text-overflow: ellipsis` are also set on it (those clip what PAINTS once a
box is already sized smaller; they do not shrink the box's own contribution
to an ancestor's track sizing). The longest card sentence ("You have won
second prize in a beauty contest...") blew `.evs`'s one column past the
500px right column; `.latest`'s own `overflow: hidden` (one level up) then
CROPPED every row along that stretched edge instead of reflowing it — which
is exactly "all rows are cropped" from a single long row.

**What I changed (state: DONE, build passes, verified).**
`src/Board/tvSide.module.css`:
- `.evs` (~line 486-509): added `grid-template-columns: minmax(0, 1fr);`,
  pinning the column to the space `.latest` actually has. Also added
  `min-width: 0` to `.latest .evs > li`.
- `.players` (~line 159-168): same fix, defensively (per the coordinator's
  ask re: long Cyrillic names / 5-digit cash figures) — it had no clipping
  ancestor so it would have bled rather than cropped, but the underlying
  "auto column sizes to content" mechanism is identical.
- New `CardFeedRow` CSS (`.ev`/`.evIn`/`.evIc`/`.evName`/`.badge`/`.pos`/
  `.neg`/`.isNew`/`.sr`, ~line 519-620) — `.evName` there uses
  `-webkit-line-clamp: 2` (2 lines then clip) instead of the shared
  `EventRow`'s one-line nowrap ellipsis, satisfying "card text wraps to at
  most 2 lines with a clean ellipsis instead of running off." Other
  (non-card) rows still use the shared `EventRow`/`events.module.css`
  single-line ellipsis, which now works correctly once the grid track can
  no longer stretch past the column.

**Verified**: `six-players-1920.png` and `six-players-1878x923.png` (the
owner's own window size) — long names/cash render with clean ellipsis, not
stretched. `after-six-long-6000.png` — a full `payEach` sentence ("You have
been elected chairman of the board...") at 6 players wraps to exactly 2
lines with a `-250$` badge fully visible, nothing cropped.

## Report 3 — players outrank the log at 5–6 players

**State: DONE, build passes, verified.**
`src/Board/TvSide.jsx`:
- New `maxRowsFor(n)` (~line 102): `3` at ≥6 players, `4` at 5, unchanged
  `MAX_ROWS` (8) at ≤4.
- The measured-squeeze layout effect (~line 512-530) now clamps the fitted
  row count to `cap = maxRowsFor(n)` instead of the flat `MAX_ROWS`, so a
  crowded room's feed never grows past its cap even when the measured
  height would allow more.
- `baseDens` (~line 115) recomputed for the new, smaller feed budget: 6
  players now starts at `d1` instead of `d2` (`d0`/`d1` are visually
  identical — same 56px token, same padding; only the inter-card gap
  differs by 2px), 5 and below stay at `d0`. The MEASURED squeeze below is
  unchanged as the safety net if a real board's holdings still need more
  compression — the "dens only ever increases within one dataset" invariant
  the file already documented is untouched, only where it STARTS from.

**Verified**: `six-players-1920.png` — 6 players, cards render at full
(un-squeezed) size, Latest capped to 3 rows. `after-six-long-6000.png` —
same, with a 2-line card row present and cards still full-size (spare pixels
went to the player cards, not the feed, per the ask).

## A bug I found while tracing report 1 (not asked for, fixed anyway)

`src/Board/TvCenter.jsx` and `src/Board/TvSide.jsx` each ran their own
`useTvFeed(game)` (`src/Board/TvFeed.js`) with NO `silent` argument, even
though the hook and `BoardScreen.jsx`'s own top-level call already support
one. `game`/`shownGame` snaps straight through on a resync (there's no roll
to hold it behind), so a resync that jumped the seq forward — e.g. the TV
reconnecting after other players acted while it was offline — was read by
TvCenter/TvSide as a brand-new LIVE batch: the card overlay / jail beat /
trade-end banner would replay for something that happened while the screen
was disconnected. `TvCash` (inside `TvSide.jsx`) had the matching problem
for money: it animates a count-up/delta chip on ANY value change with no
idea a resync is happening, so a resync also popped a "+250$" chip out of
nowhere.

**Fixed (state: DONE, build passes, verified)**:
- `src/Board/BoardScreen.jsx` (~line 362, 373): passes its already-computed
  `silent` to both `<BoardGrid>` and `<TvSide>`.
- `src/Board/BoardGrid.jsx` (~line 36, 113): accepts `silent` and forwards
  it to `<TvCenter>`.
- `src/Board/TvCenter.jsx` (~line 206, 208): accepts `silent = false`, calls
  `useTvFeed(game, silent)`.
- `src/Board/TvSide.jsx`: accepts `silent = false`, calls
  `useTvFeed(game, silent)`; `TvCash` (~line 252-311) gained a `silent`
  branch that snaps the number with no count-up/delta chip/wash.

**Verified** with `window.__mockConn.drop()` → `stepWhileDown('roll', ...)`
→ `restore()` (see Reproduce below): before this fix the resync popped a
"+250$" delta chip; after, money/position snap silently, no card, no chip.
Doubles chip / auction panel / trade panel are driven directly by persistent
`game.doubles` / `game.auction` / `game.trade` fields, not by the feed, so
they were never at risk — confirmed they still reflect current truth
through a resync (a room genuinely mid-doubles should still say so).

## Cross-agent note: possible same-shape race in useGameRoom

Another agent reported `useGameRoom` (phone) can swallow a live feed when a
silent refetch for seq N lands before the realtime event for seq N. **I
traced the equivalent path on the TV side and I believe it has the same
race, though I have not reproduced it live** (ran out of time; this is
analysis, not an observed failure):

`src/Board/BoardScreen.jsx`, `updatePos()` (~line 178-192): if a silent
resync fetch for seq N (`fromResync=true`) is applied BEFORE the realtime
push for that same seq N arrives, `updatePos` sets `silentSeq = N` on the
first call. `TvFeed.js`'s `useTvFeed` then advances its internal `seen` to N
under `silent=true` (no `setFeed`). When the realtime push for the SAME seq
N lands moments later (`fromResync=false`), `updatePos` runs again with
`next === seqRef.current` (not less-than, so it's not rejected) and sets
`silentSeq = -1` — but by then `useTvFeed`'s own guard is `seq !== seen`,
and `seq` (N) now EQUALS `seen` (N) already, so the branch that would call
`setFeed` never runs, on this call or any later one for seq N. The live
action is silently swallowed — never announced, no card, no coins, nothing
— because the resync got there first. This would need a deliberate
low-probability race (a resync trigger — resubscribe/tab-visible/pageshow/
online/focus/heartbeat — firing at just the moment a live push is in
flight) to hit in practice; I did not attempt to reproduce or fix it. If it
matters before the playtest, the likely fix mirrors whatever the other
agent does for `useGameRoom`: `updatePos` (or `useTvFeed`) needs a way to
tell "the resync landed first" from "this exact seq was actually live", not
just an equal-seq guard.

## Reproduce

```
npm run dev:mock -- --port 3088 --strictPort
```
Open `http://127.0.0.1:3088/tv-harness.html?chrome=0&s=<scenario>` in a
browser, or drive headlessly (see below). Scenarios used:
`tv-card-chance`, `tv-card-chest`, `tv-my-turn`, `tv-six-players` (all in
`src/dev/scenarios.js`, read-only).

To force a specific card draw beyond what the canned scenarios cover, in
the page's console (or via `Runtime.evaluate`):
```js
await window.mockGameAction('MOCK01', 'roll', {
  playerId: 'mock-afo',           // Afo's mock playerId
  __forceTarget: 8,               // cell id: chance 8/23/37, community 3/18/33
  __forceCard: { deck: 'chance', index: 1 },  // see CHANCE_DECK/COMMUNITY_DECK
});                                             // in src/dev/mockSupabase.js ~line 250
```
Card indices (`src/dev/mockSupabase.js` `CHANCE_DECK`/`COMMUNITY_DECK`,
~line 250-277): chance `0`=collect $50, `1`=pay $15, `3`=moveTo Start,
`4`=payEach $50, `5`=repairs, `6`=goJail, `7`=nearest railroad,
`8`=nearest utility; community `0`=collect $100, `1`=pay $50, `2`=goJail,
`4`=collectEach $10.

> `7` and `8` were **appended** 2026-09-20 (deliberately appended, not
> renumbered, so every index above and every script written against them still
> means what it used to). **Careful: these are MOCK indices and they do not line
> up with the server's.** In `mono_deck`
> (`supabase/migrations/20260918140000_game_rules.sql` ~line 450-453) the two
> `nearest` cards are `c4`/`c5` at Chance indices **3 and 4** — where the mock
> has moveTo-Start and payEach. The mock deck has always been a smaller,
> differently-ordered subset of the real one, which is harmless while every test
> forces a card by index through `__forceCard`, but means a *random* mock draw is
> not distributed like a real one. Say which deck you mean whenever you quote an
> index.

To test the resync/silent race by hand:
```js
window.__mockConn.drop();
window.__mockConn.stepWhileDown('roll', { playerId: 'mock-afo', __forceTarget: 8, __forceCard: { deck: 'chance', index: 0 } });
window.__mockConn.restore(); // watch for ~1-2s, BACKOFF_MS[0] = 1000ms
```

Headless Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe`)
driver scripts (PowerShell, CDP) are in
`C:\Users\NEONCA~1\AppData\Local\Temp\claude\d--Projects-Hobby-Web-Active-Projects-Monopoly\7a0b20df-f887-4be3-a248-d5c0d26a1158\scratchpad\tvcard\`:
- `cdp-frames.ps1` — fixed-scenario frame sequence via
  `--virtual-time-budget` (note: framer-motion/CSS rAF animations — dice,
  TvPayFx banner — freeze mid-frame under `--virtual-time-budget`; fine for
  checking the Latest feed and the card overlay, not reliable for animation
  timing).
- `cdp-force-card.ps1 -Deck <chance|community> -Index <n> -Target <cellId>
  -Prefix <name> -Port <port>` — real wall-clock time, forces a card via
  `window.mockGameAction` and captures a real frame sequence. Room/scenario
  is hardcoded to `tv-my-turn`; `cdp-force-card-six.ps1` is the same against
  `tv-six-players`.
- `cdp-resync-test.ps1` — the drop/stepWhileDown/restore sequence above,
  with frame captures before and after.
All frames are `*.png` alongside the scripts in that same `tvcard/` folder
(`before-chance-*`, `after-chance-*`, `after-pay-*`, `after-move-*`,
`after-jail-*`, `after-chest-*`, `after-six-long-*`, `six-players-*`,
`resync-*`).

Dev server and every headless Chrome instance I started have been stopped;
port 3088 is free.

## Remaining TODOs, priority order

1. (Optional, low-confidence) Investigate whether the resync-swallows-live
   race described above is actually reachable on the TV and fix it if so —
   see the cross-agent note. Not reproduced, not started.
2. (Cosmetic, low priority) Decide whether a `moveTo` card that also grants
   a Start-passing bonus should merge its "Passing Start · $200" row into
   the card's row too, or whether that is legitimately separate information.
   Not started; current behavior shows both rows.
3. `CardFeedRow` (`TvSide.jsx`) duplicates a slice of `EventRow`'s
   markup/CSS because `describeEvent`'s `card` case (`src/Client/EventView.jsx`)
   has no badge slot and that file belongs to the other agent today. If/when
   `EventView.jsx` is available, consider adding a `badge` to its `card`
   case and retiring `CardFeedRow` in favor of the shared `EventRow`. Not
   started, not urgent — current solution works and is verified.

## Files touched (all in `src/Board/*`)

- `src/Board/TvSide.jsx` — card/consequence de-dup + `CardFeedRow`,
  `maxRowsFor`/`baseDens`, `silent` threading (`useTvFeed` + `TvCash`).
- `src/Board/tvSide.module.css` — `.evs`/`.players` grid-track fix,
  `CardFeedRow` styles.
- `src/Board/TvCenter.jsx` — `silent` prop → `useTvFeed(game, silent)`.
- `src/Board/BoardGrid.jsx` — forwards `silent` to `TvCenter`.
- `src/Board/BoardScreen.jsx` — passes its computed `silent` to `BoardGrid`
  and `TvSide`.

No files outside `src/Board/*` were edited. `npm run build` passes as of
this handoff.
