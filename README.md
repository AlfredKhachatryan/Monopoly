# Monopoly

Multiplayer Monopoly for a living room: one screen shows the board, every player
plays from their phone. React 18 + Vite on the front end, Supabase (Postgres +
Realtime) as the shared game state.

## Requirements

- Node 22+
- A Supabase project with the migration in `supabase/migrations/` applied

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

**Hosting a game:** open `/` on the TV and press **Host New Game**. It creates
a fresh room with an empty board, shows the code in the corner, and puts
`?room=<code>` in the address bar. Players then join with that code.
The migration also seeds one fixed room, `v6Pstf`.

## Supabase

The client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env`
(see `.env.example`; `.env` is gitignored). The schema (table `test`, RLS, Realtime publication,
and the default room `v6Pstf`) lives in `supabase/migrations/`. Apply all
migrations with the Supabase CLI (`supabase db push`) or paste them into the
SQL editor in order. The second migration adds the insert grant and policy
that **Host New Game** needs.

## Status

See `LAUNCH_STATUS.md` for what works, what is half done, and what is left
before launch.
