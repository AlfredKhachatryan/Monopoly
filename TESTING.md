# What to test

Everything in section "Core gameplay" of `LAUNCH_STATUS.md` was finished on
2026-09-18 and passed automated tests, but those ran against an **in-process
Postgres and a headless Chrome on one machine**. Nothing here has ever touched
the hosted Supabase project or a real phone. That is what this document is for.

Budget roughly:

| Part | Time |
|---|---|
| 0. Setup and smoke test | 20 min |
| 1-7. Rule tests with the debug jump | 60 min |
| 8. Multi-device and Realtime | 30 min |
| 9. One full game with friends | 60-90 min |

Tests are numbered (T1, T2, ...) so you can report "T14 failed" instead of
describing it.

---

## Playtest day runbook

Order of operations for whoever is hosting tomorrow:

1. **Apply the pending migrations** (§0.1 below) and run every check listed
   there. Do not skip the checks — they are the only way to know the six-seat
   constraints and `game_action` actually landed before six people show up.
2. **Deploy or serve** the built app (`npm run build` + host `dist/`, or
   `npm run dev` on the host machine with phones on the same Wi-Fi).
3. **Host a fresh room.** Do not reuse a room created before today — see 0.2.
   Press **Host New Game** on the TV/board screen.
4. **Before guests arrive**, with two phones on the fresh room, run Reconnect
   checks (1) and (2) from the new "Reconnect" section below. If either fails,
   you want to know now, not mid-game.
5. **Share the join URL** in the format `/Login?room=CODE` (or just the code,
   read aloud, for people typing it into `/Login` themselves).
6. **When a phone stalls** (frozen dice, unresponsive button, or anything that
   just sits there): wait for the connection badge to say something → open the
   phone's **Game** sheet → press **Reconnect / refresh state** → if that does
   nothing, refresh the page. Rejoining with the same name and figure works
   from any phone if the original is lost or its battery dies.
7. **Skip Turn** on the TV is for a guest who stepped away or closed their
   phone mid-turn — use it rather than waiting them out.
8. **Do not use `?debug` cell jumps on a jailed player.** The debug `move`
   action ignores jail state entirely (it is a raw teleport), so jumping a
   jailed player will desync what the server thinks their jail status is from
   what the board shows.
9. **Write down** anything in the T56-T60 style: a player left waiting with no
   feedback, a popup covering something they needed, text overflowing a card,
   a state where nobody can act, or money numbers that felt wrong. Room code
   and what happened immediately before the problem are the two things worth
   more than anything else in a report.

---

## 0. Before you start

### 0.1 Apply the migrations

**This is blocking. Nothing works until it is done.** Apply all seven, in this
order, with `supabase db push` or by pasting them into the SQL editor. Per the
owner: **the first three are already applied** to the hosted project; **the
last four are still pending** unless told otherwise.

1. `20260904123000_create_test_game_table.sql` — applied
2. `20260908120000_allow_create_game.sql` — applied
3. `20260918120000_game_action_rpc.sql` — applied
4. `20260918140000_game_rules.sql` — pending
5. `20260918160000_game_log.sql` — pending
6. `20260919100000_auction_trade.sql` — pending
7. `20260920100000_six_players.sql` — pending

Migrations 3, 4, 6 and 7 each redefine `game_action` in full (`create or
replace`); each one replaces the previous version, so the order matters and
you cannot skip one and apply a later one on its own. `20260920100000` must go
last — it widens the four- to six-seat constraints and upgrades every existing
row's board shape to eight figure keys.

Then check it landed:

```sql
-- should return one row
select proname from pg_proc where proname = 'game_action';

-- should return: game
select column_name from information_schema.columns
where table_name = 'test' and column_name = 'game';

-- should return: test  (Realtime must still publish the table)
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'test';
```

### 0.1.1 After the six-player migration lands, check these too

```sql
-- should return test_players_max_six and test_current_order_range,
-- and NOT test_players_max_four
select conname from pg_constraint
where conrelid = 'public.test'::regclass
  and conname in ('test_players_max_four', 'test_players_max_six',
                  'test_current_order_range');
```

```sql
-- should return 0: every cell on every room's board has all eight fig0..fig7
-- keys, both as a token flag and inside `bought`
select count(*)
from public.test t, jsonb_each(t.position) e
where jsonb_typeof(e.value) = 'object'
  and (not (e.value ? 'fig7')
       or jsonb_typeof(e.value->'bought') <> 'object'
       or not (e.value->'bought' ? 'fig7'));
```

```sql
-- should mention six_players
select obj_description('public.game_action(text,text,jsonb)'::regprocedure);
```

### 0.2 Reset any old room

Rooms created before this migration hold players with no jail or bankruptcy
fields, and some of them have `position: 0`, which is not a real cell. The
server copes, but the phone cannot draw a card popup for cell 0.

**Open the Board for any old room and press "New Game" once** before testing it.
Or just host a fresh room, which is cleaner.

### 0.3 Devices

Minimum: one laptop or TV for the board, two phones. Better: up to six phones
— the room now holds six players (`MAX_PLAYERS` in `src/Hooks/rules.js`) and
turn order, the `current_order` constraint (now 0-5) and the leave-and-renumber
logic all involve the seat count. Six real phones on one Wi-Fi has never been
tried; that is exactly what tomorrow is for.

- Board: `http://<host>:3000/?room=<code>` or press **Host New Game**.
- Phones: `http://<host>:3000/Login?room=<code>`, pick a name and a figure.
- Add `&debug` to the phone URL to get the cell jump dropdown. `npm run dev`
  shows it anyway. **You need it for sections 1-7.**

