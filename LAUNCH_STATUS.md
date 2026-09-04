# Monopoly – Launch Status

Snapshot of the repo as of 2026-09-04 (last commit `9af8235`, 2024-10-12).
Stack: React 18 (CRA), react-router 6, styled-components, Supabase Realtime, Lordicon/Lottie icons.

Three screens exist:

| Route     | File                     | Purpose                                              |
|-----------|--------------------------|------------------------------------------------------|
| `/Login`  | `src/Pages/Login.jsx`    | Enter name + room code, pick a figure, join / rejoin |
| `/Client` | `src/Pages/Client.jsx`   | Phone view for one player (dice, cards, money)       |
| `/`       | `src/Pages/Board.js`     | Big-screen / TV view of the whole board              |

Game state is one Supabase row (`position`, `Players`, `current_order`) in table `test`, keyed by `uuid`. Schema: `supabase/migrations/20260904123000_create_test_game_table.sql`.
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
- 40-cell board rendered on an 11x11 CSS grid, all cell types (street, railroad, utility, tax, chance, community, jail, go-to-jail, parking, start).
- Live player tokens on cells (`FigureBox`) updated through Supabase Realtime.
- Owned properties get an animated border in the owner's figure colour.
- Player panel: figure, name, animated money counter, and a check mark on whoever's turn it is.
- Chance / Bonus centre placeholders.
- "Click" button resets all board positions to the initial state.

### Client (phone) view
- Two 3D CSS dice with roll animation and a "You've got: N" reveal overlay.
- Roll button is disabled unless it is your turn; "Not Your Turn" label shown otherwise.
- Position advances by the dice sum, token moves on all screens, `Players[].position` saved to DB.
- Landing on a cell opens a full-screen card popup; a different card component exists for every cell type.
- **Buy property**: money check, money deducted, `bought[figure]` set on the cell, board border updates, players list saved.
- **Pay rent** when landing on another player's street: payer -price/10, owner +price/10 (flat rate).
- **Pay tax** on Tax / Luxury Tax cells.
- Turn passes automatically to the next player when the card popup is closed.
- Mini 3-cell strip (previous / current / next) so the player can see where they are.
- "Houses" sidebar: all properties the player owns, grouped and ordered by colour set.
- Animated money counter in the top-right.
- Bought cards persisted in `localStorage` so they survive a refresh.
- **Leave**: removes the player, frees the figure, re-numbers turn order, clears local storage.
- Reset button moves the player to cell 40.

### Shared / infra
- Supabase client, `useFetch`, `updateDB`, `useRealtimeUpdates` hooks.
- Board data definition (`baseState.jsx`) with 40 cells, colours, prices, cell-type flags.
- Reusable `Button`, `FormInput`, `Icon` (Lordicon with colour override), animated `BG`.
- Card colour grouping helper (`groupByColor`).

---

## 2. Features that are half done

| Feature | What exists | What is missing |
|---|---|---|
| **Chance cards** | Board cell, centre placeholder, popup card that says "Take A Card" | Button only logs `IMPLEMENT ME!!`. No deck, no card texts, no effects (move, pay, collect). |
| **Community Chest** | Same as Chance | Same as Chance. |
| **Start / GO** | Cell, popup "You receive 200$", "Get Money" button | Button is a no-op. Passing GO never awards $200. |
| **Railroads** | 4 cells, popup with Buy / Pass | Buy is a no-op; railroads cannot be owned, no rent. |
| **Utilities (Light / Water)** | 2 cells, popup with Pay / Pass | Pay is a no-op; utilities cannot be owned, no dice-based rent. |
| **Jail** | Cell, popup "Oh No Sister! You Stuck!" with Pay $200 | No jail mechanic: nothing sends you to jail, no skipped turns, no pay/roll to leave. |
| **Go To Jail** | Cell, popup with "Go" | Button is a no-op; player is not moved. |
| **Free Parking** | Cell, popup "Stay" | Button is a no-op (acceptable, but still logs `IMPLEMENT ME`). |
| **Houses / hotels** | Owner popup shows 1-4 houses + hotel rent table and prices | "Buy" logs `IMPLEMENT ME`. House count is not stored anywhere, rent ignores houses. |
| **Colour-set bonus** | "Colour Set Price" shown on cards | Monopoly (full colour set) is never detected; rent is always flat price/10. |
| **Rent amounts** | Flat price/10 | Real rent table per property, house/hotel multipliers, railroad count, utility dice multiplier. |
| **Room / game code** | Login asks for a UUID; `ShortUniqueId` is imported | Board and Client hard-code `uuid = "v6Pstf"`. Whatever you type on Login is ignored. No "create game" flow. |
| **Footer nav (Home / Auction / Players)** | Rendered on Client | No click handlers. Auction screen and Players screen do not exist. |
| **"Cards" sidebar tab** | Rendered on the right edge | No handler, opens nothing. |
| **Board reset** | "Click" button on Board | Resets cell positions only. Players' money, ownership and turn order are not reset. |
| **Bought cards on rejoin** | Ownership is in DB (`bought`), sidebar list is in `localStorage` | Rejoining from another device shows an empty "Houses" sidebar. Should be rebuilt from `pos[].bought`. |
| **Dice doubles** | Two dice rolled | No extra turn on doubles, no three-doubles-to-jail. |
| **Money floor** | Buy checks funds | Rent and tax do not; money can go negative. No bankruptcy. |
| **Game end** | Nothing | No winner detection, no "game over", no restart. |
| **Board content** | 40 named cells (mixed Russian / English, inside-joke names) | Prices are inconsistent (`price` vs `basePrice` disagree, e.g. Dota 2 = 100 / 400). Decide final names, language and price table. |

