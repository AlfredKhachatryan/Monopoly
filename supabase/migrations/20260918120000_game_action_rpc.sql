-- Fix for lost updates.
--
-- Before this migration every client read the room row, changed its copy of
-- `position` / "Players" / current_order in JavaScript and wrote the whole
-- JSON back. Two phones acting at the same time (rent paid while another
-- player buys, a join during a move, ...) overwrote each other's change.
--
-- Now every game action is one call to game_action(room, action, payload).
-- The function locks the row (select ... for update), applies the change to
-- the current DB state inside that transaction and writes the result, so
-- concurrent actions are serialised and nothing is lost. The UPDATE it does
-- still goes out on Realtime, so subscribers are unchanged.
--
-- Actions (payload keys):
--   join        {name, figure, playerId}   add a player, token on cell 1
--   move        {playerId, steps}          dice roll, wraps at 40, +200 past Start
--   move        {playerId, to}             debug jump straight to a cell
--   buy         {playerId, cell}           buy the property you stand on
--   pay_rent    {playerId, cell}           flat rent price/10 to the owner
--   pay_tax     {playerId, cell}           pay the cell price to the bank
--   end_turn    {playerId}                 current_order -> next player
--   leave       {playerId}                 remove player, free figure, renumber
--   reset_board {position}                 Board "Click": replace the board
--
-- Errors are raised with a plain message ("Not enough money", "Room is full",
-- "Not your turn", ...) so the client can show it as is.

create or replace function public.game_action(
  room    text,
  action  text,
  payload jsonb default '{}'::jsonb
)
returns public.test
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rec        public.test%rowtype;
  players    jsonb;
  board      jsonb;
  turn       integer;
  n          integer;

  me_idx     integer;          -- 0-based index of the acting player in "Players"
  me         jsonb;
  fig        text;
  money      integer;

  cell_key   text;
  cell       jsonb;
  price      integer;
  rent       integer;

  old_pos    integer;
  new_pos    integer;
  steps      integer;
  passed     boolean := false;

  owner_fig  text;
  owner_idx  integer;
  owner      jsonb;

  pid        text;