### 0.4 Two facts about the debug jump

Both are intentional. Do not report them as bugs.

- A debug jump **does not use up your turn**. You still have your roll. That is
  what makes it usable for testing out of turn.
- A debug jump **does not pay the $200 for passing Start**, even if the jump
  passes it. Only a real roll or a card does.

### 0.5 Known non-bugs

Do not spend time on these. They are already on the list in `LAUNCH_STATUS.md`.

- **Cards are drawn at random with replacement.** There is no discard pile, so
  the same Chance card can come up twice in a row.
- **If you edit the database by hand** (section 6), the phones will not show the
  change until the next real action. That is the duplicate-event guard doing its
  job, not a sync bug.
- **The debug `move` action ignores jail.** Jumping a jailed player with the
  `?debug` cell picker does not clear or respect their jail state — see the
  runbook above. Use it on non-jailed players only.

---

## 1. Smoke test

If any of these fail, stop and report. Everything else depends on them.

- [ ] **T1** Board loads, press **Host New Game**, a six-character code appears
      top left and in the address bar.
- [ ] **T2** Two phones join with that code. Both names appear on the Board with
      $2500, and both tokens sit on Start.
- [ ] **T3** The first player's phone shows **Roll The Dice** enabled. The other
      shows "Not Your Turn" and a greyed button.
- [ ] **T4** Press Roll. The dice animate, "You've got: N" appears, the token
      moves on **all three screens**, and a popup opens on the roller's phone.
- [ ] **T5** Close the popup. The turn passes to the other phone, and the green
      check mark on the Board moves with it.
- [ ] **T6** No red error text above the bottom of the phone screen at any point.
      That strip shows server rejections.

---

## 2. Buying, rent and colour sets

Use cells 2 and 4 (Зайка and Статуя Гая, $60 each). They are the cheapest
complete colour set on the board.

- [ ] **T7** Jump player A to cell 2. The popup shows the price, the full rent
      table and **Buy $60 / Pass**. Press Buy. Money drops by $60 and the Board
      draws an animated border in A's colour around the cell.
- [ ] **T8** Jump player B onto cell 2. Rent is taken with no button press. The
      popup says "Owned by A" and the bottom line reads "Paid $6 rent to A".
      A's money on the Board goes up by the same $6.
- [ ] **T9** Jump A to cell 4 and buy it. A now owns the whole colour set.
- [ ] **T10** Jump B onto cell 2 again. Rent is now **$12**, not $6. The doubled
      colour-set row is the one in bold in the table.
- [ ] **T11** Press Pass on an unowned property. Nothing is bought, no money
      moves, the turn still ends.
- [ ] **T12** Land on your own property. The popup says "Your property" and
      offers no Buy button.

## 3. Houses and hotels

Still on cells 2 and 4, owned by A.

- [ ] **T13** Open the **Houses** drawer on A's phone. Both streets are listed,
      each with a **+ House $50** button. This list comes from the database, not
      from browser storage, which is what T49 checks.
- [ ] **T14** Build one house on cell 2. Money drops $50, and a small green
      square appears on that cell **on the Board**.
- [ ] **T15** Try to build a second house on cell 2 before cell 4 has one. The
      button is replaced by "Build on the other streets first".
- [ ] **T16** Build both streets up to four houses each. The button then reads
      **Hotel $50**, since the fifth house is the hotel. Buy it, and the Board
      shows one wide red block instead of four green squares.
- [ ] **T17** Jump B onto a hotel street. Rent is **$450** (base $6 times 75).
- [ ] **T18** Pick a street where you do **not** own the whole colour set. The
      drawer shows "Needs the whole colour set" and no build button.

## 4. Railroads and utilities

Railroads are cells 6, 16, 26, 36. Utilities are 13 (Light) and 28 (Water).

- [ ] **T19** Buy railroad 6 for $200. Jump the other player onto it: rent $25.
- [ ] **T20** Buy railroad 16 as well. Rent on either is now $50. With three,
      $100. With all four, $200.
- [ ] **T21** Buy utility 13 for $150. Jump the other player onto it. Rent is
      **four times the dice roll shown on their last roll**, so it changes from
      visit to visit.
- [ ] **T22** Buy utility 28 too. Rent becomes ten times the dice.
- [ ] **T23** The Board draws the owner border on railroads and utilities, not
      only on coloured streets.

## 5. Tax, Start, cards and jail

- [ ] **T24** Jump to cell 5 (Tax). $200 is taken automatically, the popup says
      so, no button choice.
- [ ] **T25** Jump to cell 39 (Luxury Tax). $400.
- [ ] **T26** Roll past Start in a normal turn. $200 arrives and the popup notes
      "Collected $200 for passing Start".
- [ ] **T27** Jump to a Chance cell (8, 23, 37). The popup says **Take a card**.
      Press it. The card flips over with real text on it, and the same text
      appears in the Chance panel in the middle of the Board with the player's
      name.
- [ ] **T28** Same for Community Chest (cells 3, 18, 33) and the second centre
      panel.
- [ ] **T29** Draw cards until you hit one that **moves** you. The token moves,
      and a second popup opens for wherever you landed, including rent if it is
      owned. This is the chaining behaviour most likely to look wrong.
- [ ] **T30** Draw the **Get Out Of Jail Free** card. The "Cards" tab on the
      right edge shows "(1)".
- [ ] **T31** Jump to cell 31 (Go To Jail). The token moves to cell 11, the
      popup explains, and the Board shows "(jail)" next to that player.
