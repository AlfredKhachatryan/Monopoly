-- Full game rules on the server.
--
-- Replaces game_action from 20260918120000_game_action_rpc.sql. The room
-- row is still locked per action; what changed is that the server now rolls
-- the dice itself and resolves everything that happens on a landing in the
-- same transaction (rent, tax, Chance / Community Chest card, Go To Jail,
-- bankruptcy). The client only asks for optional things (buy, build, pay to
-- leave jail) and reads back what happened from the new `game` column.
--
-- New column  public.test.game  (jsonb):
--   seq       integer   incremented on every action; clients use it to
--                       ignore an update they have already processed
--   phase     'roll'    the current player has to roll
--             'act'     they rolled and landed; end_turn is next
--             'over'    somebody won
--   doubles   integer   consecutive doubles thrown by the current player
--   dice      [d1, d2]  last roll
--   actor     text      playerId whose action produced `events`
--   action    text      that action
--   events    [...]     what happened, in order (see mono_* helpers):
--                       roll, move, collect, pay, land, card, jail,
--                       jailStay, jailLeave, buy, build, bankrupt, win, ...
--   lastCard  {deck, text, figure}   last Chance / Community card drawn
--   winner    text      figure of the winner once phase = 'over'
--
-- New per-player keys in "Players":  inJail, jailTurns, jailCards, bankrupt.
-- New per-cell key in position:      houses (0-4 houses, 5 = hotel).
--
-- Actions (payload keys):
--   join          {name, figure, playerId}
--   roll          {playerId}          server rolls two dice, moves, resolves
--                                     the landing (rent / tax / card / jail)
--   move          {playerId, to}      debug jump; resolves the landing too
--   buy           {playerId, cell}    street, railroad or utility you stand on
--   build         {playerId, cell}    one house (or the hotel) on your street
--   pay_jail      {playerId}          pay the fine at the start of your turn
--   use_jail_card {playerId}          spend a Get Out Of Jail Free card
--   end_turn      {playerId}          next player, or roll again on doubles
--   leave         {playerId}          remove player, release their property
--   skip_turn     {}                  Board: force the turn to the next player
--   new_game      {position}          Board: fresh board, money, positions
--   reset_board   {position}          alias of new_game (old Board button)
--
-- Rent (same numbers as src/Hooks/rules.js, keep them in sync):
--   street    price/10, doubled with the full colour set,
--             x5 / x15 / x45 / x60 / x75 with 1-4 houses / hotel
--   railroad  25 / 50 / 100 / 200 for 1-4 owned (x2 from a Chance card)
--   utility   4 x dice with one owned, 10 x dice with both (Chance: 10 x)
--   houses    50 / 100 / 150 / 200 per side of the board, hotel = 5th house
--   jail      $50 to leave; three failed rolls pay it automatically
--   Start     $200 for passing or landing

alter table public.test
  add column if not exists game jsonb not null default '{}'::jsonb;

alter table public.test
  drop constraint if exists test_game_is_object;
alter table public.test
  add constraint test_game_is_object check (jsonb_typeof(game) = 'object');

comment on column public.test.game is
  'Turn state: seq, phase, doubles, dice, actor, events of the last action, lastCard, winner. See 20260918140000_game_rules.sql.';

-- ---------------------------------------------------------------------------
-- Helpers. They all work on a "state" jsonb:
--   { players: [...], board: {...}, game: {...}, events: [...] }
-- and return the updated state, so game_action can chain them.
-- ---------------------------------------------------------------------------