---

## 3. Remaining for launch

### Must fix (blocking bugs)
- [ ] **Position wrap is wrong**: `updatePos` wraps at 36 but the board has 40 cells. Cells 37-40 are unreachable and the lap is short. Wrap at 40 and award $200 on passing GO.
- [ ] **Hard-coded room id** `"v6Pstf"` in `Board.js` and `Client.jsx`. Read it from the Login input / URL / localStorage.
- [ ] **Supabase URL is a LAN IP** (`http://192.168.10.85:54321`) with the local demo anon key, hard-coded in `src/Hooks/supabase.jsx`. Move to `.env` (`REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`) and point at a hosted project.
- [ ] **Client crashes without login**: `JSON.parse(localStorage.playerInfo)` throws on `/Client` if the player never logged in. Redirect to `/Login` instead.
- [ ] **Realtime leak**: `useRealtimeUpdates` never unsubscribes and re-subscribes on every render (callback is not memoized). Duplicate handlers fire after a while. Return a cleanup and memoize the callback.
- [ ] **Lost updates**: every client overwrites the whole `position` and `Players` JSON. Two clients acting at once clobber each other (e.g. rent paid while another player buys). Use per-field updates, an RPC, or optimistic concurrency.
- [ ] **Silent DB errors**: `updateDB` swallows every error. Surface failures to the user.
- [ ] `alert(0)` debug popup on wrong-turn click, `console.log` noise, `class=` instead of `className` in `Board.js`.

### Core gameplay to finish (from section 2)
- [ ] Chance and Community Chest decks with real effects.
- [ ] Railroads and utilities purchasable with correct rent.
- [ ] Jail: go-to-jail, in-jail turns, pay / roll doubles to leave.
- [ ] Houses / hotels: buy, store count in `position[id]`, use in rent.
- [ ] Colour-set detection and doubled rent.
- [ ] $200 for passing GO.
- [ ] Doubles rule.
- [ ] Bankruptcy, elimination, winner, "new game".
- [ ] Rebuild "Houses" sidebar from DB ownership instead of localStorage.
- [ ] Full board reset (money, ownership, order) from the Board view.

### Rooms / multiplayer
- [ ] Create-game flow: generate a code, insert a fresh row with `initialState()`, show the code on the Board view.
- [ ] Join by code: validate that the row exists, cap at 4 players.
- [x] Add Row Level Security and grants for `test` (in the migration; table name kept to match the code). Renaming the table is now optional.
- [x] Commit the schema as a migration (`supabase/migrations/20260904123000_create_test_game_table.sql`, includes the hard-coded `v6Pstf` room). Not yet applied to a database.
- [ ] Handle a player closing the tab mid-turn (turn never advances). Add a timeout or a "skip turn" control on the Board.

### Clean-up before shipping
- [x] Delete dead code: `Pages/test.jsx` (guitar fretboard), `Components/Header.js` (hospital template, imports a missing `../dynamic.js`), `Components/Db.jsx`, empty `Client/ClientMoney.jsx`, unused hooks `buyCard.jsx`, `useUpdatePosition.jsx`, `useRemovePlayer.js` (duplicates of inline logic in `Client.jsx`).
- [x] Remove unused deps: `jquery`, `@googlemaps/react-wrapper`, `react-helmet`, `@tonaljs/core`, `idb`, `bootstrap` / `react-bootstrap` (only the CSS is imported), `react-router` (only `react-router-dom` is used, and it sits in devDependencies).
- [ ] Font Awesome Pro is loaded from `site-assets.fontawesome.com` in `index.html` and `fa-duotone` icons are used. Either use a licensed Pro kit or switch to free icons.
- [x] `index.html`: title is "NeonCatRider", description is the CRA default, `logo192.png` is referenced but missing.
- [ ] Finalise board content: language (Russian vs English), property names, consistent price table.
- [ ] Replace the CRA boilerplate `README.md` with setup + how to host a game.

### Deploy
- [x] Verify `npm run build` passes (verified 2026-09-04, warnings only).
- [ ] Hosting with SPA rewrite to `index.html` (BrowserRouter is used).
- [ ] Hosted Supabase project with Realtime enabled on the game table.
- [ ] Smoke-test: 1 TV + 2-4 phones on a real network.

### Nice to have (post-launch)
- Auction when a player passes on a property.
- Trading between players, mortgages.
- Sound effects, turn timer, spectator link, loading / error states, basic tests.
