-- "Host New Game" on the Board view inserts a fresh room:
--   insert into test (uuid, position, "Players", current_order)
-- The first migration only granted select/update because the client never
-- inserted. Now it does, with the anon key, so anon needs insert too.
--
-- Anyone who can open the page can create rooms. That matches the existing
-- "whoever knows the code can play" model; the check constraints on the table
-- still bound what a row can contain.

grant insert on table public.test to anon, authenticated;

create policy "Anyone can create games"
  on public.test
  for insert
  to anon, authenticated
  with check (true);