create or replace function public.mono_cell_kind(cell jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce((cell->>'start')::boolean, false)     then 'start'
    when coalesce((cell->>'tax')::boolean, false)       then 'tax'
    when coalesce((cell->>'chance')::boolean, false)    then 'chance'
    when coalesce((cell->>'community')::boolean, false) then 'community'
    when coalesce((cell->>'jail')::boolean, false)      then 'jail'
    when coalesce((cell->>'GTJ')::boolean, false)       then 'gtj'
    when coalesce((cell->>'parking')::boolean, false)   then 'parking'
    when coalesce((cell->>'road')::boolean, false)      then 'road'
    when coalesce((cell->>'communal')::boolean, false)  then 'communal'
    else 'street'
  end;
$$;

-- Figure that owns the cell, or null.
create or replace function public.mono_owner(cell jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select b.key
    from jsonb_each(coalesce(cell->'bought', '{}'::jsonb)) as b
   where b.value = 'true'::jsonb
   limit 1;
$$;

-- Purchase price. Utilities never had a price in old boards: default 150.
create or replace function public.mono_price(cell jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case public.mono_cell_kind(cell)
    when 'street'   then (cell->>'price')::integer
    when 'road'     then coalesce((cell->>'price')::integer, 200)
    when 'communal' then coalesce((cell->>'price')::integer, 150)
    else null
  end;
$$;

create or replace function public.mono_house_price(cell_id integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when cell_id <= 10 then 50
    when cell_id <= 20 then 100
    when cell_id <= 30 then 150
    else 200
  end;
$$;

-- 0-based index of the player whose <key> equals <val>, or null.
create or replace function public.mono_idx(players jsonb, key text, val text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select (t.i - 1)::integer
    from jsonb_array_elements(players) with ordinality as t(p, i)
   where t.p->>key = val
   limit 1;
$$;

-- Id of the first cell of a kind (Start = 1, Jail = 11 on the default board).
create or replace function public.mono_cell_of_kind(board jsonb, kind text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select e.key::integer
    from jsonb_each(board) as e
   where public.mono_cell_kind(e.value) = kind
   order by e.key::integer
   limit 1;
$$;

-- Does <fig> own every street of that colour?
create or replace function public.mono_owns_set(board jsonb, fig text, color text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(coalesce(public.mono_owner(c.value) = fig, false)), false)
    from jsonb_each(board) as c
   where public.mono_cell_kind(c.value) = 'street'
     and c.value->>'color' = color;
$$;

create or replace function public.mono_money(st jsonb, idx integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce((st->'players'->idx->>'money')::numeric, 0)::integer;
$$;

create or replace function public.mono_is_bankrupt(st jsonb, idx integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((st->'players'->idx->>'bankrupt')::boolean, false);
$$;

create or replace function public.mono_event(st jsonb, ev jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(st, '{events}', coalesce(st->'events', '[]'::jsonb) || jsonb_build_array(ev));
$$;

create or replace function public.mono_patch_player(st jsonb, idx integer, patch jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(st, array['players', idx::text], (st->'players'->idx) || patch);
$$;

-- Rent owed for standing on <cell_key>. 0 when nobody owns it.
-- road_mult doubles railroad rent, util_mult forces the utility multiplier
-- (both used by the "advance to nearest ..." Chance cards).
create or replace function public.mono_rent(
  board     jsonb,
  cell_key  text,
  dice_sum  integer,
  road_mult integer default 1,
  util_mult integer default null
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  cell   jsonb := board->cell_key;
  kind   text  := public.mono_cell_kind(cell);
  owner  text  := public.mono_owner(cell);
  base   integer;
  houses integer;
  cnt    integer;
begin
  if owner is null then
    return 0;
  end if;

  if kind = 'street' then
    base   := coalesce((cell->>'price')::integer, 0) / 10;
    houses := coalesce((cell->>'houses')::integer, 0);
    if houses <= 0 then
      if public.mono_owns_set(board, owner, cell->>'color') then
        return base * 2;
      end if;
      return base;
    end if;
    return base * (case houses when 1 then 5 when 2 then 15 when 3 then 45 when 4 then 60 else 75 end);

  elsif kind = 'road' then
    select count(*) into cnt
      from jsonb_each(board) as c
     where public.mono_cell_kind(c.value) = 'road'
       and public.mono_owner(c.value) = owner;
    return (25 << greatest(cnt - 1, 0)) * coalesce(road_mult, 1);

  elsif kind = 'communal' then
    select count(*) into cnt
      from jsonb_each(board) as c
     where public.mono_cell_kind(c.value) = 'communal'
       and public.mono_owner(c.value) = owner;
    return coalesce(dice_sum, 7) * coalesce(util_mult, case when cnt >= 2 then 10 else 4 end);
  end if;

  return 0;
end;
$$;

-- Money from the bank to a player.
create or replace function public.mono_credit(st jsonb, idx integer, amount integer, reason text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
begin
  if idx is null or amount is null or amount <= 0 then
    return st;
  end if;
  st := public.mono_patch_player(st, idx, jsonb_build_object('money', public.mono_money(st, idx) + amount));
  return public.mono_event(st, jsonb_build_object(
    'type', 'collect',
    'figure', st->'players'->idx->>'figure',
    'amount', amount,
    'reason', reason
  ));
end;
$$;

-- Move everything <fig> owns to <to_fig> (or back to the bank when null):
-- properties (houses cleared), and take the token off the board.
create or replace function public.mono_transfer_assets(board jsonb, fig text, to_fig text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  e    record;
  cell jsonb;
begin
  for e in select key, value from jsonb_each(board) loop
    cell := jsonb_set(e.value, array[fig], 'false'::jsonb);
    if coalesce((cell->'bought'->>fig)::boolean, false) then
      cell := jsonb_set(cell, array['bought', fig], 'false'::jsonb);
      if to_fig is not null then
        cell := jsonb_set(cell, array['bought', to_fig], 'true'::jsonb);
      end if;
      if public.mono_cell_kind(cell) = 'street' then
        cell := jsonb_set(cell, '{houses}', '0'::jsonb);
      end if;
    end if;
    board := jsonb_set(board, array[e.key], cell);
  end loop;
  return board;
end;
$$;

-- The player cannot pay: everything goes to the creditor (or the bank), the
-- player is marked bankrupt and their token leaves the board.
create or replace function public.mono_bankrupt(st jsonb, idx integer, to_idx integer, reason text, amount integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  fig    text := st->'players'->idx->>'figure';
  to_fig text := case when to_idx is null then null else st->'players'->to_idx->>'figure' end;
begin
  if to_idx is not null then
    st := public.mono_patch_player(st, to_idx, jsonb_build_object(
      'money',     public.mono_money(st, to_idx) + public.mono_money(st, idx),
      'jailCards', coalesce((st->'players'->to_idx->>'jailCards')::integer, 0)
                 + coalesce((st->'players'->idx->>'jailCards')::integer, 0)
    ));
  end if;
  st := jsonb_set(st, '{board}', public.mono_transfer_assets(st->'board', fig, to_fig));
  st := public.mono_patch_player(st, idx, jsonb_build_object(
    'money', 0, 'bankrupt', true, 'inJail', false, 'jailTurns', 0, 'jailCards', 0
  ));
  return public.mono_event(st, jsonb_build_object(
    'type', 'bankrupt', 'figure', fig, 'to', to_fig, 'reason', reason, 'amount', amount
  ));
end;
$$;

-- Money from a player to another player (to_idx) or to the bank (null).
-- Goes bankrupt when they cannot cover it.
create or replace function public.mono_charge(
  st     jsonb,
  idx    integer,
  amount integer,
  to_idx integer,
  reason text,
  cell   integer default null
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  money  integer := public.mono_money(st, idx);
  fig    text    := st->'players'->idx->>'figure';
  to_fig text    := case when to_idx is null then null else st->'players'->to_idx->>'figure' end;
begin
  if idx is null or amount is null or amount <= 0 or public.mono_is_bankrupt(st, idx) then
    return st;
  end if;

  if money < amount then
    return public.mono_bankrupt(st, idx, to_idx, reason, amount);
  end if;

  st := public.mono_patch_player(st, idx, jsonb_build_object('money', money - amount));
  if to_idx is not null then
    st := public.mono_patch_player(st, to_idx, jsonb_build_object('money', public.mono_money(st, to_idx) + amount));
  end if;
  return public.mono_event(st, jsonb_build_object(
    'type', 'pay', 'figure', fig, 'to', to_fig, 'amount', amount, 'reason', reason, 'cell', cell
  ));
end;
$$;

-- Put the token on <new_pos>. collect_go: a forward move that wraps (or lands
-- on Start) pays the Start bonus; false for "go back" and "go to jail".
create or replace function public.mono_move_to(st jsonb, idx integer, new_pos integer, collect_go boolean)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  fig     text := st->'players'->idx->>'figure';
  old_pos integer := greatest(coalesce((st->'players'->idx->>'position')::integer, 1), 1);
  board   jsonb := st->'board';
begin
  if not (board ? new_pos::text) then
    raise exception 'Cell % does not exist', new_pos;
  end if;
  select jsonb_object_agg(e.key, jsonb_set(e.value, array[fig], 'false'::jsonb))
    into board
    from jsonb_each(board) as e;
  board := jsonb_set(board, array[new_pos::text, fig], 'true'::jsonb);
  st := jsonb_set(st, '{board}', board);
  st := public.mono_patch_player(st, idx, jsonb_build_object('position', new_pos));
  st := public.mono_event(st, jsonb_build_object(
    'type', 'move', 'figure', fig, 'from', old_pos, 'to', new_pos
  ));
  if collect_go and new_pos <= old_pos then
    st := public.mono_credit(st, idx, 200, 'passGo');
  end if;
  return st;
end;
$$;

create or replace function public.mono_jail(st jsonb, idx integer, reason text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  fig  text := st->'players'->idx->>'figure';
  jail integer := coalesce(public.mono_cell_of_kind(st->'board', 'jail'), 11);
begin
  st := public.mono_move_to(st, idx, jail, false);
  st := public.mono_patch_player(st, idx, jsonb_build_object('inJail', true, 'jailTurns', 0));
  return public.mono_event(st, jsonb_build_object('type', 'jail', 'figure', fig, 'reason', reason));
end;
$$;

-- The two decks. Texts use the board's own cell names.
create or replace function public.mono_deck(deck text, board jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  start_id integer := coalesce(public.mono_cell_of_kind(board, 'start'), 1);
  road_id  integer := coalesce(public.mono_cell_of_kind(board, 'road'), 6);
  nm       text;
begin
  if deck = 'chance' then
    return jsonb_build_array(
      jsonb_build_object('id', 'c1',  'kind', 'moveTo', 'cell', start_id,
        'text', 'Advance to ' || coalesce(board->(start_id::text)->>'header', 'Start') || '. Collect $200.'),
      jsonb_build_object('id', 'c2',  'kind', 'moveTo', 'cell', 25,
        'text', 'Advance to ' || coalesce(board->'25'->>'header', 'cell 25') || '. If you pass Start, collect $200.'),
      jsonb_build_object('id', 'c3',  'kind', 'moveTo', 'cell', 12,
        'text', 'Advance to ' || coalesce(board->'12'->>'header', 'cell 12') || '. If you pass Start, collect $200.'),
      jsonb_build_object('id', 'c4',  'kind', 'nearest', 'what', 'communal',
        'text', 'Advance to the nearest utility. If it is owned, pay 10 times your dice.'),
      jsonb_build_object('id', 'c5',  'kind', 'nearest', 'what', 'road',
        'text', 'Advance to the nearest railroad. If it is owned, pay double rent.'),
      jsonb_build_object('id', 'c6',  'kind', 'collect', 'amount', 50,
        'text', 'Bank pays you a dividend of $50.'),
      jsonb_build_object('id', 'c7',  'kind', 'jailCard',
        'text', 'Get Out Of Jail Free. Keep this card until you need it.'),
      jsonb_build_object('id', 'c8',  'kind', 'back', 'steps', 3,
        'text', 'Go back 3 spaces.'),
      jsonb_build_object('id', 'c9',  'kind', 'goJail',
        'text', 'Go directly to Jail. Do not pass Start, do not collect $200.'),
      jsonb_build_object('id', 'c10', 'kind', 'repairs', 'house', 25, 'hotel', 100,
        'text', 'Make general repairs on all your property: $25 per house, $100 per hotel.'),
      jsonb_build_object('id', 'c11', 'kind', 'pay', 'amount', 15,
        'text', 'Speeding fine. Pay $15.'),
      jsonb_build_object('id', 'c12', 'kind', 'moveTo', 'cell', road_id,
        'text', 'Take a trip to ' || coalesce(board->(road_id::text)->>'info', 'the first railroad') || '. If you pass Start, collect $200.'),
      jsonb_build_object('id', 'c13', 'kind', 'moveTo', 'cell', 40,
        'text', 'Advance to ' || coalesce(board->'40'->>'header', 'cell 40') || '.'),
      jsonb_build_object('id', 'c14', 'kind', 'payEach', 'amount', 50,
        'text', 'You have been elected chairman of the board. Pay each player $50.'),
      jsonb_build_object('id', 'c15', 'kind', 'collect', 'amount', 150,
        'text', 'Your building loan matures. Collect $150.')
    );
  end if;

  return jsonb_build_array(
    jsonb_build_object('id', 'k1',  'kind', 'moveTo', 'cell', start_id,
      'text', 'Advance to ' || coalesce(board->(start_id::text)->>'header', 'Start') || '. Collect $200.'),
    jsonb_build_object('id', 'k2',  'kind', 'collect', 'amount', 200,
      'text', 'Bank error in your favour. Collect $200.'),
    jsonb_build_object('id', 'k3',  'kind', 'pay', 'amount', 50,
      'text', 'Doctor''s fee. Pay $50.'),
    jsonb_build_object('id', 'k4',  'kind', 'collect', 'amount', 50,
      'text', 'From sale of stock you get $50.'),
    jsonb_build_object('id', 'k5',  'kind', 'jailCard',
      'text', 'Get Out Of Jail Free. Keep this card until you need it.'),
    jsonb_build_object('id', 'k6',  'kind', 'goJail',
      'text', 'Go directly to Jail. Do not pass Start, do not collect $200.'),
    jsonb_build_object('id', 'k7',  'kind', 'collect', 'amount', 100,
      'text', 'Holiday fund matures. Receive $100.'),
    jsonb_build_object('id', 'k8',  'kind', 'collect', 'amount', 20,
      'text', 'Income tax refund. Collect $20.'),
    jsonb_build_object('id', 'k9',  'kind', 'collectEach', 'amount', 10,
      'text', 'It is your birthday. Collect $10 from every player.'),
    jsonb_build_object('id', 'k10', 'kind', 'collect', 'amount', 100,
      'text', 'Life insurance matures. Collect $100.'),
    jsonb_build_object('id', 'k11', 'kind', 'pay', 'amount', 100,
      'text', 'Pay hospital fees of $100.'),
    jsonb_build_object('id', 'k12', 'kind', 'pay', 'amount', 50,
      'text', 'Pay school fees of $50.'),
    jsonb_build_object('id', 'k13', 'kind', 'collect', 'amount', 25,
      'text', 'Receive $25 consultancy fee.'),
    jsonb_build_object('id', 'k14', 'kind', 'repairs', 'house', 40, 'hotel', 115,
      'text', 'You are assessed for street repairs: $40 per house, $115 per hotel.'),
    jsonb_build_object('id', 'k15', 'kind', 'collect', 'amount', 10,
      'text', 'You have won second prize in a beauty contest. Collect $10.'),
    jsonb_build_object('id', 'k16', 'kind', 'collect', 'amount', 100,
      'text', 'You inherit $100.')
  );
end;
$$;

create or replace function public.mono_draw(deck text, board jsonb)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  cards jsonb := public.mono_deck(deck, board);
begin
  return cards->(floor(random() * jsonb_array_length(cards))::integer);
end;
$$;

-- Apply a drawn card. Moves land again (mono_land), so a card can chain into
-- rent or even another card.
create or replace function public.mono_apply_card(st jsonb, idx integer, card jsonb, dice_sum integer)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  kind   text := card->>'kind';
  fig    text := st->'players'->idx->>'figure';
  pos    integer := greatest(coalesce((st->'players'->idx->>'position')::integer, 1), 1);
  n      integer := jsonb_array_length(st->'players');
  cells  integer := (select count(*) from jsonb_object_keys(st->'board'));
  target integer;
  i      integer;
  h      integer;
  houses integer := 0;
  hotels integer := 0;
  e      record;
begin
  case kind
    when 'moveTo' then
      st := public.mono_move_to(st, idx, (card->>'cell')::integer, true);
      st := public.mono_land(st, idx, dice_sum);

    when 'nearest' then
      select c.key::integer into target
        from jsonb_each(st->'board') as c
       where public.mono_cell_kind(c.value) = card->>'what'
         and c.key::integer > pos
       order by c.key::integer
       limit 1;
      if target is null then
        target := public.mono_cell_of_kind(st->'board', card->>'what');
      end if;
      if target is not null then
        st := public.mono_move_to(st, idx, target, true);
        st := public.mono_land(st, idx, dice_sum, 2, 10);
      end if;

    when 'collect' then
      st := public.mono_credit(st, idx, (card->>'amount')::integer, 'card');

    when 'pay' then
      st := public.mono_charge(st, idx, (card->>'amount')::integer, null, 'card');

    when 'jailCard' then
      st := public.mono_patch_player(st, idx, jsonb_build_object(
        'jailCards', coalesce((st->'players'->idx->>'jailCards')::integer, 0) + 1
      ));

    when 'goJail' then
      st := public.mono_jail(st, idx, 'card');

    when 'back' then
      target := pos - (card->>'steps')::integer;
      if target < 1 then
        target := target + cells;
      end if;
      st := public.mono_move_to(st, idx, target, false);
      st := public.mono_land(st, idx, dice_sum);

    when 'repairs' then
      for e in select value from jsonb_each(st->'board') loop
        if public.mono_cell_kind(e.value) = 'street' and public.mono_owner(e.value) = fig then
          h := coalesce((e.value->>'houses')::integer, 0);
          if h >= 5 then
            hotels := hotels + 1;
          else
            houses := houses + h;
          end if;
        end if;
      end loop;
      st := public.mono_charge(st, idx,
        houses * (card->>'house')::integer + hotels * (card->>'hotel')::integer,
        null, 'repairs');

    when 'payEach' then
      for i in 0 .. n - 1 loop
        exit when public.mono_is_bankrupt(st, idx);
        if i <> idx and not public.mono_is_bankrupt(st, i) then
          st := public.mono_charge(st, idx, (card->>'amount')::integer, i, 'card');
        end if;
      end loop;

    when 'collectEach' then
      for i in 0 .. n - 1 loop
        if i <> idx and not public.mono_is_bankrupt(st, i) then
          st := public.mono_charge(st, i, (card->>'amount')::integer, idx, 'card');
        end if;
      end loop;

    else
      null;
  end case;
  return st;
end;
$$;

-- Resolve the cell the player stands on.
create or replace function public.mono_land(
  st        jsonb,
  idx       integer,
  dice_sum  integer,
  road_mult integer default 1,
  util_mult integer default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  fig       text := st->'players'->idx->>'figure';
  pos       integer := greatest(coalesce((st->'players'->idx->>'position')::integer, 1), 1);
  cell      jsonb := st->'board'->(pos::text);
  kind      text := public.mono_cell_kind(cell);
  owner     text;
  owner_idx integer;
  card      jsonb;
begin
  st := public.mono_event(st, jsonb_build_object(
    'type', 'land', 'figure', fig, 'cell', pos, 'kind', kind
  ));

  if kind in ('street', 'road', 'communal') then
    owner := public.mono_owner(cell);
    if owner is not null and owner <> fig then
      owner_idx := public.mono_idx(st->'players', 'figure', owner);
      if owner_idx is not null and not public.mono_is_bankrupt(st, owner_idx) then
        st := public.mono_charge(st, idx,
          public.mono_rent(st->'board', pos::text, dice_sum, road_mult, util_mult),
          owner_idx, 'rent', pos);
      end if;
    end if;

  elsif kind = 'tax' then
    st := public.mono_charge(st, idx, coalesce((cell->>'price')::integer, 0), null, 'tax', pos);

  elsif kind = 'gtj' then
    st := public.mono_jail(st, idx, 'gtj');

  elsif kind in ('chance', 'community') then
    card := public.mono_draw(kind, st->'board');
    st := public.mono_event(st, jsonb_build_object(
      'type', 'card', 'figure', fig, 'deck', kind, 'id', card->>'id', 'text', card->>'text'
    ));
    st := jsonb_set(st, '{game,lastCard}', jsonb_build_object(
      'deck', kind, 'text', card->>'text', 'figure', fig
    ));
    st := public.mono_apply_card(st, idx, card, dice_sum);
  end if;
  -- start: the bonus is paid by mono_move_to; parking / jail (visiting): nothing

  return st;
end;
$$;

-- Turn goes to the next player who is still in the game.
create or replace function public.mono_next_turn(players jsonb, turn integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  n    integer := jsonb_array_length(players);
  t    integer := turn;
  i    integer;
  idx  integer;
begin
  if n = 0 then
    return 0;
  end if;
  for i in 1 .. n loop
    t := (t + 1) % n;
    idx := public.mono_idx(players, 'order', t::text);
    if idx is not null and not coalesce((players->idx->>'bankrupt')::boolean, false) then
      return t;
    end if;
  end loop;
  return turn;
end;
$$;

-- ---------------------------------------------------------------------------
-- game_action
-- ---------------------------------------------------------------------------

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

  gm := jsonb_build_object(
    'seq',      seq,
    'phase',    phase,
    'doubles',  doubles,
    'dice',     dice,
    'actor',    pid,
    'action',   action,
    'events',   st->'events',
    'lastCard', st->'game'->'lastCard',
    'winner',   winner
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
