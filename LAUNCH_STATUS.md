# Monopoly – Launch Status

Snapshot of the repo as of 2026-09-18 (last commit `9af8235`, 2024-10-12).
Stack: React 18 + Vite, react-router 6, styled-components, Supabase Realtime, Lordicon/Lottie icons.

Three screens exist:

| Route     | File                     | Purpose                                              |
|-----------|--------------------------|------------------------------------------------------|
| `/Login`  | `src/Pages/Login.jsx`    | Enter name + room code, pick a figure, join / rejoin |
| `/Client` | `src/Pages/Client.jsx`   | Phone view for one player (dice, cards, money)       |
| `/`       | `src/Board/BoardScreen.jsx` (re-exported by `src/Pages/Board.jsx`) | Big-screen / TV view of the whole board |

Game state is one Supabase row (`position`, `Players`, `current_order`) in table `test`, keyed by `uuid`. Schema: `supabase/migrations/20260904123000_create_test_game_table.sql`.
Every write is one call to the `game_action(room, action, payload)` Postgres function (`20260918140000_game_rules.sql`, which replaces the first version from `20260918120000_game_action_rpc.sql`). It locks the row, rolls the dice, and applies the whole landing (rent, tax, card, jail, bankruptcy) server-side. A fourth column `game` holds the turn state (phase, dice, doubles, events of the last action, last card, winner).
Every client subscribes to UPDATE events on that table and re-renders.

---

## 1. Features that exist and work

### Login / lobby
- Name and room-code (UUID) inputs with styled form controls.
- Figure picker with 4 figures; figures already taken by other players are disabled in real time.
- Returning-player detection via `localStorage.playerInfo`, button switches to "ReJoin To Game".
- New player is written to Supabase with $2500, position 0, next turn-order slot, and a generated `playerId`.
- Player token is placed on cell 1 (Start) on join.

