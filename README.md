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

## Supabase

The client connects with the URL and publishable key in
`src/Hooks/supabase.jsx`. The schema (table `test`, RLS, Realtime publication,
and the default room `v6Pstf`) lives in
`supabase/migrations/20260904123000_create_test_game_table.sql`. Apply it with
the Supabase CLI (`supabase db push`) or paste it into the SQL editor.

## Status

See `LAUNCH_STATUS.md` for what works, what is half done, and what is left
before launch.