begin
  -- Lock the room for the rest of this transaction. Concurrent calls queue
  -- here and each one sees the previous one's result.
  select * into rec from public.test where uuid = room for update;
  if not found then
    raise exception 'Room % not found', room using errcode = 'P0002';
  end if;

  players := rec."Players";
  board   := rec.position;
  turn    := rec.current_order;
  n       := jsonb_array_length(players);

  -- Locate the acting player, if the payload names one.
  pid := payload->>'playerId';
  if pid is not null then
    select t.i - 1, t.p
      into me_idx, me
      from jsonb_array_elements(players) with ordinality as t(p, i)
     where t.p->>'playerId' = pid;
    if me is not null then
      fig   := me->>'figure';
      money := (me->>'money')::numeric::integer;
    end if;
  end if;

  if action not in ('join', 'reset_board') and me is null then
    raise exception 'Player is not in this room' using errcode = 'P0002';
  end if;

  -- -------------------------------------------------------------------------
  if action = 'join' then
    if me is not null then
      return rec; -- already in the room: rejoin, nothing to change
    end if;

    fig := payload->>'figure';
    if pid is null or payload->>'name' is null or fig is null then
      raise exception 'name, figure and playerId are required';
    end if;
    if fig not in ('fig0', 'fig1', 'fig2', 'fig3') then
      raise exception 'Unknown figure %', fig;
    end if;
    if n >= 4 then
      raise exception 'Room is full';
    end if;
    if exists (
      select 1 from jsonb_array_elements(players) as p where p->>'figure' = fig
    ) then
      raise exception 'Figure is already taken';
    end if;

    players := players || jsonb_build_array(jsonb_build_object(
      'name',     payload->>'name',
      'figure',   fig,
      'money',    2500,
      'position', 0,
      'order',    n,
      'playerId', pid
    ));
    board := jsonb_set(board, array['1', fig], 'true'::jsonb);

  -- -------------------------------------------------------------------------
  elsif action = 'move' then
    old_pos := coalesce((me->>'position')::integer, 0);

    if payload ? 'to' then
      -- debug jump, no turn check
      new_pos := (payload->>'to')::integer;
    else
      steps := (payload->>'steps')::integer;
      if steps is null or steps < 1 or steps > 12 then
        raise exception 'Bad dice result %', steps;
      end if;
      if (me->>'order')::integer <> turn then
        raise exception 'Not your turn';
      end if;
      new_pos := old_pos + steps;
      if new_pos > 40 then          -- cells are 1..40, one wrap is enough
        new_pos := new_pos - 40;
        passed  := true;
      end if;
    end if;

    if not (board ? new_pos::text) then
      raise exception 'Cell % does not exist', new_pos;
    end if;

    -- take the token off every cell, then put it on the new one
    select jsonb_object_agg(e.key, jsonb_set(e.value, array[fig], 'false'::jsonb))
      into board
      from jsonb_each(board) as e;
    board := jsonb_set(board, array[new_pos::text, fig], 'true'::jsonb);

    me := me || jsonb_build_object(
      'position', new_pos,
      'money',    money + case when passed then 200 else 0 end
    );
    players := jsonb_set(players, array[me_idx::text], me);

  -- -------------------------------------------------------------------------
  elsif action = 'buy' then
    cell_key := payload->>'cell';
    cell     := board->cell_key;
    if cell is null then
      raise exception 'Cell % does not exist', cell_key;
    end if;
    if cell_key::integer <> coalesce((me->>'position')::integer, 0) then
      raise exception 'You are not standing on that cell';
    end if;
    price := (cell->>'price')::integer;
    if price is null
       or coalesce((cell->>'start')::boolean, false)
       or coalesce((cell->>'tax')::boolean, false)
       or coalesce((cell->>'chance')::boolean, false)
       or coalesce((cell->>'community')::boolean, false)
       or coalesce((cell->>'jail')::boolean, false)
       or coalesce((cell->>'GTJ')::boolean, false)
       or coalesce((cell->>'parking')::boolean, false) then
      raise exception 'This cell is not for sale';
    end if;
    if exists (
      select 1 from jsonb_each(coalesce(cell->'bought', '{}'::jsonb)) as b
       where b.value = 'true'::jsonb
    ) then
      raise exception 'Already owned';
    end if;
    if money < price then
      raise exception 'Not enough money';
    end if;

    board   := jsonb_set(board, array[cell_key, 'bought', fig], 'true'::jsonb);
    me      := me || jsonb_build_object('money', money - price);
    players := jsonb_set(players, array[me_idx::text], me);

  -- -------------------------------------------------------------------------
  elsif action = 'pay_rent' then
    cell_key := payload->>'cell';
    cell     := board->cell_key;
    if cell is null then
      raise exception 'Cell % does not exist', cell_key;
    end if;
    if cell_key::integer <> coalesce((me->>'position')::integer, 0) then
      raise exception 'You are not standing on that cell';
    end if;

    select b.key into owner_fig
      from jsonb_each(coalesce(cell->'bought', '{}'::jsonb)) as b
     where b.value = 'true'::jsonb
     limit 1;
    if owner_fig is null then
      raise exception 'Nobody owns this cell';
    end if;

    if owner_fig <> fig then
      price := coalesce((cell->>'price')::integer, 0);
      rent  := price / 10;                       -- flat rent, same as the client

      me      := me || jsonb_build_object('money', money - rent);
      players := jsonb_set(players, array[me_idx::text], me);

      select t.i - 1 into owner_idx
        from jsonb_array_elements(players) with ordinality as t(p, i)
       where t.p->>'figure' = owner_fig;
      if owner_idx is not null then
        owner   := players->owner_idx;
        owner   := owner || jsonb_build_object(
          'money', (owner->>'money')::numeric::integer + rent
        );
        players := jsonb_set(players, array[owner_idx::text], owner);
      end if;
    end if;

  -- -------------------------------------------------------------------------
  elsif action = 'pay_tax' then
    cell_key := payload->>'cell';
    cell     := board->cell_key;
    if cell is null then
      raise exception 'Cell % does not exist', cell_key;
    end if;
    if cell_key::integer <> coalesce((me->>'position')::integer, 0) then
      raise exception 'You are not standing on that cell';
    end if;
    price   := coalesce((cell->>'price')::integer, 0);
    me      := me || jsonb_build_object('money', money - price);
    players := jsonb_set(players, array[me_idx::text], me);

  -- -------------------------------------------------------------------------
  elsif action = 'end_turn' then
    if (me->>'order')::integer <> turn then
      raise exception 'Not your turn';
    end if;
    turn := (turn + 1) % greatest(n, 1);

  -- -------------------------------------------------------------------------
  elsif action = 'leave' then
    players := players - me_idx;

    -- keep the remaining players in their old relative turn order, 0..n-1
    select coalesce(jsonb_agg(s.p || jsonb_build_object('order', s.i - 1) order by s.i), '[]'::jsonb)
      into players
      from (
        select p, row_number() over (order by (p->>'order')::integer) as i
          from jsonb_array_elements(players) as p
      ) as s;

    n := jsonb_array_length(players);
    if (me->>'order')::integer < turn then
      turn := turn - 1;
    end if;
    if n = 0 or turn >= n then
      turn := 0;
    end if;

    select jsonb_object_agg(e.key, jsonb_set(e.value, array[fig], 'false'::jsonb))
      into board
      from jsonb_each(board) as e;

  -- -------------------------------------------------------------------------
  elsif action = 'reset_board' then
    if jsonb_typeof(payload->'position') <> 'object' then
      raise exception 'reset_board needs a position object';
    end if;
    board := payload->'position';

  else
    raise exception 'Unknown action %', action;
  end if;

  update public.test
     set position      = board,
         "Players"     = players,
         current_order = turn
   where uuid = room
  returning * into rec;

  return rec;
end;
$$;

comment on function public.game_action(text, text, jsonb) is
  'Applies one game action to a room under a row lock. See the migration header for the action list.';

-- Only the app roles may call it. It runs as the caller (security invoker),
-- so the existing select/update grants and RLS policies on public.test still
-- apply inside it.
revoke all on function public.game_action(text, text, jsonb) from public;
grant execute on function public.game_action(text, text, jsonb) to anon, authenticated;
