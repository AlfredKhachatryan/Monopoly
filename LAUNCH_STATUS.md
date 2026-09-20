# Monopoly – Launch Status

Snapshot as of 2026-09-20. Everything described below as new for 2026-09-20
(six players, sound cues, reconnect handling, the auction/trade UI polish, the
TV/phone visual work) is committed on the branch `playtest-prep-2026-09-20`,
cut from `main` at `12429e7`, and has **not** been merged to `main` yet. First
real playtest with six friends is tomorrow.
Stack: React 18 + Vite, react-router 6, styled-components, Supabase Realtime, Lordicon/Lottie icons, lucide-react icons.

Three screens exist:

| Route     | File                     | Purpose                                              |
|-----------|--------------------------|------------------------------------------------------|
| `/Login`  | `src/Login/LoginScreen.jsx` (re-exported by `src/Pages/Login.jsx`) | Enter name + room code, pick a figure, join / rejoin |
| `/Client` | `src/Client/ClientScreen.jsx` | Phone view for one player (dice, cards, money)  |
| `/`       | `src/Board/BoardScreen.jsx` (re-exported by `src/Pages/Board.jsx`) | Big-screen / TV view of the whole board |

Game state is one Supabase row (`position`, `Players`, `current_order`) in table `test`, keyed by `uuid`, seating up to **6 players** across **8 selectable figures** (`fig0`..`fig7`; `MAX_PLAYERS` / `FIGS` / `FIG_COLORS` in `src/Hooks/rules.js`). Schema: `supabase/migrations/20260904123000_create_test_game_table.sql`.
Every write is one call to the `game_action(room, action, payload)` Postgres function, redefined in full by each of `20260918120000_game_action_rpc.sql` → `20260918140000_game_rules.sql` → `20260919100000_auction_trade.sql` → `20260920100000_six_players.sql` (current version). It locks the row, rolls the dice, and applies the whole landing (rent, tax, card, jail, bankruptcy, auctions, trades) server-side. A fourth column `game` holds the turn state (phase, dice, doubles, auction, trade, events of the last action, last card, winner, a capped log).
Every client subscribes to UPDATE events on that table and re-renders.

---

## 1. Features that exist and work

### Login / lobby
- Name and room-code (UUID) inputs with styled form controls.
- Figure picker with **8 figures** (Imp, Cyclops, Specter, Yeti, Bat, Mummy, Octo, Slime = `fig0`..`fig7`) laid out 4-across over 2 rows (`src/Login/FigurePicker.jsx`); figures already taken by other players are disabled in real time and shown as a silhouette with the taker's name.
- **Room cap is 6 players** (`MAX_PLAYERS` in `src/Hooks/rules.js`); a full room shows "Room is full".
- Join errors (unknown room, full room, figure already taken) show as an **inline message** above the join button — the old `alert()` boxes are gone.
- Returning-player detection via `localStorage.playerInfo`, button switches to "ReJoin To Game".
- New player is written to Supabase with $2500, the board's start cell, next turn-order slot, and a generated `playerId`.
- Player token is placed on Start on join.

