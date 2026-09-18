-- Running game log.
--
-- game_action already returned the events of the last action in `game.events`,
-- which is enough to react to but not enough to show a history: a client that
-- refreshes, rejoins from another phone or sleeps through a few turns has no
-- way to recover what it missed. Accumulating it client-side would come back
-- empty after every refresh, the same problem the Houses drawer used to have.
--
-- So the server keeps it. `game.log` is an array of the same event objects,
-- each tagged with the `seq` of the action it came from and the `by` playerId,
-- capped at the most recent 40 so the row stays small. Every screen therefore
-- shows the same history, and a fresh phone gets it on its first fetch.
--
-- Nothing else changes: same actions, same rules, same schema. This migration
-- only replaces the function from 20260918140000_game_rules.sql, which must be
-- applied first because the mono_* helpers it defines are still used.

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
  st         jsonb;
  players    jsonb;
  board      jsonb;
  gm       jsonb;
  turn       integer;
  n          integer;
  cells      integer;

  seq        integer;
  phase      text;
  doubles    integer;
  dice       jsonb;
  winner     text;

  me_idx     integer;
  me         jsonb;
  fig        text;
  money      integer;
  my_order   integer;
  in_jail    boolean;
  jail_turns integer;

  pid        text;
  cell_key   text;
  cell       jsonb;
  cell_id    integer;
  kind       text;
  price      integer;
  old_pos    integer;
  new_pos    integer;
  d1         integer;
  d2         integer;
  set_min    integer;
  active     integer;
  start_id   integer;
  new_log    jsonb;
  log_len    integer;
