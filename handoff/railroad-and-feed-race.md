# Handoff — "cannot buy the second Railroad" + the refetch/realtime feed race

Written 2026-09-20, the night before the first playtest. Everything below is
current against the working tree; nothing is committed and nothing has been
applied to the hosted database.

> **SUPERSEDED IN PART — read `playtest-readiness-2026-09-20.md` first.**
> The diagnosis below is still the best account of *why* each bug existed and is
> worth reading in full. But §7's TODO list is stale (items 1, 3, 4 and 5 are all
> resolved or decided there), and **§4's proposed `useTvFeed` patch was run and
> found to be subtly wrong** — it passes "one feed per seq" but deals the Chance
> card over a tumbling die, because `TvCenter`/`TvSide` are handed the *held* row
> while `silent` is derived from the *raw* one. The shipped fix needs a fourth
> piece of state that §4 did not anticipate. Do not apply §4 as written.

---

## 1. The report

Verbatim, from the owner, after real play on real phones:

> "For some reason I cannot buy the second Railroad."

That is the entire report. Railroads are cells 6 / 16 / 26 / 36 (flag `road` in
`src/Hooks/baseState.jsx`); utilities are 13 / 28 (`communal`).

---

## 2. Bug A — the BUY offer. FOUND, FIXED, VERIFIED.

### Root cause

**Client-side. Not railroad-specific** — the railroad path is byte-identical to
a street on both server and client. The offending line was in
`src/Client/ClientScreen.jsx`, in the `choice` IIFE:

```js
if (landedAt == null || me.position !== landedAt) return null;
```

`landedAt` is React state written in exactly one place — the `reveal.feed`
effect, from a `land` event. `useGameRoom` emits a feed **only for updates that
arrive live**: the first fetch and every resync go through
`apply(data, { silent: true })`, which never calls `setFeed`. So any phone that
lost its live `land` event — by reload, or by the race in §3 — sat mid-turn on
a free space with **"END TURN" as the only button**, no BUY, no PASS, and no
explanation. The purchase was impossible for the rest of that turn.

### The fix (`src/Client/ClientScreen.jsx`, lines ~645–700)

* line 667 `landedHere` — kept, as the second way in for the debug `move` jump,
  which resolves a landing without changing the phase.
* line 689 `if (phase !== "act" && !landedHere) return null;` — the durable
  gate. `phase === "act"` means this player has rolled this turn and is standing
  where the roll left them (nothing moves a token during `act`), which is
  exactly what the server accepts: `game_action`'s `buy` has **no** turn or
  phase guard at all, only "you stand on it / nobody owns it / you can afford
  it".
* lines 676–684 `declinedHere` — scans `game.log` back to my last `land` on this
  space for an `auction_none`. Without it the phase gate would hand the offer
  BACK after an auction that found no bidder, which is the one case the
  in-session `passed` flag exists for.

### The server is innocent — proven, not assumed

`buy` is identical in all five migrations that define `game_action`. 9 new
tests in `supabase/tests/auction_trade.test.mjs`, section
`railroads & utilities`, all through **real forced rolls** (`setseed`), cover:
2nd/3rd/4th railroad bought in sequence; second utility both ways round;
landing on a free railroad while another player owns a different one; `buy`
refused only for the right reasons; railroad rent 25/50/100/200 by cells owned
and following a trade; utility 4×/10× including split ownership; a real landing
paying the 2-railroad rate; a railroad through an auction; bankruptcy handing
all four railroads and both utilities over as individual cells.

**No migration is needed and none was written.** `supabase/migrations/` is
untouched. Deploy the client and Bug A is fixed.

### Sweep for the same class (colour/group instead of cell id) — clean

Every ownership decision keys on the cell: `mono_owner`, `mono_rent`,
`mono_tradable`, `mono_give_cell`, `mono_transfer_assets`, and client
`ownerOf` / `rentFor` / `tradable`. The only colour-keyed code
(`mono_owns_set`, `setCells`, `ownsSet`, `build`) is restricted to
`kind = 'street'`, so the `#000` shared by railroads, utilities, Start, Tax,
Jail, Chance and Chest cannot leak in. **`src/Board/TvSide.jsx` is also correct**
(read-only for this work): `groupKeyOf` deliberately returns `"road"` /
`"communal"` rather than `cell.color`, and `stakesOf` counts per cell.