- [ ] **T32** On their next turn the phone offers **Roll for doubles**,
      **Pay $50** and, if they have one, **Use card**. Press Pay $50. They are
      free, still hold their roll, and the button goes back to Roll The Dice.
- [ ] **T33** Get jailed again and roll instead. If it is not doubles, the popup
      says still in jail and the turn passes. After the third failed roll the
      $50 is taken automatically and the token moves.
- [ ] **T34** Get jailed again and use the free card. It is spent, the count
      drops, and they are out.
- [ ] **T35** Roll doubles in a normal turn. The status says "Doubles! Roll
      again" and the same phone keeps the turn.
- [ ] **T36** Roll doubles three times in a row. Straight to jail, no extra roll.
      This one takes patience, or fake it in section 6.

## 6. Bankruptcy and winning

The only practical way to force this is to edit money directly. In the Supabase
SQL editor:

```sql
update test
set "Players" = (
  select jsonb_agg(case when p->>'name' = 'Bob' then p || '{"money": 50}' else p end)
  from jsonb_array_elements("Players") p
)
where uuid = '<your room code>';
```

- [ ] **T37** With Bob on $50, jump him onto Luxury Tax (cell 39). He cannot pay
      $400. The popup says bankrupt and out of the game.
- [ ] **T38** On the Board, Bob's row is greyed out with his name struck through,
      and his token is gone from the board.
- [ ] **T39** Bob's phone shows "You are bankrupt" and his Roll button stays
      disabled. Turns skip him from now on.
- [ ] **T40** Do the same but make him land on **another player's property**
      instead of tax. All his money and all his property transfer to that
      player, visible on the Board.
- [ ] **T41** In a two-player room, bankrupt one of them. The Board covers the
      whole grid with "Game over, X wins!", the Board player row shows WIN, and
      both phones say the game is over. Nobody can roll.

## 7. Board controls

- [ ] **T42** Press **New Game** during a running game. It asks for confirmation
      first.
- [ ] **T43** Confirm. Everyone is back on Start with $2500, all ownership and
      houses are cleared on every cell, the turn is back to the first player,
      and anyone who was in jail or bankrupt is playing again. **Players keep
      their seats**, nobody has to rejoin.
- [ ] **T44** Press **New Game** from the game-over banner. Same result.
- [ ] **T45** Press **Skip Turn** while a phone is mid-turn. The turn moves on.
      This is the escape hatch for a player who closed their browser.
- [ ] **T46** Press **Leave** on a phone. That player disappears from the Board,
      their figure becomes available again on the Login page, their property is
      released, and the remaining players keep their relative turn order.

## 8. Multi-device and Realtime

This is the part no automated test could cover. Take it slowly.

- [ ] **T47** All four screens agree after every single action. Watch the Board
      while a phone acts.
- [ ] **T48** **Refresh a phone mid-game.** It comes back with the right money,
      the right position and the right turn state. If it was that player's turn
      and they had already rolled, an **End Turn** button appears instead of the
      dice.
- [ ] **T49** **Rejoin from a different phone** with the same name and code. The
      Houses drawer is rebuilt from the database and shows everything they own.
      This used to come from browser storage and came back empty.
- [ ] **T50** Two phones act at the same moment, for example both pressing a
      popup button together. Nothing is lost, no money goes missing.
- [ ] **T51** **Lock a phone, wait a minute, unlock it.** See the risk note
      below. Check whether it is still in sync, and if not, whether a refresh
      fixes it.
- [ ] **T52** Turn the Wi-Fi off on one phone for ten seconds and back on.
- [ ] **T53** Join a sixth player. Turn order still cycles correctly through
      all six.
- [ ] **T54** Try to join a seventh. Rejected with "Room is full".
- [ ] **T55** Try to take a figure somebody already has, and try an unknown room
      code. Both rejected inline, above the button (no browser alert any more).

## 9. Play a real game

Nothing substitutes for this. Four people, one TV, one full game to a winner.
Watch for:

- [ ] **T56** Anything that makes a player wait without knowing why.
- [ ] **T57** Popups that cover something they needed to see.
- [ ] **T58** Text that does not fit its card, especially the longer Chance and
      Community cards on a small phone.
- [ ] **T59** The game reaching a state where **nobody can do anything**. Note
      the room code and what happened immediately before, this is the most
      valuable bug you can find.
- [ ] **T60** Whether the money numbers feel right. The rent formula is one
      single formula for every street, not the official per-street table from
      the real game. If rents feel too flat or too brutal, say so, it is two
      numbers to change.

---

## 10. Six players, figures, doubles and jail

New today, none of it ever run against a hosted room or a real phone.

- [ ] **T86** On the Login screen, pick each of the four new figures in turn
      (Bat = fig4, Mummy = fig5, Octo = fig6, Slime = fig7). Each shows its own
      art, name and colour, and joins the room as the right `figN`. The picker
      is a 4-across, 2-row grid of all eight figures (`src/Login/FigurePicker.jsx`).
- [ ] **T87** Seat all six players. Turn order cycles 1st through 6th and back
      to the 1st correctly, including after a **Leave** mid-game (the remaining
      players keep their relative order, per T46).
- [ ] **T88** With six players joined, the TV shows six tokens standing on
      Start, all readable at once (density steps kick in for 5-6 players).
- [ ] **T89** Doubles beats escalate correctly on both the phone and the TV:
      1st double plays the "doubles" cue (short bright rise) with a light
      heat pip; 2nd double plays "doublesHot" (tenser, higher, wobble) with a
      hotter pip; 3rd double plays "busted" (descending thud + clank) and
      shows the BUSTED banner, sending the player straight to jail without
      resolving whatever cell the roll would have landed on.