### Board (TV) view
Rebuilt 2026-09-18 to the owner's prototype (`design-reference/tv-board-reference.md`) and moved to `src/Board/`, then re-balanced 2026-09-20 for six players. It shares the phone controller's design tokens: the root carries `data-client=""`, so the `[data-client]` block in `styles/tokens.css` themes both, light or dark with the OS.
- One fixed **1920x1080 canvas** (`BoardScreen` + `useTvScale`) scaled with `transform: scale(min(w/1920, h/1080))`, centred and letterboxed on `--ground`; the scale is uncapped, so a 4K TV fills the screen. No scrollbars at any size. `useTvChrome` paints `<body>` and `theme-color` to match while it is mounted and restores both on unmount.
- Re-balanced 2026-09-20: a **bigger board** (1364 x 1048, up from 1282 x 1024) and a narrower **500px right column** (down from 550px), so the board reads better at a distance without starving the six-player side panel.
- 40-cell board on an 11 x 11 grid (`BoardGrid` / `Tile`), 158px corners, 4px gaps: colour band on the board's inner edge, `Mark` icon or monogram, name (2 lines on the top/bottom rows, ellipsis elsewhere, `lang="ru"` for Cyrillic), price or a short label (`+200$` / `Card` / `Pay` / `In Jail` / `Rest` / `Unlucky`), house/hotel pips, an 18px owner dot in the owner's figure colour, and a ring on the tile in focus (the current player's, or the space being auctioned). Start is still bottom-right and the loop still runs clockwise from there — the orientation players already know. Every tile is one `role="img"` with a full label, and memoised, so a token moving never re-renders the board. **Up to 6 tokens can share one tile** (fanned out and shrunk so the tile's name stays readable).
- Live player pieces (`TvTokens`) updated through Supabase Realtime: the **full-body character** each player picked at login (`Client/Figure.jsx`), standing with its feet in the tile's corner. A move flies the same element from its old tile to the new one in a single cartoon arc (squash-and-stretch from the feet, lean, transform only); longer moves get a longer, higher arc. `Hooks/useWalkingTokens.jsx` still has the `WALK` flag to hop cell by cell instead. Joins and leaves grow / shrink in place.
- Board centre (`TvCenter`): the two decks, whose turn it is, the dice (shared `RollDice` component with the phone — see the dice bug fix below), and one overlay at a time — game over > auction > card > trade. The centre glow re-tints to the colour group of the tile in focus. **Doubles / jail beats** now play here too: progressive 1st/2nd/3rd-double effects with heat pips, and a BUSTED state on the third.
- Right column (`TvSide`): room code, one card per player (avatar, name, cash, deeds, where they are, `NOW` / `JAIL` / `OUT`, a Get Out Of Jail Free tag when they hold one), **colour-group deed slots that collapse into one solid chip once a set is complete**, and the latest events. New **density steps** (`.d0`-`.d3` in `tvSide.module.css`) squeeze the per-player card as the room fills toward 5-6 players, so a full room does not overflow the column.
- "New Game" (asks for confirmation while a game is running): fresh board, everyone back on Start with $2500, ownership and houses cleared, players keep their seats. **"Skip Turn" was promoted to the primary (filled) button and moved first** in the control row on 2026-09-20 — it is what the host reaches for several times an evening — while "New Game" and "Host New Game" are now quiet outline buttons at the end of the row. "Skip Turn" reads "Skip bidder" during an auction, which is what the server does then. Room loading / not-found / error states sit with those buttons.
- No room yet: a small enter-a-code / Host New Game screen (`RoomGate`), off the TV canvas since whoever types there is at a keyboard.
- New **Minecraft-style board mark** (`src/Images/marks/minecraft.svg`, used via `src/Client/marks.js` / `src/Board/fitName.js` / `src/Hooks/baseState.jsx`).
- Solid 3D dice: the front face used to have no transform at all (an empty `--f` custom property is *removed*, not set to identity, so `var(--f)` had nothing to fall back to and computed to `none`), which showed straight through the die. Fixed with a `var(--f, rotateY(0deg))` fallback in `rollDice.module.css`.
- Superseded, still on disk, no longer used by any screen: `Components/CardRenderer.jsx`, `Card_Map.jsx`, `FigureBox.jsx`, `TokenLayer.jsx`, `Chance.jsx`, `AnimatedNumbers.jsx` and the Board half of `styles/main.css`. `src/dev/harness.jsx` (the old token harness) still imports the first four.