begin
  -- Lock the room for the rest of this transaction. Concurrent calls queue
  -- here and each one sees the previous one's result.
  select * into rec from public.test where uuid = room for update;
  if not found then
    raise exception 'Room % not found', room using errcode = 'P0002';
  end if;

  players := rec."Players";
  board   := rec.position;
  gm      := coalesce(rec.game, '{}'::jsonb);
  turn    := rec.current_order;
  n       := jsonb_array_length(players);
  cells   := (select count(*) from jsonb_object_keys(board));

  seq     := coalesce((gm->>'seq')::integer, 0) + 1;
  phase   := coalesce(gm->>'phase', 'roll');
  doubles := coalesce((gm->>'doubles')::integer, 0);
  dice    := case when jsonb_typeof(gm->'dice') = 'array' then gm->'dice' end;
  winner  := gm->>'winner';

  if jsonb_typeof(gm->'lastCard') is distinct from 'object' then
    gm := gm - 'lastCard';
  end if;

  st := jsonb_build_object('players', players, 'board', board, 'game', gm, 'events', '[]'::jsonb);

  -- Locate the acting player, if the payload names one.
  pid := payload->>'playerId';
  if pid is not null then
    me_idx := public.mono_idx(players, 'playerId', pid);
    if me_idx is not null then
      me         := players->me_idx;
      fig        := me->>'figure';
      money      := public.mono_money(st, me_idx);
      my_order   := (me->>'order')::integer;
      in_jail    := coalesce((me->>'inJail')::boolean, false);
      jail_turns := coalesce((me->>'jailTurns')::integer, 0);
    end if;
  end if;

  if action not in ('join', 'reset_board', 'new_game', 'skip_turn') and me is null then
    raise exception 'Player is not in this room' using errcode = 'P0002';
  end if;

  if action in ('roll', 'move', 'buy', 'build', 'pay_jail', 'use_jail_card', 'end_turn') then
    if phase = 'over' then
      raise exception 'The game is over';
    end if;
    if coalesce((me->>'bankrupt')::boolean, false) then
      raise exception 'You are bankrupt';
    end if;
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

    start_id := coalesce(public.mono_cell_of_kind(board, 'start'), 1);
    players := players || jsonb_build_array(jsonb_build_object(
      'name',      payload->>'name',
      'figure',    fig,
      'money',     2500,
      'position',  start_id,
      'order',     n,
      'playerId',  pid,
      'inJail',    false,
      'jailTurns', 0,
      'jailCards', 0,
      'bankrupt',  false
    ));
    board := jsonb_set(board, array[start_id::text, fig], 'true'::jsonb);
    st := jsonb_build_object('players', players, 'board', board, 'game', gm, 'events', '[]'::jsonb);
    st := public.mono_event(st, jsonb_build_object('type', 'join', 'figure', fig, 'name', payload->>'name'));

  -- -------------------------------------------------------------------------
  elsif action = 'roll' then
    if my_order <> turn then
      raise exception 'Not your turn';
    end if;
    if phase <> 'roll' then
      raise exception 'You already rolled, end your turn';
    end if;

    d1 := floor(random() * 6)::integer + 1;
    d2 := floor(random() * 6)::integer + 1;
    dice := jsonb_build_array(d1, d2);
    st := public.mono_event(st, jsonb_build_object(
      'type', 'roll', 'figure', fig, 'd1', d1, 'd2', d2, 'doubles', d1 = d2
    ));
    old_pos := greatest(coalesce((me->>'position')::integer, 1), 1);
    new_pos := ((old_pos - 1 + d1 + d2) % cells) + 1;

    if in_jail then
      doubles := 0;
      if d1 = d2 then
        st := public.mono_patch_player(st, me_idx, jsonb_build_object('inJail', false, 'jailTurns', 0));
        st := public.mono_event(st, jsonb_build_object('type', 'jailLeave', 'figure', fig, 'how', 'doubles'));
        st := public.mono_move_to(st, me_idx, new_pos, true);
        st := public.mono_land(st, me_idx, d1 + d2);
      else
        jail_turns := jail_turns + 1;
        if jail_turns >= 3 then
          -- third failed roll: pay the fine and move anyway
          st := public.mono_charge(st, me_idx, 50, null, 'jailFee');
          if not public.mono_is_bankrupt(st, me_idx) then
            st := public.mono_patch_player(st, me_idx, jsonb_build_object('inJail', false, 'jailTurns', 0));
            st := public.mono_event(st, jsonb_build_object('type', 'jailLeave', 'figure', fig, 'how', 'fee'));
            st := public.mono_move_to(st, me_idx, new_pos, true);
            st := public.mono_land(st, me_idx, d1 + d2);
          end if;
        else
          st := public.mono_patch_player(st, me_idx, jsonb_build_object('jailTurns', jail_turns));
          st := public.mono_event(st, jsonb_build_object('type', 'jailStay', 'figure', fig, 'turn', jail_turns));
        end if;
      end if;
    else
      if d1 = d2 then
        doubles := doubles + 1;
      else
        doubles := 0;
      end if;
      if doubles >= 3 then
        st := public.mono_jail(st, me_idx, 'doubles');
        doubles := 0;
      else
        st := public.mono_move_to(st, me_idx, new_pos, true);
        st := public.mono_land(st, me_idx, d1 + d2);
      end if;
    end if;
    if coalesce((st->'players'->me_idx->>'inJail')::boolean, false) then
      doubles := 0; -- sent to jail by the cell or a card: no extra turn
    end if;
    phase := 'act';

  -- -------------------------------------------------------------------------
  elsif action = 'move' then
    -- debug jump straight to a cell, no turn check; the landing still counts
    new_pos := (payload->>'to')::integer;
    if new_pos is null then
      raise exception 'move needs a target cell';
    end if;
    st := public.mono_move_to(st, me_idx, new_pos, false);
    st := public.mono_land(st, me_idx, coalesce((dice->>0)::integer, 3) + coalesce((dice->>1)::integer, 4));

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
    price := public.mono_price(cell);
    if price is null then
      raise exception 'This cell is not for sale';
    end if;
    if public.mono_owner(cell) is not null then
      raise exception 'Already owned';
    end if;
    if money < price then
      raise exception 'Not enough money';
    end if;

    st := jsonb_set(st, array['board', cell_key, 'bought', fig], 'true'::jsonb);
    st := public.mono_patch_player(st, me_idx, jsonb_build_object('money', money - price));
    st := public.mono_event(st, jsonb_build_object(
      'type', 'buy', 'figure', fig, 'cell', cell_key::integer, 'amount', price
    ));

  -- -------------------------------------------------------------------------
  elsif action = 'build' then
    cell_key := payload->>'cell';
    cell     := board->cell_key;
    if cell is null then
      raise exception 'Cell % does not exist', cell_key;
    end if;
    cell_id := cell_key::integer;
    if public.mono_cell_kind(cell) <> 'street' then
      raise exception 'Houses can only be built on streets';
    end if;
    if public.mono_owner(cell) is distinct from fig then
      raise exception 'You do not own this street';
    end if;
    if not public.mono_owns_set(board, fig, cell->>'color') then
      raise exception 'You need the whole colour set first';
    end if;
    if coalesce((cell->>'houses')::integer, 0) >= 5 then
      raise exception 'There is already a hotel here';
    end if;
    -- build evenly: no street of the set may fall more than one house behind
    select min(coalesce((c.value->>'houses')::integer, 0)) into set_min
      from jsonb_each(board) as c
     where public.mono_cell_kind(c.value) = 'street'
       and c.value->>'color' = cell->>'color';
    if coalesce((cell->>'houses')::integer, 0) > set_min then
      raise exception 'Build on the other streets of this colour first';
    end if;
    price := public.mono_house_price(cell_id);
    if money < price then
      raise exception 'Not enough money';
    end if;

    st := jsonb_set(st, array['board', cell_key, 'houses'],
      to_jsonb(coalesce((cell->>'houses')::integer, 0) + 1));
    st := public.mono_patch_player(st, me_idx, jsonb_build_object('money', money - price));
    st := public.mono_event(st, jsonb_build_object(
      'type', 'build', 'figure', fig, 'cell', cell_id, 'amount', price,
      'houses', coalesce((cell->>'houses')::integer, 0) + 1
    ));

  -- -------------------------------------------------------------------------
  elsif action = 'pay_jail' then
    if my_order <> turn then
      raise exception 'Not your turn';
    end if;
    if not in_jail then
      raise exception 'You are not in jail';
    end if;
    if phase <> 'roll' then
      raise exception 'You already rolled';
    end if;
    if money < 50 then
      raise exception 'Not enough money';
    end if;
    st := public.mono_patch_player(st, me_idx, jsonb_build_object(
      'money', money - 50, 'inJail', false, 'jailTurns', 0
    ));
    st := public.mono_event(st, jsonb_build_object('type', 'pay', 'figure', fig, 'to', null, 'amount', 50, 'reason', 'jailFee'));
    st := public.mono_event(st, jsonb_build_object('type', 'jailLeave', 'figure', fig, 'how', 'pay'));

  -- -------------------------------------------------------------------------
  elsif action = 'use_jail_card' then
    if my_order <> turn then
      raise exception 'Not your turn';
    end if;
    if not in_jail then
      raise exception 'You are not in jail';
    end if;
    if phase <> 'roll' then
      raise exception 'You already rolled';
    end if;
    if coalesce((me->>'jailCards')::integer, 0) < 1 then
      raise exception 'You have no Get Out Of Jail Free card';
    end if;
    st := public.mono_patch_player(st, me_idx, jsonb_build_object(
      'jailCards', (me->>'jailCards')::integer - 1, 'inJail', false, 'jailTurns', 0
    ));
    st := public.mono_event(st, jsonb_build_object('type', 'jailLeave', 'figure', fig, 'how', 'card'));

  -- -------------------------------------------------------------------------
  elsif action = 'end_turn' then
    if my_order <> turn then
      raise exception 'Not your turn';
    end if;
    if phase <> 'act' then
      raise exception 'Roll first';
    end if;
    if doubles > 0
       and not coalesce((st->'players'->me_idx->>'inJail')::boolean, false)
       and not public.mono_is_bankrupt(st, me_idx) then
      -- doubles: same player rolls again
      st := public.mono_event(st, jsonb_build_object('type', 'again', 'figure', fig, 'doubles', doubles));
    else
      turn := public.mono_next_turn(st->'players', turn);
      doubles := 0;
      st := public.mono_event(st, jsonb_build_object('type', 'turn', 'order', turn));
    end if;
    phase := 'roll';

  -- -------------------------------------------------------------------------
  elsif action = 'skip_turn' then
    if phase = 'over' then
      raise exception 'The game is over';
    end if;
    turn := public.mono_next_turn(st->'players', turn);
    doubles := 0;
    phase := 'roll';
    st := public.mono_event(st, jsonb_build_object('type', 'skip', 'order', turn));

  -- -------------------------------------------------------------------------
  elsif action = 'leave' then
    st := jsonb_set(st, '{board}', public.mono_transfer_assets(st->'board', fig, null));
    players := (st->'players') - me_idx;

    -- keep the remaining players in their old relative turn order, 0..n-1
    select coalesce(jsonb_agg(s.p || jsonb_build_object('order', s.i - 1) order by s.i), '[]'::jsonb)
      into players
      from (
        select p, row_number() over (order by (p->>'order')::integer) as i
          from jsonb_array_elements(players) as p
      ) as s;

    n := jsonb_array_length(players);
    if my_order < turn then
      turn := turn - 1;
    elsif my_order = turn then
      -- it was their turn: the next player starts fresh
      phase := 'roll';
      doubles := 0;
      turn := turn - 1;
      turn := public.mono_next_turn(players, turn);
    end if;
    if n = 0 or turn >= n or turn < 0 then
      turn := 0;
    end if;
    st := jsonb_set(st, '{players}', players);
    st := public.mono_event(st, jsonb_build_object('type', 'leave', 'figure', fig));

  -- -------------------------------------------------------------------------
  elsif action in ('new_game', 'reset_board') then
    if jsonb_typeof(payload->'position') <> 'object' then
      raise exception '% needs a position object', action;
    end if;
    board := payload->'position';
    start_id := coalesce(public.mono_cell_of_kind(board, 'start'), 1);

    -- everyone keeps their seat, everything else starts over
    select coalesce(jsonb_agg(
             p || jsonb_build_object(
               'money', 2500, 'position', start_id, 'inJail', false,
               'jailTurns', 0, 'jailCards', 0, 'bankrupt', false
             ) order by (p->>'order')::integer), '[]'::jsonb)
      into players
      from jsonb_array_elements(players) as p;
    -- no tokens, no owners, no houses, whatever the payload carried
    select jsonb_object_agg(e.key, (e.value - 'houses') || jsonb_build_object(
             'fig0', false, 'fig1', false, 'fig2', false, 'fig3', false,
             'bought', jsonb_build_object(
               'fig0', false, 'fig1', false, 'fig2', false, 'fig3', false)))
      into board
      from jsonb_each(board) as e;
    for cell in select p->'figure' from jsonb_array_elements(players) as p loop
      board := jsonb_set(board, array[start_id::text, cell#>>'{}'], 'true'::jsonb);
    end loop;

    turn    := 0;
    phase   := 'roll';
    doubles := 0;
    dice    := null;
    winner  := null;
    gm    := '{}'::jsonb;
    st := jsonb_build_object('players', players, 'board', board, 'game', gm, 'events', '[]'::jsonb);
    st := public.mono_event(st, jsonb_build_object('type', 'newGame'));

  else
    raise exception 'Unknown action %', action;
  end if;

  -- -------------------------------------------------------------------------
  -- After the action

  players := st->'players';
  board   := st->'board';
  n       := jsonb_array_length(players);

  -- a bankrupt player cannot finish their turn: move on
  if phase <> 'over' and n > 0 then
    me_idx := public.mono_idx(players, 'order', turn::text);
    if me_idx is not null and public.mono_is_bankrupt(st, me_idx) then
      turn := public.mono_next_turn(players, turn);
      doubles := 0;
      phase := 'roll';
    end if;
  end if;

  -- last one standing wins
  select count(*) into active
    from jsonb_array_elements(players) as p
   where not coalesce((p->>'bankrupt')::boolean, false);
  if winner is null and n >= 2 and active = 1 then
    select p->>'figure' into winner
      from jsonb_array_elements(players) as p
     where not coalesce((p->>'bankrupt')::boolean, false);
    phase := 'over';
    st := public.mono_event(st, jsonb_build_object('type', 'win', 'figure', winner));
  end if;
  if winner is not null then
    phase := 'over';
  end if;

  -- Running history. Every event of this action is tagged with the seq and the
  -- acting player, appended to whatever was there, and the oldest entries are
  -- dropped so the row cannot grow without bound. new_game starts it empty,
  -- because that branch resets gm to '{}'.
  new_log := case when jsonb_typeof(gm->'log') = 'array' then gm->'log' else '[]'::jsonb end;

  new_log := new_log || (
    select coalesce(jsonb_agg(e || jsonb_build_object('seq', seq, 'by', pid)), '[]'::jsonb)
      from jsonb_array_elements(st->'events') as e
  );

  log_len := jsonb_array_length(new_log);
  if log_len > 40 then
    select coalesce(jsonb_agg(t.v order by t.i), '[]'::jsonb)
      into new_log
      from jsonb_array_elements(new_log) with ordinality as t(v, i)
     where t.i > log_len - 40;
  end if;

  gm := jsonb_build_object(
    'seq',      seq,
    'phase',    phase,
    'doubles',  doubles,
    'dice',     dice,
    'actor',    pid,
    'action',   action,
    'events',   st->'events',
    'lastCard', st->'game'->'lastCard',
    'winner',   winner,
    'log',      new_log
  );

  update public.test
     set position      = board,
         "Players"     = players,
         current_order = least(greatest(turn, 0), 3),
         game          = gm
   where uuid = room
  returning * into rec;

  return rec;
end;
$$;

comment on function public.game_action(text, text, jsonb) is
  'Applies one game action to a room under a row lock. See 20260918140000_game_rules.sql for the action list.';

revoke all on function public.game_action(text, text, jsonb) from public;
grant execute on function public.game_action(text, text, jsonb) to anon, authenticated;

-- game_action runs as the caller (security invoker), so the caller also needs
-- execute on the mono_* helpers. Functions grant execute to public by
-- default; that default is left in place on purpose.