- [ ] **T90** Leave jail by paying $50: the fine is taken, they are freed, and
      they still get to roll that turn.
- [ ] **T91** Leave jail by rolling doubles: they are freed and move by the
      roll, but do **not** get an extra roll for the doubles (jail doubles pay
      for the exit only).
- [ ] **T92** Leave jail with a Get Out Of Jail Free card: the card count drops
      by one and they are freed with their roll still available.
- [ ] **T93** Fail three rolls in jail: the $50 fine is taken automatically on
      the third failure and they move by that roll. If it bankrupts them
      (T37-T39), it goes to whichever creditor is owed, or the bank.
- [ ] **T94** Draw a Get Out Of Jail Free card from either deck, and confirm it
      shows on the drawing player's phone **Deeds** sheet and on their TV
      player card. It is never offered as tradeable in the Trade sheet. A
      jailed player can still collect rent, bid in an auction and answer a
      trade while in jail.
- [ ] **T95** Run an auction with all six players in the rotation (start it
      with six seated and nobody bankrupt). The bidding order still starts
      with the player after whoever started it and wraps correctly through
      all six.
- [ ] **T96** Trade a property between two of the six seated players; the rest
      of the room is unaffected and turn order is undisturbed once it resolves
      (T74-T85 cover the mechanics in detail).

---

## 11. Reconnect

`src/Hooks/connection.js` drives a watchdog + backoff reconnect, resyncing the
room on the tab becoming visible, `pageshow` (iOS bfcache), `online`, focus, a
resubscribe, and a 20s heartbeat refetch while visible — on top of the
`game.seq` guard that drops a stale row and the post-action echo probe that
notices a socket which claims to be live but never delivered our own write.
There is deliberately **no automatic retry of an action itself** — only of the
connection and the refetch. None of this has been tried against the hosted
project or a real phone before tomorrow.

Run these with two phones before guests arrive (see the runbook), and again
with more phones once people are in the room:

1. **Lock phone A for 60 seconds** while phone B plays 3-4 turns. Unlock A: it
   should show the current game state within about 1 second of unlocking, with
   no manual action needed.
2. **Lock phone A**, then have B end their turn so it becomes A's turn while A
   is still asleep. Unlock A after 60 seconds: it should show "your turn" with
   a live, pressable roll button — not a stale "Not Your Turn".
3. **Airplane mode on one phone for 30 seconds**, then back on. The connection
   badge should read "Offline — check Wi-Fi" while it is off, then heal itself
   with no button press once Wi-Fi is back.
4. **Press Roll and immediately kill the phone's Wi-Fi.** It should show
   "Connection problem — try again" (or similar), never a raw fetch error in
   the console leaking to the screen. Do not re-tap Roll if the action actually
   landed on the server — check the Board/other phones before retrying.
5. **App-switch away for 20 seconds and back** (not a full lock). Same
   expectation as check 1: it should already be current, no refresh needed.
6. **Six phones, lock three of them for a minute, then wake all three at
   about the same time.** All three should resync independently without
   stepping on each other or on the two still-awake phones.