### Client (phone) view
- Two 3D CSS dice with roll animation and a "You've got: N" reveal overlay. **The front face is now solid** (see the TV section above for the `--f` bug and fix — the same `RollDice` component serves both screens).
- Roll button is disabled unless it is your turn; "Not Your Turn" label shown otherwise.
- Position advances by the dice sum, token moves on all screens, `Players[].position` saved to DB.
- Landing on a cell opens a full-screen card popup; a different card component exists for every cell type.
- **Dice are rolled by the server** (`roll`); the phone animates to the result and shows "You've got: N".
- **Doubles**: roll again after closing the popups; progressive **1st/2nd/3rd-double beats** (heat pips, sound + haptic cues `doubles` / `doublesHot` / `busted`, a BUSTED banner on the third) via `src/Hooks/useSound.js`; three doubles in a row jails you without resolving whatever the roll would have landed on.
- **Buy property**: streets, railroads and utilities (Buy / Pass popup with the rent table); money check on the server.
- **Rent is taken automatically** on landing on someone else's cell and shown as "Paid $X rent to NAME": street rent doubles with the full colour set and grows with houses / hotel; railroads 25 / 50 / 100 / 200; utilities 4x or 10x the dice.
- **Houses / hotels**: "+ House $N" / "Hotel $N" in the Houses drawer and on the owner popup; needs the whole colour set, builds evenly, cost 50 / 100 / 150 / 200 per board side. Stored in `position[id].houses` (5 = hotel). A **Build pill only shows on buildable owned streets**.
- **Pay tax** on Tax / Luxury Tax cells (automatic, shown in the popup).
- **Chance / Community Chest**: 15 + 16 cards drawn on the server (move, nearest railroad / utility, collect, pay, pay / collect from every player, repairs, Get Out Of Jail Free, go to jail). "Take a card" reveals the text; a card that moves you opens the popup for the new cell too. A Get Out Of Jail Free card is not tradable and shows on the **Deeds** sheet with a "not tradable" label.
- **Jail**: Go To Jail cell, card or three doubles send you to jail. On your turn: "Roll for doubles", "Pay $50" or "Use card"; after three failed rolls the fine is taken and you move (which can bankrupt you). Leaving jail by doubles moves you but grants no extra roll. A jailed player still collects rent, bids in an auction and answers a trade.
- **Auctions**: passing on an unowned property starts one (`src/Client/AuctionPanel.jsx`, mirrored on the TV by `src/Board/TvAuction.jsx`); rotation starts with the player after the one who passed, skips the leader, and every other action is refused while it runs.
- **Trading**: a Trade sheet (`src/Client/sheets/TradeSheet.jsx`, mirrored by `src/Board/TvTrade.jsx`) offers cells/cash both ways, with accept/decline/cancel/counter; a colour set with any houses cannot be offered.
- **Bankruptcy**: when you cannot pay, everything goes to the creditor (or the bank), your token leaves the board and your turns are skipped. Last player standing wins; phones show the result, the TV shows a banner.
- Turn passes automatically to the next player when the last popup is closed (or comes back to you on doubles). After a refresh mid-turn an "End Turn" button appears instead.
- Mini 3-cell strip (previous / current / next) so the player can see where they are.
- Bottom nav (`src/Client/BottomNav.jsx`, lucide-react icons): **Deeds**, **Players**, **Trade**, **Game** — all four open a real sheet now.
- "Deeds" sheet: everything the player owns, straight from the board state in the DB (survives refresh and rejoin from another phone), grouped by colour set, with build buttons and the jail-free card if held.
- "Game" sheet: the event log, **collapsed to the last 6 rows with "Show all (N)" / tap-to-expand rows**, room code, sound toggle, a manual **"Reconnect / refresh state"** button, and Leave.
- Animated money counter in the top-right.
- **Leave**: removes the player, frees the figure, re-numbers turn order (keeping the others' relative order), fixes `current_order`, clears local storage.
- Server rejections ("Not enough money", "Not your turn", ...) show for a few seconds above the "Not Your Turn" label.
- **Connection badge** (`src/Components/ConnectionBadge.jsx`): hidden while the connection is healthy, otherwise shows "Connecting…" / "Reconnecting…" / "Offline — check Wi-Fi" with a manual Reconnect button, on both the phone and the TV.
- Debug panel (dev build or `?debug` in the URL): pick any cell and jump there. **Ignores jail state** — do not use it on a jailed player during the playtest.

### Shared / infra
- Supabase client, `useFetch`, `gameAction` (RPC wrapper), `createGame`, `useRealtimeUpdates` hooks.
- **Reconnect handling** (`src/Hooks/connection.js`): a watchdog + backoff state machine shared by the real Supabase module and the offline mock. Resyncs the room on the tab becoming visible, `pageshow` (iOS bfcache), `online`, focus, a channel resubscribe, and a 20s heartbeat refetch while visible; guards against a stale row via `game.seq`; probes for a socket that claims to be live but never echoed our own write. Deliberately **no automatic retry of the action itself** — only of the connection and the refetch. Dev-only `window.__conn()` inspects live connections. Supabase Realtime's own heartbeat is lowered to **15s** in `src/Hooks/supabase.jsx` (from the default 30s).
- `Hooks/rules.js`: rent / house / jail numbers mirrored from the SQL, used for display and for enabling buttons; also the single source for `FIGS`, `FIG_COLORS` and `MAX_PLAYERS` (6 players, 8 figures).
- Board data definition (`baseState.jsx`) with 40 cells, colours, prices, cell-type flags (utilities now priced at 150; the unused `basePrice` is gone).
- Reusable `Button`, `FormInput`, `Icon` (Lordicon with colour override), animated `BG`.
- Card colour grouping helper (`groupByColor`).
- Subtle framer-motion animations via a shared `Components/Motion.jsx` (LazyMotion `domAnimation` only, honours OS reduce-motion): staggered login form, card popup enter/exit, player tokens pop in/out on cells, Board player rows and turn check mark, "Not Your Turn" label, Houses drawer rows, button/figure press feedback.
- Sound cues (`src/Hooks/useSound.js`): synthesised WebAudio, no audio files; unlocked on first tap; includes `doubles` / `doublesHot` / `busted` as of today.
- New offline preview scenarios in `src/dev/scenarios.js` for today's work: six-player (`six-players`, `six-players-not-my-turn`, `tv-six-players`) and jail/doubles (`jail-in-jail-card`, `jail-in-jail-no-card`, `jail-in-jail-last-chance`, `jail-gtj-cell`, `jail-doubles-1`, `jail-doubles-2`, `jail-doubles-3`, plus the TV-side `tv-jail-in-jail-card`, `tv-jail-gtj-cell`, `tv-jail-doubles-3`).

---

## 2. Features that are half done

| Feature | What exists | What is missing |
|---|---|---|
| **Chance cards** | Deck of 15 on the server, drawn and applied on landing, text shown on the phone and the TV | Done. Cards are drawn at random with replacement (no discard pile). |
| **Community Chest** | Deck of 16, same mechanism | Done. |
| **Start / GO** | Passing or landing on Start pays $200 (in `updatePos`); popup just confirms it | Done. |
| **Railroads** | Purchasable, rent 25 / 50 / 100 / 200 by count owned, doubled from the Chance card | Done. |
| **Utilities (Light / Water)** | Purchasable at 150, rent 4x / 10x the dice | Done. |
| **Jail** | In-jail turns, roll doubles / pay $50 / Get Out Of Jail Free card, forced fine after 3 rolls | Done. |
| **Go To Jail** | Moves the token to Jail and sets the jail state | Done. |
| **Free Parking** | Popup with OK, nothing happens | Done (no house-rule jackpot). |
| **Houses / hotels** | Build from the drawer or the owner popup, even-build rule, shown on the TV | Done. No selling houses back, no mortgages. |
| **Colour-set bonus** | Detected on the server, rent doubled without houses, required for building | Done. |
| **Rent amounts** | price/10 base, x2 set, x5 / x15 / x45 / x60 / x75 with houses / hotel; railroads and utilities as above | Done. One formula for every street instead of the official per-street table; tweak in `mono_rent` + `rules.js` if wanted. |
| **Room / game code** | Login code is saved and used by Client; Board takes `?room=` / localStorage, shows the code, and can host a new room. `join` rejects an unknown room, a full room (6) and a taken figure. | Done. Rejections show inline above the button, not as an `alert`. |
| **Bottom nav (Deeds / Players / Trade / Game)** | All four buttons open a real sheet | Done. |
| **Auctions** | Full server + UI (`AuctionPanel`/`TvAuction`), rotation, bidding, drop | Done. |
| **Trading** | Full server + UI (`TradeSheet`/`TvTrade`), offer/accept/decline/cancel/counter | Done. No mortgages. |
| **Board reset** | "New Game" on the Board resets board, money, positions, houses, turn | Done. Players keep their seats and join order. |
| **Bought cards on rejoin** | Houses drawer is built from `position[].bought` | Done; `localStorage.boughtCards` is no longer used. |
| **Dice doubles** | Extra roll on doubles, three in a row go to jail | Done. |
| **Money floor** | Every charge checks funds; going below zero means bankruptcy | Done. |
| **Game end** | Winner when one player is left, banner on the TV, status on the phones, New Game | Done. No time limit / richest-player ending. |
| **Board content** | 40 named cells (mixed Russian / English, inside-joke names) | Prices are inconsistent (`price` vs `basePrice` disagree, e.g. Dota 2 = 100 / 400). Decide final names, language and price table. |

---

## 3. Remaining for launch

### Must fix (blocking bugs)
- [x] **Position wrap** fixed: `updatePos` wraps at 40, so cells 37-40 are reachable, and pays $200 when the lap wraps.
- [x] **Hard-coded room id** removed. Login saves the typed code to `localStorage.roomId` (prefilled from `?room=`); Client reads it; Board reads `?room=` / localStorage or asks for it, and shows the code on screen. Realtime is filtered per room.
- [x] **Supabase config** moved to `.env` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, see `.env.example`); points at the hosted project.
- [x] **Client crashes without login**: now redirects to `/Login` when `playerInfo` or `roomId` is missing.
- [x] **Realtime leak**: `useRealtimeUpdates(uuid, cb)` keeps the callback in a ref, subscribes once per room with a `uuid=eq.` filter, and removes the channel on unmount.
- [x] **Lost updates** fixed: all writes go through the `game_action` RPC (`join`, `move`, `buy`, `pay_rent`, `pay_tax`, `end_turn`, `leave`, `reset_board`). It does `select ... for update` on the room row and applies the action to the DB state, so concurrent phones serialise instead of overwriting each other. It also enforces "it's your turn" for `move` / `end_turn`, "you stand on that cell" for `buy` / rent / tax, and "not already owned" / "enough money" for `buy`. Needs migration `20260918120000_game_action_rpc.sql` applied. `updateDB` is gone.
- [x] **Silent DB errors**: `gameAction` logs and returns `{ data, error }`. Client shows the server message inline for 4 s; Login shows it in an `alert`. (A proper toast component is still nice-to-have.)
- [x] **Phantom card popup** after a refresh: `prevPos` is now seeded from the first fetch, so someone else's action no longer re-opens the card for the cell you already stand on (which used to end their turn).
- [x] `alert(0)` popup and debug `console.log`s removed (the last `IMPLEMENT ME` placeholders went with the `Card_info.jsx` rewrite).