### Board (TV) view
Rebuilt 2026-09-18 to the owner's prototype (`design-reference/tv-board-reference.md`) and moved to `src/Board/`. It shares the phone controller's design tokens: the root carries `data-client=""`, so the `[data-client]` block in `styles/tokens.css` themes both, light or dark with the OS.
- One fixed **1920x1080 canvas** (`BoardScreen` + `useTvScale`) scaled with `transform: scale(min(w/1920, h/1080))`, centred and letterboxed on `--ground`; the scale is uncapped, so a 4K TV fills the screen. No scrollbars at any size. `useTvChrome` paints `<body>` and `theme-color` to match while it is mounted and restores both on unmount.
- Split **70 / 30**: a ~1282 x 1024 board and a ~550px right column.
- 40-cell board on an 11 x 11 grid (`BoardGrid` / `Tile`), 150px corners, 4px gaps: colour band on the board's inner edge, `Mark` icon or monogram, name (2 lines on the top/bottom rows, ellipsis elsewhere, `lang="ru"` for Cyrillic), price or a short label (`+200$` / `Card` / `Pay` / `In Jail` / `Rest` / `Unlucky`), house/hotel pips, an 18px owner dot in the owner's figure colour, and a ring on the tile in focus (the current player's, or the space being auctioned). Start is still bottom-right and the loop still runs clockwise from there — the orientation players already know. Every tile is one `role="img"` with a full label, and memoised, so a token moving never re-renders the board.
- Live player pieces (`TvTokens`) updated through Supabase Realtime: the **full-body character** each player picked at login (`Client/Figure.jsx`), standing with its feet in the tile's corner. A move flies the same element from its old tile to the new one in a single cartoon arc (squash-and-stretch from the feet, lean, transform only); longer moves get a longer, higher arc. `Hooks/useWalkingTokens.jsx` still has the `WALK` flag to hop cell by cell instead. Joins and leaves grow / shrink in place, and several players on one tile fan out and shrink so the tile's name stays readable.
- Board centre (`TvCenter`): the two decks, whose turn it is, the dice, and one overlay at a time — game over > auction > card > trade. The centre glow re-tints to the colour group of the tile in focus.
- Right column (`TvSide`): room code, one card per player (avatar, name, cash, deeds, where they are, `NOW` / `JAIL` / `OUT`), every property they own as colour swatches with pips, and the latest events.
- "New Game" (asks for confirmation while a game is running): fresh board, everyone back on Start with $2500, ownership and houses cleared, players keep their seats. "Skip Turn" for a player who closed their phone mid-turn — labelled "Skip bidder" during an auction, which is what the server does then. "Host New Game" creates a fresh room. Room loading / not-found / error states sit with those buttons.
- No room yet: a small enter-a-code / Host New Game screen (`RoomGate`), off the TV canvas since whoever types there is at a keyboard.
- Superseded, still on disk, no longer used by any screen: `Components/CardRenderer.jsx`, `Card_Map.jsx`, `FigureBox.jsx`, `TokenLayer.jsx`, `Chance.jsx`, `AnimatedNumbers.jsx` and the Board half of `styles/main.css`. `src/dev/harness.jsx` (the old token harness) still imports the first four.

### Client (phone) view
- Two 3D CSS dice with roll animation and a "You've got: N" reveal overlay.
- Roll button is disabled unless it is your turn; "Not Your Turn" label shown otherwise.
- Position advances by the dice sum, token moves on all screens, `Players[].position` saved to DB.
- Landing on a cell opens a full-screen card popup; a different card component exists for every cell type.
- **Dice are rolled by the server** (`roll`); the phone animates to the result and shows "You've got: N".
- **Doubles**: roll again after closing the popups; three doubles in a row go to jail.
- **Buy property**: streets, railroads and utilities (Buy / Pass popup with the rent table); money check on the server.
- **Rent is taken automatically** on landing on someone else's cell and shown as "Paid $X rent to NAME": street rent doubles with the full colour set and grows with houses / hotel; railroads 25 / 50 / 100 / 200; utilities 4x or 10x the dice.
- **Houses / hotels**: "+ House $N" / "Hotel $N" in the Houses drawer and on the owner popup; needs the whole colour set, builds evenly, cost 50 / 100 / 150 / 200 per board side. Stored in `position[id].houses` (5 = hotel).
- **Pay tax** on Tax / Luxury Tax cells (automatic, shown in the popup).
- **Chance / Community Chest**: 15 + 16 cards drawn on the server (move, nearest railroad / utility, collect, pay, pay / collect from every player, repairs, Get Out Of Jail Free, go to jail). "Take a card" reveals the text; a card that moves you opens the popup for the new cell too.
- **Jail**: Go To Jail cell, card and three doubles send you to cell 11. On your turn: "Roll for doubles", "Pay $50" or "Use card"; after three failed rolls the fine is taken and you move.
- **Bankruptcy**: when you cannot pay, everything goes to the creditor (or the bank), your token leaves the board and your turns are skipped. Last player standing wins; phones show the result, the TV shows a banner.
- Turn passes automatically to the next player when the last popup is closed (or comes back to you on doubles). After a refresh mid-turn an "End Turn" button appears instead.
- Mini 3-cell strip (previous / current / next) so the player can see where they are.
- "Houses" drawer: everything the player owns, straight from the board state in the DB (survives refresh and rejoin from another phone), grouped by colour set, with build buttons.
- Animated money counter in the top-right.
- **Leave**: removes the player, frees the figure, re-numbers turn order (keeping the others' relative order), fixes `current_order`, clears local storage.
- Server rejections ("Not enough money", "Not your turn", ...) show for a few seconds above the "Not Your Turn" label.
- Debug panel (dev build or `?debug` in the URL): pick any cell 1-40 and jump there. Replaces the old "Reset to cell 40" button.

### Shared / infra
- Supabase client, `useFetch`, `gameAction` (RPC wrapper), `createGame`, `useRealtimeUpdates` hooks.
- `Hooks/rules.js`: rent / house / jail numbers mirrored from the SQL, used for display and for enabling buttons.
- Board data definition (`baseState.jsx`) with 40 cells, colours, prices, cell-type flags (utilities now priced at 150; the unused `basePrice` is gone).
- Reusable `Button`, `FormInput`, `Icon` (Lordicon with colour override), animated `BG`.
- Card colour grouping helper (`groupByColor`).
- Subtle framer-motion animations via a shared `Components/Motion.jsx` (LazyMotion `domAnimation` only, honours OS reduce-motion): staggered login form, card popup enter/exit, player tokens pop in/out on cells, Board player rows and turn check mark, "Not Your Turn" label, Houses drawer rows, button/figure press feedback.

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
| **Room / game code** | Login code is saved and used by Client; Board takes `?room=` / localStorage, shows the code, and can host a new room. `join` rejects an unknown room, a full room (4) and a taken figure. | Login shows the rejection as an `alert`; no inline message. |
| **Footer nav (Home / Auction / Players)** | Rendered on Client | No click handlers. Auction screen and Players screen do not exist. |
| **"Cards" sidebar tab** | Rendered on the right edge, shows the count of Get Out Of Jail Free cards | No handler, opens nothing. |
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
- [x] Join by code: `game_action('join')` raises "Room X not found", "Room is full" (4) and "Figure is already taken"; Login shows the message and stays on the page.
- [x] Add Row Level Security and grants for `test` (in the migration; table name kept to match the code). Renaming the table is now optional.
- [x] Commit the schema as a migration (`supabase/migrations/20260904123000_create_test_game_table.sql`, includes the hard-coded `v6Pstf` room). Not yet applied to a database.
- [x] Apply the first three migrations to the hosted project.
- [ ] Apply `20260918140000_game_rules.sql` (new `game` column + full-rules `game_action`) to the hosted project and smoke-test it there. So far it has only run against an in-process Postgres (pglite): every action and card scripted, 400-turn random games, and a browser run of TV + 2 phones.
- [x] "Skip Turn" control on the Board for a player who closed the tab mid-turn. (No automatic timeout.)

### Clean-up before shipping
- [x] Delete dead code: `Pages/test.jsx` (guitar fretboard), `Components/Header.js` (hospital template, imports a missing `../dynamic.js`), `Components/Db.jsx`, empty `Client/ClientMoney.jsx`, unused hooks `buyCard.jsx`, `useUpdatePosition.jsx`, `useRemovePlayer.js` (duplicates of inline logic in `Client.jsx`).
- [x] Remove unused deps: `jquery`, `@googlemaps/react-wrapper`, `react-helmet`, `@tonaljs/core`, `idb`, `bootstrap` / `react-bootstrap` (only the CSS is imported), `react-router` (only `react-router-dom` is used, and it sits in devDependencies).
- [ ] Font Awesome Pro is loaded from `site-assets.fontawesome.com` in `index.html` and `fa-duotone` icons are used. Either use a licensed Pro kit or switch to free icons.
- [x] `index.html`: title is "NeonCatRider", description is the CRA default, `logo192.png` is referenced but missing.
- [ ] Finalise board content: language (Russian vs English), property names, consistent price table.
- [x] Replace the CRA boilerplate `README.md` with setup + how to host a game (basic version written; expand as features land).

### Deploy
- [x] Verify `npm run build` passes (Vite build verified 2026-09-04).
- [ ] Hosting with SPA rewrite to `index.html` (BrowserRouter is used). Build output is `dist/`.
- [ ] Hosted Supabase project with Realtime enabled on the game table.
- [ ] Smoke-test: 1 TV + 2-4 phones on a real network.

### Nice to have (post-launch)
- Auction when a player passes on a property.
- Trading between players, mortgages.
- Sound effects, turn timer, spectator link, loading / error states, basic tests.