**Reading `__conn()`:** in a `npm run dev` build (never in the production
build — it is compiled out, see `connection.js`'s header), open the browser
console on any phone or the TV and call `window.__conn()`. It returns an array
(one entry per live room connection) with `status` (`connecting` / `live` /
`reconnecting` / `offline`), `since`, `attempt` (how far into the backoff it
is), `resyncs` and `lastResync` (what triggered the last refetch), and a
`reconnect()` you can call directly from the console — the same thing the
badge's **Reconnect** button and the Game sheet's **Reconnect / refresh state**
row call.

---

## Most likely to break

My honest list, in order. These are the places I would look first.

1. **Realtime not carrying the new `game` column.** Every popup, the dice and
   the turn state travel in it. If phones show nothing after a roll but the
   Board updates on refresh, this is it.
2. **A sleeping phone missing the turn change.** `src/Hooks/connection.js` now
   resyncs on wake, focus, `online`, `pageshow` and a 20s heartbeat while
   visible, but none of that has run against the hosted project or a real
   phone yet — section 11 (Reconnect) is the test. If a phone still sits on
   "Not Your Turn" after unlocking, this is the first place to look, and the
   room-code + `__conn()` output is the most useful thing to capture.
3. **Popup layout on small or short phones.** The card is a fixed 20em by 30em
   and the rent table now has eight rows. It fit a 390 by 844 screen in testing.
   Anything smaller is unverified.
4. **iOS Safari.** Every browser test ran in Chrome. The 3D dice, the backdrop
   blur behind popups and the `100dvh` layout are the likely trouble spots.
5. **Six players.** Only ever tested against an in-process Postgres and headless
   Chrome, never six real phones on one Wi-Fi. Turn order, the 0-to-5
   `current_order` constraint, the auction rotation and leaving mid-game all
   involve the seat count.
6. **Old rooms.** See 0.2. If a pre-migration room behaves strangely, press New
   Game before investigating further.

---

## Reporting

For anything that fails, the useful minimum is:

- The test number, or what you were doing.
- The room code and which player.
- What you expected, what happened.
- Whether the Board and the phones disagreed with each other.
- A photo of the screen if it is visual.

If a phone showed red text along the bottom, that is the server rejecting an
action. **Copy it exactly**, it names the reason.

For anything repeatable, this dumps the full state of a room and is worth
pasting along with the report:

```sql
select current_order, game, "Players" from test where uuid = '<code>';
```

`game -> 'events'` holds what the server did during the last action, in order,
which is usually enough to see where it went wrong.

---

## Offline client preview

A dev-only harness that opens the phone Client screen in every state --
mid-turn, buying, jail, bankrupt, game over, a dropped network -- with no
Supabase project, no other players, and no `.env`. Useful for UI work on
`src/Client/**` without hosting a room. It never ships: `npm run build`
never touches it (see `vite.config.js`'s `mockSupabasePlugin` and
`src/dev/mockSupabase.js`'s header comment for how the swap is gated).

**Run it:**

```
npm run dev:mock
```

then open `http://localhost:3000/client-harness.html`. (Plain `npm run dev`
still talks to the real Supabase module and needs a real `.env` -- this only
changes with the `:mock` script.)

Pick a starting state with the toolbar in the corner, or the URL directly:
`http://localhost:3000/client-harness.html?s=my-buy`.

**Scenarios:**

| Name | What it shows |
|---|---|
| `my-roll` | My turn, nothing rolled yet. |
| `my-buy` | Just landed on an unowned street, enough money. |
| `my-buy-poor` | Just landed on an unowned street, not enough money. |
| `my-build` | Landed on my own buildable colour set. |
| `my-end` | Just paid rent after landing on someone else's property. |
| `doubles` | Rolled doubles: roll again. |
| `jail` | My turn, in jail, holding a Get Out Of Jail Free card. |
| `waiting` | Someone else's turn. |
| `chance-card` | Roll + land + card, so the card overlay opens. |
| `card-pay-each` | Chance `payEach` card: I pay every other player $50 (pill: −150$). |
| `card-repairs` | Chance `repairs` card on my own 4 houses (pill: −100$, 4 × $25). |
| `card-collect-each` | Community `collectEach` card: every other player pays me $10 (pill: +30$). |
| `bankrupt` | I am bankrupt, watching the rest play out. |
| `game-over-win` | I am the last player standing. |
| `game-over-lose` | Someone else won. |
| `loading` | The initial fetch never resolves. |
| `fetch-error` | The initial fetch fails. |
| `server-error` | The next action is rejected with "Not enough money". |
| `auction-my-move` | I passed on LOL, it's my move, a high bid already exists from a bot. |
| `auction-no-bids` | Auction just started by me, no bids yet, a bot to move (bots act, then me). |
| `auction-leading` | I hold the high bid on LOL, a bot to move. |
| `auction-dropped` | I dropped out of the LOL auction, bots continue without me. |
| `auction-poor` | My move on the LOL auction, but I cannot afford the next minimum bid. |
| `auction-by-bot` | Not my turn: Ero started the LOL auction, I'm in the rotation. |
| `auction-last-one` | Everyone else dropped with no bid on LOL; I may bid $10 or drop. |
| `trade-compose` | My turn, act phase: I own a tradable set plus a built-up one; two bots own tradable cells. |
| `trade-not-my-turn` | Bot's turn: composing a trade must be refused by the client. |
| `trade-incoming` | Pending offer from Koli: her Чинар for my $180, live-pushed ~600ms after load. |
| `trade-incoming-counter` | Koli sends a counter-offer, live-pushed ~600ms after load. |
| `trade-incoming-poor` | Koli's incoming offer wants more cash than I have. |
| `trade-expired` | Incoming offer from Koli, but her Чинар changed hands before I can Accept (resolves to expired). |
| `trade-outgoing` | My offer to Koli is pending; she answers after a long ~8s delay (waiting banner). |
| `trade-accepted` | Live result: Koli accepts my railroad-for-cash offer shortly after load. |
| `trade-declined` | Live result: Koli declines my railroad-for-cash offer shortly after load. |

The toolbar also has buttons that push a live update through the same path a
real Realtime event would (so dice animation, the card overlay, fresh log
rows and sounds all react the same way they would against the real backend):
**opponent rolls & pays me rent**, **opponent buys**, **I roll (random)**,
**bot offers me a trade**, **bot starts an auction**, **force bot to move
now** (skips the ~1s beat a pending auction bid/drop or trade answer is
waiting out and fires it immediately -- useful for screenshotting the
*result* of a bot's move without waiting). Ending your turn auto-plays the
bots' turns with ~1s beats between moves, same as watching real opponents
act, until it is your turn again; a bot that lands on an unowned property
and skips buying starts an auction about half the time, so you can end up
bidding from the "waiting" side of an auction you didn't start.

**Known gaps in the mock** (`src/dev/mockSupabase.js`): the actions the
Client and the Board actually call are implemented (`roll`, `move`/debug-jump,
`buy`, `build`, `pay_jail`, `use_jail_card`, `end_turn`, `leave`,
`auction_start`, `auction_bid`, `auction_drop`, `trade_offer`, `trade_accept`,
`trade_decline`, `trade_cancel`, `trade_counter`, `new_game`/`reset_board`,
`skip_turn`) -- no `join` or multi-room support (beyond `createGame` handing
back a fresh code), because the harness only ever needs one seeded room at a
time. `leave` is a no-op resolve rather than actually removing the
player: it still cancels a pending trade the leaver was party to, but an
auction the leaver was bidding in is left untouched instead of the real
server's `in`/`order`/`leader` surgery (spec §1), since nobody is ever
actually removed from `Players` here. The Chance deck has 6 cards and
Community has 5 (one of every card `kind` used elsewhere, including
`payEach`/`repairs`/`collectEach`), not the full 15/16 from the SQL. Bots buy
opportunistically but never build houses or make jail decisions beyond the
default roll. Auction bots bid up to a random private limit (55-115% of list
price, never above their money minus $50) and answer trade offers by
comparing list-price-plus-cash value on both sides, occasionally countering
instead of declining -- see that file's `decideAuctionBot`/`decideTradeBot`
for the exact numbers. Rejection messages match the server's exact wording
from the spec (`It is not your turn to bid`, `There is already a pending
offer`, `<Header> has buildings in its colour set`, ...), and a stale
`trade_accept` (the offer's cell changed hands since it was made) succeeds
rather than erroring, clearing the trade with an `expired` event carrying a
`reason` string -- see `trade-expired`.

---

## Offline TV preview

A dev-only harness that opens the big-screen Board (`/`, exported as `Main`
from `src/Pages/Board.jsx`) against the same mocked backend as the phone's
"Offline client preview" above -- every board state can be viewed, played and
screenshotted with no Supabase project, no phones, and no `.env`. It never
ships (same guarantee as the phone harness: `mockSupabasePlugin` in
`vite.config.js` only swaps in `src/dev/mockSupabase.js` for
`command === "serve"` with `VITE_MOCK=1`, so `npm run build` never touches
`tv-harness.html` or anything under `src/dev/`).

**Run it:**

```
npm run dev:mock
```

then open `http://localhost:3000/tv-harness.html`. Pick a starting state with
the toolbar in the corner, or the URL directly:
`http://localhost:3000/tv-harness.html?s=tv-rich`.

**Query params:**

| Param | Effect |
|---|---|
| `?s=<name>` | scenario, see the table below |
| `?chrome=0` | hides the dev toolbar entirely, so it never overlaps the TV canvas in a screenshot |
| `?phone=1` | **linked mode**: the TV and a phone (playing as Afo) share one live game, see below |

**Scenarios:**

| Name | What it shows |
|---|---|
| `tv-idle` | 4 players mid-game, a bot's turn, nothing happening yet. |
| `tv-my-turn` | Afo's turn, ready to roll. |
| `tv-doubles` | Afo rolled doubles shortly after load: roll again. |
| `tv-card-chance` | A Chance card flies in from the deck ~700ms after load. |
| `tv-card-chest` | A Community Chest card flies in from the deck ~700ms after load. |
| `tv-auction-no-bids` | Auction just started on LOL, no bids yet. |
| `tv-auction-leader` | An auction on LOL with a current high bidder. |
| `tv-trade-pending` | A bot-to-bot trade offer sits pending (long answer delay, for a screenshot). |
| `tv-trade-counter` | Live result: Koli sends Ero a counter-offer ~700ms after load. |
| `tv-trade-accepted` | Live result: a bot-to-bot trade is accepted ~700ms after load. |
| `tv-trade-declined` | Live result: a bot-to-bot trade is declined ~700ms after load. |
| `tv-game-over` | Game over: Ero is the last player standing. |
| `tv-two-players` | Only two players seated: Ero and Afo. |
| `tv-rich` | Worst case: all 28 ownable cells owned, full colour sets with houses and a hotel, long Cyrillic names, one player jailed, one bankrupt. |
| `tv-empty-room` | The room exists but nobody has joined yet (empty-room hint). |
| `tv-no-room` | No room id anywhere (URL or localStorage) -- the Board's enter-code / Host New Game screen. |
| `tv-moving` | Ero moves 9 tiles (wrapping past Start) ~1s after load, then Koli moves 3 tiles ~2.4s after load -- for the flying-token animation. |
| `tv-autoplay` | All four seats are bots: the game plays itself indefinitely (~1.2s beats), including auctions and occasional bot-to-bot trades -- a living demo. |

These are a separate list from the phone's scenarios above (`mockDev.tvScenarios`
vs. `mockDev.scenarios` in `src/dev/mockSupabase.js`): the `tv-` prefix is
stable and the phone harness's own dropdown is unaffected.

The toolbar's **Board controls** group calls `new_game` / `skip_turn` on the
mock exactly like the real Board's buttons (`gameAction(uuid, "new_game", {
position })` / `gameAction(uuid, "skip_turn", {})`), plus a **Host New Game**
button that calls `createGame` with a fresh random room code. `new_game` /
`reset_board` mirror `supabase/migrations/20260919100000_auction_trade.sql`'s
branch exactly: every seated player's money resets to $2500, position to the
fresh board's start cell, jail/bankrupt flags clear, ownership and houses are
wiped from the payload's board regardless of what it carried, the turn goes
back to player 0, and the event log restarts empty. `skip_turn` mirrors the
same migration's auction rule: mid-auction it drops whoever is up to bid
(`auction.turn`) instead of moving the game turn; outside an auction it
cancels a pending trade and moves to the next player, same as before auctions
existed.

**Linked mode** (`?phone=1`): renders two same-origin **iframes** side by
side -- `tv-harness.html?s=<scenario>&chrome=0&embed=1` on the left and
`client-harness.html?s=<scenario>&chrome=0&link=1` on the right inside a
390x844 phone frame, logged in as Afo. This is "the TV follows the Live
phone": actions on the phone drive the TV live, and vice versa.

Two iframes, not a single page split with CSS, because the TV canvas scales
itself to *the window* (`scale = min(innerWidth/1920, innerHeight/1080)`,
see `design-reference/tv-board-reference.md`) -- a same-page split would make
that measurement include the phone's panel and scale the board wrong. An
iframe has its own `window`, so the Board's own scaling logic needs no
special-casing for linked mode.

How the bridge works (`src/dev/mockSupabase.js`'s `enableLinkBridge()`): each
iframe loads its own copy of the mock module (an iframe is its own JS realm
even same-origin), so nothing is shared unless copied across by hand.

- The **phone iframe is the authority** (`&link=1`): it runs the one real,
  validated `gameAction`/bot pipeline and publishes every row it produces
  over a `BroadcastChannel` (with a same-origin `storage`-event fallback for
  when `BroadcastChannel` is unavailable).
- The **TV iframe is a follower** (`&embed=1`): it never runs an action
  against its own local room while linked. It overwrites its local room with
  whatever the phone publishes (so `useFetch`/`useRealtimeUpdates`/Board see
  it exactly like a real update), and forwards its own action attempts
  (the Board's `new_game`/`skip_turn`, or anything else that calls
  `gameAction`) to the phone instead of applying them locally.
- A follower that connects after the authority already has state sends one
  `request_sync` message on load so it doesn't have to wait for the next
  organic action.

**Limits:** both iframes load with the same `?s=` and must agree on the
scenario at load time -- the linked-mode toolbar changes the *outer* page's
URL and remounts both iframes from scratch (a full reload each) rather than
hot-swapping a running pair's scenario. The bridge only carries whole rows
and forwarded action attempts, nothing else (no cursor sync, no chat). It is
inert for every normal single-page scenario: `enableLinkBridge()` is only
ever called when `?link=1` or `&embed=1` is present, so opening
`tv-harness.html` or `client-harness.html` on their own opens no channel and
adds no listeners.

**Debug hook:** `window.__tvRow` always holds the most recent row the TV's
own `useFetch`/`useRealtimeUpdates` subscription received (kept current by a
small `<TvRowProbe>` in `src/dev/tvHarness.jsx` that rides the same two
hooks Board itself uses, without reaching into Board's own internals) --
useful for a script driving this page headlessly to assert on `game.seq`
without scraping the DOM. `window.mockDev`, `window.mockGameAction` and
`window.mockCreateGame` are exposed the same way the phone harness exposes
them.

---

## Offline login preview

A dev-only harness that opens the Login screen (`/Login`, `src/Login/`) in
every state it can be in -- nothing typed, a room found with seats already
taken, a code no room answers to, a full room, a returning player, a join the
server refuses, a figure going grey live under your thumb -- against the same
mocked backend as the two harnesses above. No Supabase project, no second
phone, no `.env`. It never ships (same guarantee: `mockSupabasePlugin` in
`vite.config.js` only swaps in `src/dev/mockSupabase.js` for
`command === "serve"` with `VITE_MOCK=1`, so `npm run build` never touches
`login-harness.html` or anything under `src/dev/`).

**Run it:**

```
npm run dev:mock
```

then open `http://localhost:3000/login-harness.html`. Pick a starting state
with the toolbar in the corner, or the URL directly:
`http://localhost:3000/login-harness.html?s=login-full`.

**Query params:**

| Param | Effect |
|---|---|
| `?s=<name>` | scenario, see the table below |
| `?chrome=0` | hides the dev toolbar entirely, for a clean screenshot |

**Scenarios:**

| Name | What it shows |
|---|---|
| `login-empty` | Nothing typed yet: no room code, no name, no figure. The four characters stand in the aura, dimmed. |
| `login-open` | Code prefilled, room found, nobody in it yet: every figure free. |
| `login-found` | Code prefilled, room found, 2 of 4 seats taken (Imp and Specter are gone). **Default.** |
| `login-not-found` | A code no room answers to -- the status line says so, and a join attempt returns "Room v6Pstf not found". |
| `login-full` | All four seats taken: every figure silhouetted, "Room is full". |
| `login-returning` | `localStorage.playerInfo` matches a player in the room: the hero is their own character and the button reads "Rejoin as Afo". |
| `login-join-error` | The next join is rejected with "Figure is already taken" (a bot took it a moment before you pressed). |
| `login-live-take` | A second player joins ~1.5s after load: a figure goes grey and the status line counts up, live, with nothing tapped. |

Each scenario seeds `localStorage.roomId` / `localStorage.playerInfo` before
the screen's first render (the Login page reads both in a lazy state
initialiser), so switching scenarios in the toolbar remounts the router.