### Core gameplay to finish (from section 2)
All done in `20260918140000_game_rules.sql` + the Client / Board rewrite (2026-09-18). Verified with a scripted pglite test of every action and card, 400-turn random games, and a browser run (TV + 2 phones) through the real UI. Never run against the hosted Supabase project or a real phone: see `TESTING.md` for the manual test plan that covers that gap.
- [x] Chance and Community Chest decks with real effects.
- [x] Railroads and utilities purchasable with correct rent.
- [x] Jail: go-to-jail, in-jail turns, pay / roll doubles to leave.
- [x] Houses / hotels: buy, store count in `position[id]`, use in rent.
- [x] Colour-set detection and doubled rent.
- [x] $200 for passing GO.
- [x] Doubles rule.
- [x] Bankruptcy, elimination, winner, "new game".
- [x] Rebuild "Houses" sidebar from DB ownership instead of localStorage.
- [x] Full board reset (money, ownership, order) from the Board view.

### Rooms / multiplayer
- [x] Create-game flow: "Host New Game" on the Board view generates a 6-char code, inserts a fresh row with `initialState()`, shows the code and sets `?room=`. Needs migration `20260908120000_allow_create_game.sql` applied (insert grant + policy).
- [x] Join by code: `game_action('join')` raises "Room X not found", "Room is full" (6) and "Figure is already taken"; Login shows the message inline and stays on the page.
- [x] Add Row Level Security and grants for `test` (in the migration; table name kept to match the code). Renaming the table is now optional.
- [x] Commit the schema as a migration (`supabase/migrations/20260904123000_create_test_game_table.sql`, includes the hard-coded `v6Pstf` room). Not yet applied to a database.
- [x] Apply the first three migrations to the hosted project.
- [ ] Apply `20260918140000_game_rules.sql` (new `game` column + full-rules `game_action`) to the hosted project.
- [ ] Apply `20260918160000_game_log.sql` (the capped event log in `game.log`) to the hosted project.
- [ ] Apply `20260919100000_auction_trade.sql` (auctions + trading, new `game.auction`/`game.trade` keys) to the hosted project.
- [ ] Apply `20260920100000_six_players.sql` (6-player cap, 8 figures, board upgrade to eight figure keys) to the hosted project — **must go last**, see `TESTING.md` §0.1.
- None of the four pending migrations, nor anything built on them, has run anywhere but an in-process Postgres (pglite) and headless/local browser testing — see `TESTING.md` for the manual plan that covers the gap before tomorrow.
- [x] "Skip Turn" control on the Board for a player who closed the tab mid-turn. (No automatic timeout.)

