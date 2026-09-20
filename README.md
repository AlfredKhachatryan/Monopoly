# Monopoly

Multiplayer Monopoly for a living room: one screen shows the board, every player
plays from their phone. React 18 + Vite on the front end, Supabase (Postgres +
Realtime) as the shared game state.

## Requirements

- Node 22+
- A Supabase project with the migrations in `supabase/migrations/` applied, in order

## Run locally

```bash
npm install
cp .env.example .env   # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
```

The dev server listens on all interfaces on port 3000, so phones on the same
Wi-Fi can open `http://<your-pc-ip>:3000/Login`.

| Route     | Screen                                   |
|-----------|------------------------------------------|
| `/`       | Board view for the shared screen / TV    |
| `/Login`  | Enter name and room code, pick a figure  |
| `/Client` | Player's phone view (dice, cards, money) |

## Build

```bash
npm run build     # outputs to dist/
npm run preview   # serves dist/ locally
```

The app uses client-side routing, so the host must rewrite unknown paths to
`index.html`.

## Rooms

Every game is one row in the `test` table, identified by a short room code.

- TV / board: open `http://<host>:3000/?room=<code>`. The code is shown in the
  top-left corner. Without `?room=` the board falls back to the last room used
  in that browser, or asks for one.
- Phones: open `/Login` (or `/Login?room=<code>` to prefill), type the code,
  pick a figure. The code is remembered in `localStorage` for rejoining.
- A room holds up to **6 players**, choosing from **8 figures** (Imp, Cyclops,
  Specter, Yeti, Bat, Mummy, Octo, Slime — `MAX_PLAYERS` / `FIGS` in
  `src/Hooks/rules.js`).

**Hosting a game:** open `/` on the TV and press **Host New Game**. It creates
a fresh room with an empty board, shows the code in the corner, and puts
`?room=<code>` in the address bar. Players then join with that code.
The first migration also seeds one fixed room, `v6Pstf`.

## Supabase

The client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env`
(see `.env.example`; `.env` is gitignored). The schema (table `test`, RLS, Realtime publication,
and the default room `v6Pstf`) lives in `supabase/migrations/`, seven files
applied with the Supabase CLI (`supabase db push`) or pasted into the SQL
editor **in filename order** — later ones redefine `game_action` in full and
replace the previous version:

1. `20260904123000_create_test_game_table.sql` — the `test` table, RLS, and the seeded `v6Pstf` room.
2. `20260908120000_allow_create_game.sql` — the insert grant and policy that **Host New Game** needs.
3. `20260918120000_game_action_rpc.sql` — the first `game_action` function that every game write goes through; it locks the room row so players acting at the same time do not overwrite each other's changes.
4. `20260918140000_game_rules.sql` — replaces it with the full rules: the server rolls the dice and resolves the landing (rent, tax, Chance / Community Chest, jail, bankruptcy) in one transaction, and adds the `game` column that carries the turn state to every screen.
5. `20260918160000_game_log.sql` — adds the capped `game.log` event history.
6. `20260919100000_auction_trade.sql` — auctions and trading (`game.auction` / `game.trade`).
7. `20260920100000_six_players.sql` — widens the room to 6 players and 8 figures, and upgrades every existing room's board to match.

## Rules

- $2500 to start, $200 for passing Start.
- Streets, railroads and utilities can be bought when you land on them.
  Rent is taken automatically: street rent is price/10, doubled with the whole
  colour set, and x5 / x15 / x45 / x60 / x75 with 1-4 houses / a hotel;
  railroads 25 / 50 / 100 / 200 by count owned; utilities 4x or 10x the dice.
- Houses cost 50 / 100 / 150 / 200 per side of the board, need the full colour
  set and are built evenly. The fifth house is the hotel.
- Doubles roll again; three doubles go to jail. In jail: roll doubles, pay $50,
  or use a Get Out Of Jail Free card; after three failed rolls the fine is taken.
- If you cannot pay, you are bankrupt: everything goes to the creditor and your
  turns are skipped. The last player standing wins. **New Game** on the Board
  resets everything while keeping the seats.

## Status

See `LAUNCH_STATUS.md` for what works, what is half done, and what is left
before launch. `TESTING.md` is the manual test plan: what to check after
applying the migrations, and what is most likely to break.

The server rules also have an offline, no-Supabase-needed test suite:
`npm run test:sql` (81 tests as of today) spins up an in-process Postgres,
applies every migration, and scripts auctions, trading, six-player rules and
jail/doubles against it.