A successful join navigates to `/Client`; this harness answers that route with
a stub that just says `→ /Client` rather than mounting the real controller --
what is being previewed here is the login screen.

The toolbar's one live button, **"Another phone joins now"**
(`window.mockDev.botJoinsNow()`), takes the first free figure through the same
validated `join` action a second player would, at any moment.

`window.mockDev` and `window.mockGameAction` are exposed the same way the
other two harnesses expose them.

**What the mock's `join` does:** it mirrors the SQL's `join` branch
(`supabase/migrations/20260919100000_auction_trade.sql`) check for check and
word for word -- already in the room is a no-op rejoin, then "Room is full"
past four players, then "Figure is already taken" -- because the login screen
shows `error.message` to the player verbatim.

---

## Auctions and trading (server)

Added by `supabase/migrations/20260919100000_auction_trade.sql`. It **must be
applied after** `20260918160000_game_log.sql` (and therefore after
`20260918140000_game_rules.sql`, whose `mono_*` helpers it builds on). It only
replaces `game_action` and adds new `mono_*` helpers: no new column, no schema
change, no new grant on `public.test`.

New `game` keys: `auction` and `trade`. **Both keys always exist**; they hold
JSON `null` when nothing is running, exactly like `dice` / `lastCard` /
`winner`. New phase `game.phase = 'auction'`. New actions: `auction_start`,
`auction_bid`, `auction_drop`, `trade_offer`, `trade_accept`, `trade_decline`,
`trade_cancel`, `trade_counter`. `skip_turn` drops the current bidder while an
auction runs and otherwise behaves as before. The migration header lists the
exact payloads, state shapes and events.