### Clean-up before shipping
- [x] Delete dead code: `Pages/test.jsx` (guitar fretboard), `Components/Header.js` (hospital template, imports a missing `../dynamic.js`), `Components/Db.jsx`, empty `Client/ClientMoney.jsx`, unused hooks `buyCard.jsx`, `useUpdatePosition.jsx`, `useRemovePlayer.js` (duplicates of inline logic in `Client.jsx`).
- [x] Remove unused deps: `jquery`, `@googlemaps/react-wrapper`, `react-helmet`, `@tonaljs/core`, `idb`, `bootstrap` / `react-bootstrap` (only the CSS is imported), `react-router` (only `react-router-dom` is used, and it sits in devDependencies).
- [x] Font Awesome Pro dropped: the icons are now `lucide-react` (see `BottomNav.jsx` and the Game sheet); `src/CDN/fontAwesomePro.css` is unused dead weight, its import is already commented out in `main.jsx`.
- [x] `index.html` cleaned up: title "Monopoly", a real description, `manifest.json` references only `favicon.ico` (no missing `logo192.png`).
- [ ] Finalise board content: language (Russian vs English), property names, consistent price table.
- [x] Replace the CRA boilerplate `README.md` with setup + how to host a game (basic version written; expand as features land).

### Deploy
- [x] Verify `npm run build` passes (Vite build verified 2026-09-20, including today's sound-cue change).
- [ ] Hosting with SPA rewrite to `index.html` (BrowserRouter is used). Build output is `dist/`.
- [ ] Hosted Supabase project with Realtime enabled on the game table, and the four pending migrations applied (see Rooms / multiplayer above).
- [ ] Smoke-test: 1 TV + up to 6 phones on a real network. **Not verified anywhere yet**: the hosted Supabase project with the four pending migrations, any real phone, iOS Safari rendering of the 3D dice, real haptics, and six real devices on one Wi-Fi.

### Nice to have (post-launch)
- Mortgages, selling houses back.
- Turn timer, spectator link, a proper toast component (server rejections still show as inline text, not a toast).
- Broader automated coverage: `npm run test:sql` covers the server (81 tests) but there is no automated UI test.