---

## 3. Bug B — the refetch-vs-realtime feed race. REAL. FIXED. VERIFIED.

### The hypothesis was right, and there is a worse variant than the one posed

A **silent** resync adopts a row and advances `seenSeq` without emitting a feed.
Triggers, all routed through `refetch()` → `apply(data, { silent: true })`
(`src/Hooks/useGameRoom.js` line ~216):

| trigger | where |
|---|---|
| 20s heartbeat (`force: true`, bypasses the debounce) | `connection.js` `HEARTBEAT_MS`, line ~355 |
| `focus`, `visibilitychange`, `pageshow`, `online` | `connection.js` `resume()`, lines ~312–336 |
| resubscribe after a drop | `connection.js` `handleStatus`, line ~294 |
| the `ECHO_MS` (1500ms) liveness probe | `useGameRoom.js` `run()`, line ~300 |

The old guard was `if (seenSeq.current !== null && rawSeq <= seenSeq.current)
return false;` — so once a silent resync had adopted seq N, the **live** row for
N was dropped as a duplicate and its `game.events` were never handed to the
screen. Consequences: no dice settling on the rolled faces, no Chance/Chest
overlay, no doubles/busted FX, no pay FX, no sound, and **no `land` event** —
which is precisely Bug A's symptom, intermittently, with no reload involved.

**The worse variant (not in the original hypothesis).** `apply(res.data)` for
our *own* RPC reply is non-silent, so it looks safe — but it only runs after
the reply has travelled back. The server commits *before* that. Any refetch
resolving inside that window adopts the committed row silently and the reply is
then dropped. The single most likely trigger is the phone's own echo probe:
`rollAgain()` fires `end_turn` then `roll` back-to-back, `end_turn`'s 1500ms
probe is still armed while the `roll` is in flight, and on a real socket
(echo latency >1.5s) it fires exactly there. That is "I rolled doubles, rolled
again, and then couldn't buy."

**Why the mock never showed it:** `emit()` delivered to listeners synchronously
*before* `gameAction` returned, so the Realtime echo always won. On a hosted
project the socket is the **slowest** of the three paths.

### The fix (`src/Hooks/useGameRoom.js`)

Separate *adopting a row* from *playing its beat*:

* line 79 — new ref `shownSeq`: the newest seq whose events were actually handed
  to the screen. Reset alongside `seenSeq` on room change (line 198).
* lines 133–139 — `owed`: a **non-silent** arrival for the seq we are currently
  showing, whose beat was never played, is still allowed through.
* line 157 — `shownSeq` is stamped whenever a feed is emitted, which makes
  "exactly once per seq" hold in **either** arrival order (refetch→rpc,
  refetch→realtime, realtime→rpc, rpc→realtime).
* Deliberately limited to `rawSeq === seenSeq.current`. A live row genuinely
  *behind* the screen (an opponent acted while our reply was in flight) stays
  dropped — its events describe a state the player has already moved past.