### Run the SQL tests (offline, no Supabase project needed)

```
npm install          # once, for the @electric-sql/pglite devDependency
npm run test:sql
```

It spins up an in-process Postgres, applies **every** migration in
`supabase/migrations` in filename order, and scripts the full rule set: auction
and trading, a six-player group (5th/6th/7th join, all-six turn order and
auction rotation, the `current_order` clamp, the board upgrade to eight figure
keys), a jail-and-doubles group with dice forced via Postgres's `setseed` (all
three jail exits, the forced fine, doubles counting 1/2/3, Get Out Of Jail Free
in both decks), and a six-player random smoke test of a few hundred actions
that checks money conservation, single ownership per cell and the auction
invariants. As of today that is **81 tests**, all passing. It prints a `PASS` /
`FAIL` line per test and exits non-zero on any failure. `SEED=<n> npm run
test:sql` replays the random walk with a different seed.

The only thing the loader adds is the `anon` / `authenticated` / `service_role`
roles, which a hosted Supabase project has and a bare Postgres does not. The
migration files themselves are read verbatim.

### After you push the migration to the hosted project

Apply it with `supabase db push` or by pasting it into the SQL editor, then:

```sql
-- should return 6 rows: the new helpers
select proname from pg_proc
where proname in ('mono_tradable','mono_trade_valid','mono_trade_clear',
                  'mono_auction_advance','mono_give_cell','mono_json_without');

-- should return true for both: an untouched room reports them as null
select game ? 'auction', game ? 'trade' from public.test where uuid = 'v6Pstf';
```