**This is a different rule from the one suggested** ("a refetched row with
`seq === seenSeq + 1` while live is applied non-silently"). Rationale: a refetch
cannot know how old the row it just read is, so making refetches announce
things risks replaying a 19-second-old card when the heartbeat is the thing that
found it. Routing the announcement through whichever **live** path delivers the
seq keeps the "only live updates are news" contract intact and still rescues
both cases that matter. The one case not covered is "the socket is genuinely
dead and a refetch is the only delivery", where snapping to state silently is
the documented, intended behaviour.

`src/Hooks/connection.js` was **not modified** (it is correct; it is only the
source of the triggers).

### Deliberate non-change: the echo probe

`lastLiveEventAt` is still stamped only in `onRealtime`. The probe measures
**the socket**, and a row that arrived by refetch is not evidence the socket
works — stamping it there would mask exactly the dead-channel failure the probe
exists to catch. Flagged rather than silently decided; revisit if it causes
spurious rebuilds in play.

---

## 4. Does the TV have the same race? **YES.** (not edited — another agent owns `src/Board/*`)

`src/Board/TvFeed.js` `useTvFeed(game, silent)` keeps a single `seen` state that
serves as *both* "adopted" and "announced":

```js
if (seen === null) { if (seq > 0) setSeen(seq); }
else if (seq !== seen) { setSeen(seq); if (seq > seen && !silent) setFeed({...}); }
```

`src/Board/BoardScreen.jsx` `updatePos()` (line ~178) lets an **equal** seq
through on purpose (`if (next < seqRef.current) return;`) and sets
`silentSeq = fromResync ? next : -1`, with `silent = silentSeq >= 0 && liveSeq
=== silentSeq` (line 132). So when a resync adopts seq N silently, `seen` is
already N; the later Realtime push for N re-renders with `silent === false` but
hits `seq !== seen` → **false** → no feed. Same bug, same consequence (a card,
dice or pay FX the TV never plays).

**Equivalent change**, mirroring the phone exactly — add a second state and one
extra branch in `useTvFeed`:

```js
const [shown, setShown] = useState(null);
...
} else if (seq > seen) {
  setSeen(seq);
  if (!silent) { setShown(seq); setFeed({ seq, actor: game?.actor ?? null, events: ... }); }
} else if (seq < seen) {
  setSeen(seq);                       // new_game / reset rewind: re-baseline, quiet
} else if (!silent && seq > 0 && (shown === null || seq > shown)) {
  setShown(seq);                      // THE RESCUE: adopted by a resync, never announced
  setFeed({ seq, actor: game?.actor ?? null, events: Array.isArray(game?.events) ? game.events : [] });
}
```

No change needed in `BoardScreen.jsx` — it already passes the `silent` flag and
already lets the equal seq through, which is what makes the rescue reachable.

---

## 5. Verified vs NOT verified

**Verified**
- `npm run test:sql` — 71/71 green, **5 consecutive runs** (was 62/62 before).
- `npm run build` — passes (last run after all edits and after instrumentation
  was removed).
- Bug A before/after in the mock at 390×844 (screenshots in §6).
- Bug B: with `latency(2500)` + `replyLag(1200)` + a `focus` event mid-flight —
  **with the fix**: 1 feed per seq in all four cases, caption reads the correct
  rolled sum, BUY present on the free railroad. **With the rescue disabled**:
  0 feeds, dice label stuck on "Rolling", 8 checks fail. Both directions
  observed.
- Regression pass over `my-roll`, `my-buy`, `my-buy-poor`, `my-build`,
  `waiting`, `bankrupt`, `six-players`, `jail`, `auction-my-move`,
  `auction-by-bot`, `auction-no-bids` — unchanged.

**NOT verified**
- That the owner's phone hit the race rather than a reload. Both produce the
  identical symptom and both are now fixed; which one he hit is unknown.
- Anything on real hardware or real Supabase. All of the above is headless
  Chrome against the mock, plus pglite for the SQL.
- The TV change (§4) is **analysis only — not written, not run**.
- "Advance to the nearest railroad" end-to-end on the phone: the mock's
  `CHANCE_DECK` has no `nearest` card, so that branch is covered on the server
  side only.
- `declinedHere` reads `game.log`, which the server caps at 40 entries. A turn
  long enough to push the `auction_none` out would let the offer reappear after
  a reload. Needs ~40 events in one turn; judged not worth extra row state.

---

## 6. How to reproduce

```
cd "D:/Projects/Hobby/Web/Active Projects/Monopoly/monopoly"
npm run dev:mock -- --port 3077 --strictPort
# http://localhost:3077/client-harness.html?chrome=0&s=<scenario>
```
`npm run dev` WITHOUT `--mode mock` talks to the real backend — do not use it.

**Scenarios added** (`src/dev/scenarios.js`):

| id | line | what it shows |
|---|---|---|
| `my-buy-railroad` | 426 | own railroad 26, land on the unowned 36 — BUY must appear |
| `my-buy-utility` | 445 | own utility 13, land on 28 |
| `my-buy-reloaded` | 465 | **the Bug A repro**: fresh load, phase `act`, standing on free railroad 36 |
| `my-buy-declined` | 486 | passed + `auction_none` in the log — BUY must stay gone |

**Mock dev knobs** (`src/dev/mockSupabase.js`, all default to the old behaviour):

| call | line | what |
|---|---|---|
| `window.__mockConn.latency(ms)` | 1710 | socket **delivery** lag; the commit stays instant. Default 0 = the old synchronous delivery, which is why the mock could never show the race. |
| `window.__mockConn.replyLag(ms)` | 1717 | the RPC's **return leg** — the commit→our-reply window the race lives in. Default 0. |
| `window.mockDev.forceNextRoll([d1,d2])` | 1930 | one-shot forced dice for the next `roll`, consumed on use. |

Together these give the mock the hosted ordering: commit first, our reply
second, the socket last.

**Scratch scripts** (Playwright is vendored at `<scratch>/conn/node_modules`, so
run them from that directory), where `<scratch>` is
`C:/Users/NEONCA~1/AppData/Local/Temp/claude/d--Projects-Hobby-Web-Active-Projects-Monopoly/7a0b20df-f887-4be3-a248-d5c0d26a1158/scratchpad`:

- `<scratch>/conn/rr-dom.mjs <scenario> [out.png]` — dump state + buttons + ticket.
- `<scratch>/conn/rr-race.mjs` — the Bug B check (4 cases).
- `<scratch>/conn/rr-hit.mjs` — hit-tests the BUY button (overlay/pointer-events).
- `<scratch>/conn/rr-fuzz.mjs`, `rr-walk.mjs` — exploratory.
- `<scratch>/railroad/repro.mjs` — the server-side pglite repro (import path is
  a `file:///` URL, since it lives outside the project).

> **`rr-race.mjs` needs a 10-line dev probe that was REMOVED from the production
> file on instruction.** To re-run it, re-add to `src/Hooks/useGameRoom.js`
> (same `import.meta.env.DEV` guard as `window.__conn` in `connection.js`, so it
> ships nothing), then delete it again afterwards:
> ```js
> const DEV = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;
> function noteFeed(next, via) {
>   if (!DEV || typeof window === "undefined") return;
>   (window.__feed ||= []).push({ seq: next.seq, actor: next.actor, n: next.events.length,
>     types: next.events.map((e) => e && e.type), via, at: Date.now() });
> }
> ```
> …give `apply` a `via = "?"` option, tag the four call sites
> (`"first"` / `"refetch"` / `"realtime"` / `"rpc"`), and call
> `noteFeed(next, owed ? `${via}:rescued` : via)` just before `setFeed(next)`.
> The `:rescued` suffix is what proves the fix actually fired.

**Screenshots** in `<scratch>/railroad/`:
`rr-reload.png` (before — free RailRoad, END TURN only) ·
`rr-after.png` (after — BUY 200$ / PASS) ·
`rr-before.png` (the live-roll case, working before and after, which is what
shows the defect was never about railroads).

---

## 7. TODO, in priority order

1. **Route the TV change in §4** to whoever owns `src/Board/*`. Same class of
   bug, same consequence on the big screen. Analysis is written; the patch is
   ~8 lines in `TvFeed.js`.
2. **Play a real game against the hosted backend before the table starts** —
   every finding here is mock/pglite only, and Bug B is by definition a
   real-latency bug.
3. Decide the echo-probe question (§3, "Deliberate non-change").
4. Consider whether `passed` should live in the row rather than in React state,
   which would retire `declinedHere` and its 40-entry log dependency.
5. Add a `nearest`-railroad card to the mock's `CHANCE_DECK` so that branch is
   reachable on the phone.

---

## 8. Files touched

| file | change |
|---|---|
| `src/Client/ClientScreen.jsx` | Bug A: `phase === "act"` gate, `landedHere`, `declinedHere` (lines ~645–700) |
| `src/Hooks/useGameRoom.js` | Bug B: `shownSeq` + `owed` rescue in `apply` (lines 79, 96–165, 198) |
| `src/dev/scenarios.js` | 4 new phone scenarios |
| `src/dev/mockSupabase.js` | `latency()`, `replyLag()`, `forceNextRoll()`; `emit()` split into commit + delivery |
| `supabase/tests/auction_trade.test.mjs` | new `railroads & utilities` section, 9 tests |

**Not touched:** `supabase/migrations/**` (no migration needed),
`src/Hooks/connection.js`, `src/Board/**`, `src/Client/figures.js`, `.env`.
No commits made.