Old rooms need nothing: a room written by the previous function simply has no
`auction` / `trade` key, and the phone's `game?.auction ?? null` reads that as
null too. The first action in the room fills both keys in.

### Manual checklist (needs three to six phones)

Auction:

- [ ] **T61** Land on an unowned property and press **Pass**. The Board and
      every phone switch to the auction panel, showing the auctioned cell, not
      the cell you are standing on. The turn label reads "Auction".
- [ ] **T62** The bidding starts with the player **after** you; you bid last.
      Bankrupt players are not in the rotation at all.
- [ ] **T63** Bid buttons are live only on the phone whose move it is. The
      others show "Waiting", the current high bidder shows "Leading", a player
      who dropped shows "Dropped".
- [ ] **T64** The leader is never asked to bid against themselves: after a bid
      the move jumps over them.
- [ ] **T65** A bid below `high + 10`, one that is not a multiple of 10, or one
      above your money is rejected and nothing changes.
- [ ] **T66** Everybody drops: the property stays with the bank, no money moves
      and the log shows "No bids".
- [ ] **T67** One player bids, everyone else drops: they pay exactly their bid,
      own the cell, and the log shows the win. Their houses count stays 0.
- [ ] **T68** Everyone drops except you and nobody has bid: you still get a
      move and can bid $10 (or drop and leave it with the bank).
- [ ] **T69** During the auction, every other button is refused with "An
      auction is running": rolling, buying, building, paying out of jail,
      ending the turn, and every trade button.
- [ ] **T70** Press **Skip Turn** on the Board during an auction. It drops the
      player whose move it is; the game turn does *not* move on.
- [ ] **T71** When the auction ends you are back in your own turn: **End Turn**
      works, and if you had rolled doubles you roll again.
- [ ] **T72** Press **Leave** on a phone mid-auction. If they were the high
      bidder the bid resets to nothing; if they were the one to move the move
      goes to the next player; if they were the player who started the auction
      it still finishes, and afterwards it is the next player's turn to roll.
- [ ] **T73** Press **New Game** during an auction. It disappears completely.

Trading:

- [ ] **T74** The **Trade** tab can only send an offer on your own turn, before
      or after rolling. On someone else's turn it explains why not.
- [ ] **T75** A property whose colour set has any house or hotel cannot be put
      into an offer. Railroads and utilities always can.
- [ ] **T76** Only one offer exists at a time; a second one is refused.
- [ ] **T77** The receiving phone gets the offer overlay immediately, with
      "You get" / "You give" from *their* point of view. Escape does nothing;
      only the three buttons close it.
- [ ] **T78** **Accept**: both properties and both cash amounts move in one go,
      every screen agrees, and the total money in the room is unchanged.
- [ ] **T79** Land on a property you just traded away. The rent goes to the
      **new** owner.
- [ ] **T80** **Decline** and **Cancel** (Cancel only on the sender's phone)
      leave everything untouched.
- [ ] **T81** **Counter** from the receiving phone flips the offer around and
      can be sent at any time, even when it is not their turn. The original
      sender can then accept it off-turn.
- [ ] **T82** Make an offer, then have the property change hands (another trade
      or a bankruptcy) before it is answered. Accepting it shows **Expired**
      in the log and moves nothing. *(The server clears it instead of raising
      an error: one call is one transaction, so an error would roll the
      clearing back and the dead offer would block the room forever.)*
- [ ] **T83** **End Turn**, **Skip Turn** and **Pass** (auction) all cancel a
      pending offer. So does either party pressing **Leave**.
- [ ] **T84** Bankrupt one of the two parties (let them land on a hotel). The
      pending offer expires by itself.
- [ ] **T85** The event log on every screen shows the new rows with the right
      names and amounts, and it still stops at 40 entries.
