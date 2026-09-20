-- Six players per room, eight selectable figures.
--
-- The room was built for four seats and four monsters (fig0..fig3). The table
-- that ships tomorrow seats six, and eight figures exist so the last player to
-- pick still has a choice. Nothing about the rules changes: the cap is still a
-- cap, it is just 6 instead of 4.
--
-- This migration must be applied AFTER 20260919100000_auction_trade.sql. It:
--
--   1. widens the two table CHECK constraints that hard-coded four seats
--      (`test_players_max_four` and `test_current_order_range`),
--   2. adds public.mono_upgrade_cells, which brings a board of any age up to
--      the eight-figure cell shape,
--   3. runs that over every existing row in public.test (idempotent, and it
--      cannot move or drop ownership),
--   4. re-creates public.game_action in full with the three four-player
--      assumptions in its body fixed.
--
-- ---------------------------------------------------------------------------
-- The figures
-- ---------------------------------------------------------------------------
--   fig0 Imp · fig1 Cyclops · fig2 Specter · fig3 Yeti  (existing)
--   fig4 Bat · fig5 Mummy   · fig6 Octo    · fig7 Slime (new)
--
-- Ownership lives per cell in `bought`, so every cell carries all eight keys:
--   "27": { ..., "fig0": false, ..., "fig7": false,
--           "bought": { "fig0": false, ..., "fig7": false } }
-- The top-level figN flags are the token-on-this-cell flags; bought.figN is
-- ownership. Both are widened here so the board has one shape everywhere.
--
-- ---------------------------------------------------------------------------
-- What was NOT four-player
-- ---------------------------------------------------------------------------
-- Every mono_* helper from 20260918140000_game_rules.sql and
-- 20260919100000_auction_trade.sql is already generic over the figure key and
-- over the player count, and none of them is re-created here:
--
--   mono_owner            iterates jsonb_each(bought) and returns the key that
--                         is true - it never names a figure
--   mono_owns_set         mono_rent · mono_tradable   all go through mono_owner
--   mono_transfer_assets  reads coalesce((cell->'bought'->>fig)::boolean,false)
--   mono_give_cell        jsonb_set with the default create_missing = true
--   mono_next_turn        modulo jsonb_array_length(players)
--   mono_apply_card       payEach / collectEach loop 0 .. n-1
--   mono_auction_advance  walks auction.order, whatever length it has
--
-- They are also all null-safe for a cell whose `bought` has no fig4..fig7 key
-- (a board seeded by a client that still writes only four), which is why step
-- 3 below is a tidy-up and not a correctness fix.
--
-- ---------------------------------------------------------------------------
-- The four-player assumptions that WERE in game_action
-- ---------------------------------------------------------------------------
--   join    the figure whitelist    fig0..fig3          -> fig0..fig7
--   join    the cap                 if n >= 4           -> if n >= 6
--   new_game / reset_board          the fresh-board `bought` shape had four
--                                   keys                -> eight keys
--   the final UPDATE                current_order was clamped to
--                                   least(greatest(turn, 0), 3), which pinned
--                                   a six-player room to the first four seats
--                                   and made players 5 and 6 unreachable
--                                   -> clamped to the seat count instead,
--                                      least(greatest(turn, 0), n - 1)
--
-- ---------------------------------------------------------------------------
-- Table constraints
-- ---------------------------------------------------------------------------

alter table public.test
  drop constraint if exists test_players_max_four;
alter table public.test
  drop constraint if exists test_players_max_six;
alter table public.test
  add constraint test_players_max_six check (jsonb_array_length("Players") <= 6);

alter table public.test
  drop constraint if exists test_current_order_range;
alter table public.test
  add constraint test_current_order_range check (current_order between 0 and 5);

comment on column public.test.position  is
  'Board state keyed by cell id "1".."40". Each cell: static card data + fig0..fig7 token flags + bought{fig0..fig7}. Shape from src/Hooks/baseState.jsx, widened to eight figures by 20260920100000_six_players.sql.';
comment on column public.test."Players" is
  'Array of up to 6 players: {name, figure, money, position, order, playerId, inJail, jailTurns, jailCards, bankrupt}. Figures fig0..fig7, six of the eight may be seated at once.';

-- ---------------------------------------------------------------------------
-- Board upgrade
--
-- Brings one board up to the eight-figure cell shape: every object cell gains
-- the eight top-level token flags and an eight-key `bought`, and every key it
-- already had keeps its value (`defaults || existing` - the right-hand side of
-- `||` wins). A cell that never had a `bought` gets a bank-owned one, which is
-- what every cell on the seeded board already carries and what makes `buy`'s
-- jsonb_set land instead of silently doing nothing. Non-object entries are
-- passed through untouched.
--
-- Idempotent: running it on an already-eight-key board returns it unchanged.
-- ---------------------------------------------------------------------------

create or replace function public.mono_upgrade_cells(board jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.key,
           case when jsonb_typeof(e.value) <> 'object' then e.value
           else (
             jsonb_build_object(
               'fig0', false, 'fig1', false, 'fig2', false, 'fig3', false,
               'fig4', false, 'fig5', false, 'fig6', false, 'fig7', false
             ) || e.value
           ) || jsonb_build_object('bought',
             jsonb_build_object(
               'fig0', false, 'fig1', false, 'fig2', false, 'fig3', false,
               'fig4', false, 'fig5', false, 'fig6', false, 'fig7', false
             ) || case when jsonb_typeof(e.value->'bought') = 'object'
                       then e.value->'bought'
                       else '{}'::jsonb end)
           end), '{}'::jsonb)
    from jsonb_each(coalesce(board, '{}'::jsonb)) as e;
$$;

comment on function public.mono_upgrade_cells(jsonb) is
  'Widens a board to the fig0..fig7 cell shape without moving ownership. Idempotent. 20260920100000_six_players.sql.';

-- Every room that already exists. The `where` only skips work; the function is
-- idempotent on its own, so re-running the whole migration is harmless.
update public.test
   set position = public.mono_upgrade_cells(position)
 where exists (
   select 1
     from jsonb_each(position) as e
    where jsonb_typeof(e.value) = 'object'
      and (not (e.value ? 'fig7')
           or jsonb_typeof(e.value->'bought') <> 'object'
           or not (e.value->'bought' ? 'fig7'))
 );

-- ---------------------------------------------------------------------------
-- game_action
--
-- Re-created in full (it is a create-or-replace, so there is no way to patch
-- one branch) from 20260919100000_auction_trade.sql. Only the four spots
-- listed at the top of this file differ; everything else is verbatim.
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
  gm         jsonb;
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

  -- auctions and trading
  auc        jsonb;
  auc_cell   integer;
  auc_by     text;
  auc_ord    jsonb;
  auc_len    integer;
  anchor     integer;
  i          integer;
  tgt_fig    text;
  amt        numeric;
  min_bid    integer;
  tr         jsonb;
  why        text;
  f_idx      integer;
  t_idx      integer;
  g_cash     integer;
  w_cash     integer;
  was_auc    boolean := false;
  keep_mv    boolean := true;
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

  -- json null and a missing key both mean "not running" / "nothing pending"
  auc := case when jsonb_typeof(gm->'auction') = 'object' then gm->'auction' end;
  tr  := case when jsonb_typeof(gm->'trade')   = 'object' then gm->'trade'   end;
  if auc is null and phase = 'auction' then
    phase := 'act';  -- defensive: a phase left behind without its auction
  end if;

  st := jsonb_build_object(
    'players', players, 'board', board, 'game', gm, 'events', '[]'::jsonb,
    'auction', auc, 'trade', tr
  );

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

  if action in ('roll', 'move', 'buy', 'build', 'pay_jail', 'use_jail_card', 'end_turn',
                'auction_start', 'auction_bid', 'auction_drop',
                'trade_offer', 'trade_accept', 'trade_decline', 'trade_cancel', 'trade_counter') then
    if phase = 'over' then
      raise exception 'The game is over';
    end if;
    if coalesce((me->>'bankrupt')::boolean, false) then
      raise exception 'You are bankrupt';
    end if;
  end if;

  -- Nothing but bidding, dropping, skipping and leaving happens in an auction.
  if phase = 'auction'
     and action in ('roll', 'move', 'buy', 'build', 'pay_jail', 'use_jail_card', 'end_turn',
                    'auction_start',
                    'trade_offer', 'trade_accept', 'trade_decline', 'trade_cancel', 'trade_counter') then
    raise exception 'An auction is running';
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
    if fig not in ('fig0', 'fig1', 'fig2', 'fig3',
                   'fig4', 'fig5', 'fig6', 'fig7') then
      raise exception 'Unknown figure %', fig;
    end if;
    if n >= 6 then
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
    st := jsonb_build_object(
      'players', players, 'board', board, 'game', gm, 'events', '[]'::jsonb,
      'auction', auc, 'trade', tr
    );
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
  -- Auction
  -- -------------------------------------------------------------------------
  elsif action = 'auction_start' then
    if my_order <> turn then
      raise exception 'Not your turn';
    end if;
    if phase <> 'act' then
      raise exception 'Roll first';
    end if;
    cell_key := payload->>'cell';
    cell     := board->cell_key;
    if cell is null then
      raise exception 'Cell % does not exist', cell_key;
    end if;
    cell_id := cell_key::integer;
    if cell_id <> coalesce((me->>'position')::integer, 0) then
      raise exception 'You are not standing on that cell';
    end if;
    if public.mono_price(cell) is null then
      raise exception 'This cell is not for sale';
    end if;
    if public.mono_owner(cell) is not null then
      raise exception 'Already owned';
    end if;

    -- an auction replaces whatever was on the table
    st := public.mono_trade_clear(st, 'cancelled');
    tr := null;

    -- rotation: the player after startedBy first, startedBy last, bankrupt out
    select coalesce(jsonb_agg(p->'figure'
             order by (((p->>'order')::integer - my_order - 1 + n) % n)), '[]'::jsonb)
      into auc_ord
      from jsonb_array_elements(players) as p
     where not coalesce((p->>'bankrupt')::boolean, false);

    if jsonb_array_length(auc_ord) = 0 then
      raise exception 'Nobody can bid';
    end if;

    auc := jsonb_build_object(
      'cell',      cell_id,
      'startedBy', fig,
      'bid',       0,
      'leader',    null,
      'order',     auc_ord,
      'in',        auc_ord,
      'turn',      auc_ord->>0,
      'last',      '{}'::jsonb
    );
    st := jsonb_set(st, '{auction}', auc);
    st := public.mono_event(st, jsonb_build_object(
      'type', 'auction_start', 'figure', fig, 'cell', cell_id
    ));
    phase := 'auction';

  -- -------------------------------------------------------------------------
  elsif action in ('auction_bid', 'auction_drop') then
    if auc is null or phase <> 'auction' then
      raise exception 'No auction is running';
    end if;
    if auc->>'turn' is distinct from fig then
      raise exception 'It is not your turn to bid';
    end if;
    auc_cell := (auc->>'cell')::integer;
    auc_by   := auc->>'startedBy';

    if action = 'auction_bid' then
      amt := (payload->>'amount')::numeric;
      if amt is null then
        raise exception 'auction_bid needs an amount';
      end if;
      min_bid := greatest(coalesce((auc->>'bid')::integer, 0) + 10, 10);
      if amt <> trunc(amt) or amt % 10 <> 0 then
        raise exception 'Bids must be a multiple of 10';
      end if;
      if amt < min_bid then
        raise exception 'Bid at least %$', min_bid;
      end if;
      if amt > money then
        raise exception 'Not enough money';
      end if;
      auc := auc || jsonb_build_object('bid', amt::integer, 'leader', fig);
      auc := jsonb_set(auc, array['last', fig], to_jsonb(amt::integer));
      st  := jsonb_set(st, '{auction}', auc);
      st  := public.mono_event(st, jsonb_build_object(
        'type', 'bid', 'figure', fig, 'cell', auc_cell, 'amount', amt::integer
      ));
    else
      auc := jsonb_set(auc, '{in}', public.mono_json_without(auc->'in', fig));
      st  := jsonb_set(st, '{auction}', auc);
      st  := public.mono_event(st, jsonb_build_object(
        'type', 'drop', 'figure', fig, 'cell', auc_cell
      ));
    end if;

    st  := public.mono_auction_advance(st);
    auc := case when jsonb_typeof(st->'auction') = 'object' then st->'auction' end;
    if auc is null then
      -- back to the starter's turn, unless they left the room mid-auction
      phase := case when public.mono_idx(st->'players', 'figure', auc_by) is null
                    then 'roll' else 'act' end;
    end if;

  -- -------------------------------------------------------------------------
  -- Trading
  -- -------------------------------------------------------------------------
  elsif action = 'trade_offer' then
    if my_order <> turn then
      raise exception 'You can only offer a trade on your turn';
    end if;
    if phase not in ('roll', 'act') then
      raise exception 'You cannot trade right now';
    end if;
    if tr is not null then
      raise exception 'There is already a pending offer';
    end if;
    tr := jsonb_build_object(
      'id',      seq,
      'from',    fig,
      'to',      payload->>'to',
      'give',    jsonb_build_object(
                   'cells', case when jsonb_typeof(payload->'give'->'cells') = 'array'
                                 then payload->'give'->'cells' else '[]'::jsonb end,
                   'cash',  coalesce((payload->'give'->>'cash')::numeric, 0)),
      'get',     jsonb_build_object(
                   'cells', case when jsonb_typeof(payload->'get'->'cells') = 'array'
                                 then payload->'get'->'cells' else '[]'::jsonb end,
                   'cash',  coalesce((payload->'get'->>'cash')::numeric, 0)),
      'counter', false
    );
    why := public.mono_trade_valid(st, tr);
    if why is not null then
      raise exception '%', why;
    end if;
    st := jsonb_set(st, '{trade}', tr);
    st := public.mono_event(st, jsonb_build_object(
      'type', 'trade', 'status', 'offered', 'figure', tr->>'from', 'to', tr->>'to',
      'give', tr->'give', 'get', tr->'get', 'id', tr->'id'
    ));

  -- -------------------------------------------------------------------------
  elsif action = 'trade_counter' then
    if tr is null then
      raise exception 'There is no offer to answer';
    end if;
    if tr->>'to' is distinct from fig then
      raise exception 'This offer is not yours to answer';
    end if;
    if phase not in ('roll', 'act') then
      raise exception 'You cannot trade right now';
    end if;
    tr := jsonb_build_object(
      'id',      seq,
      'from',    fig,
      'to',      tr->>'from',
      'give',    jsonb_build_object(
                   'cells', case when jsonb_typeof(payload->'give'->'cells') = 'array'
                                 then payload->'give'->'cells' else '[]'::jsonb end,
                   'cash',  coalesce((payload->'give'->>'cash')::numeric, 0)),
      'get',     jsonb_build_object(
                   'cells', case when jsonb_typeof(payload->'get'->'cells') = 'array'
                                 then payload->'get'->'cells' else '[]'::jsonb end,
                   'cash',  coalesce((payload->'get'->>'cash')::numeric, 0)),
      'counter', true
    );
    why := public.mono_trade_valid(st, tr);
    if why is not null then
      raise exception '%', why;
    end if;
    st := jsonb_set(st, '{trade}', tr);
    st := public.mono_event(st, jsonb_build_object(
      'type', 'trade', 'status', 'countered', 'figure', tr->>'from', 'to', tr->>'to',
      'give', tr->'give', 'get', tr->'get', 'id', tr->'id'
    ));

  -- -------------------------------------------------------------------------
  elsif action = 'trade_decline' then
    if tr is null then
      raise exception 'There is no offer to answer';
    end if;
    if tr->>'to' is distinct from fig then
      raise exception 'This offer is not yours to answer';
    end if;
    st := public.mono_trade_clear(st, 'declined');
    tr := null;

  -- -------------------------------------------------------------------------
  elsif action = 'trade_cancel' then
    if tr is null then
      raise exception 'There is no offer to cancel';
    end if;
    if tr->>'from' is distinct from fig then
      raise exception 'This offer is not yours to cancel';
    end if;
    st := public.mono_trade_clear(st, 'cancelled');
    tr := null;

  -- -------------------------------------------------------------------------
  elsif action = 'trade_accept' then
    if tr is null then
      raise exception 'There is no offer to answer';
    end if;
    if tr->>'to' is distinct from fig then
      raise exception 'This offer is not yours to answer';
    end if;

    -- ownership and money can have changed since the offer was made
    why := public.mono_trade_valid(st, tr);
    if why is not null then
      -- One RPC call is one transaction: raising here would roll back this
      -- very clearing, so the call succeeds and the `expired` event carries
      -- the reason instead.
      st := public.mono_trade_clear(st, 'expired', why);
      tr := null;
    else
      f_idx  := public.mono_idx(st->'players', 'figure', tr->>'from');
      t_idx  := public.mono_idx(st->'players', 'figure', tr->>'to');
      g_cash := coalesce((tr->'give'->>'cash')::numeric, 0)::integer;
      w_cash := coalesce((tr->'get'->>'cash')::numeric, 0)::integer;

      for cell_id in
        select (v#>>'{}')::integer from jsonb_array_elements(tr->'give'->'cells') as v
      loop
        st := public.mono_give_cell(st, cell_id, tr->>'from', tr->>'to');
      end loop;
      for cell_id in
        select (v#>>'{}')::integer from jsonb_array_elements(tr->'get'->'cells') as v
      loop
        st := public.mono_give_cell(st, cell_id, tr->>'to', tr->>'from');
      end loop;

      -- both sides of the cash in one go
      st := public.mono_patch_player(st, f_idx, jsonb_build_object(
        'money', public.mono_money(st, f_idx) - g_cash + w_cash));
      st := public.mono_patch_player(st, t_idx, jsonb_build_object(
        'money', public.mono_money(st, t_idx) + g_cash - w_cash));

      st := public.mono_trade_clear(st, 'accepted');
      tr := null;
    end if;

  -- -------------------------------------------------------------------------
  elsif action = 'end_turn' then
    if my_order <> turn then
      raise exception 'Not your turn';
    end if;
    if phase <> 'act' then
      raise exception 'Roll first';
    end if;
    st := public.mono_trade_clear(st, 'cancelled');
    tr := null;
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

    if auc is not null and phase = 'auction' then
      -- a sleeping phone must not freeze the room: drop whoever is to move
      auc_cell := (auc->>'cell')::integer;
      auc_by   := auc->>'startedBy';
      tgt_fig  := auc->>'turn';
      if tgt_fig is not null then
        auc := jsonb_set(auc, '{in}', public.mono_json_without(auc->'in', tgt_fig));
        st  := jsonb_set(st, '{auction}', auc);
        st  := public.mono_event(st, jsonb_build_object(
          'type', 'drop', 'figure', tgt_fig, 'cell', auc_cell
        ));
      end if;
      st  := public.mono_auction_advance(st);
      auc := case when jsonb_typeof(st->'auction') = 'object' then st->'auction' end;
      if auc is null then
        phase := case when public.mono_idx(st->'players', 'figure', auc_by) is null
                      then 'roll' else 'act' end;
      end if;
    else
      st := public.mono_trade_clear(st, 'cancelled');
      tr := null;
      turn := public.mono_next_turn(st->'players', turn);
      doubles := 0;
      phase := 'roll';
      st := public.mono_event(st, jsonb_build_object('type', 'skip', 'order', turn));
    end if;

  -- -------------------------------------------------------------------------
  elsif action = 'leave' then
    -- a pending offer dies with either party
    if tr is not null and fig in (tr->>'from', tr->>'to') then
      st := public.mono_trade_clear(st, 'cancelled');
      tr := null;
    end if;

    was_auc := auc is not null and phase = 'auction';
    keep_mv := true;
    if was_auc then
      auc_by   := auc->>'startedBy';
      auc_ord  := case when jsonb_typeof(auc->'order') = 'array' then auc->'order' else '[]'::jsonb end;
      auc_len  := jsonb_array_length(auc_ord);
      anchor   := null;
      for i in 0 .. auc_len - 1 loop
        if auc_ord->>i = fig then
          anchor := i;
          exit;
        end if;
      end loop;
      -- the mover has to keep a foothold in `order`: hand `turn` to whoever
      -- cyclically precedes the leaver, advance() walks forward from there
      if anchor is not null and auc->>'turn' = fig then
        keep_mv := false;   -- the mover left: the move has to go somewhere
        if auc_len <= 1 then
          auc := jsonb_set(auc, '{turn}', 'null'::jsonb);
        else
          auc := jsonb_set(auc, '{turn}', auc_ord->((anchor - 1 + auc_len) % auc_len));
        end if;
      end if;
      auc := jsonb_set(auc, '{order}', public.mono_json_without(auc->'order', fig));
      auc := jsonb_set(auc, '{in}',    public.mono_json_without(auc->'in', fig));
      if auc->>'leader' = fig then
        -- The leader leaving resets bidding, not just their own chip: leaving
        -- every other player's last bid in place would keep a chip reading
        -- e.g. "100$" on screen under a "No bids yet · Start at 10$" headline.
        auc := auc || jsonb_build_object('bid', 0, 'leader', null);
        auc := jsonb_set(auc, '{last}', '{}'::jsonb);
      end if;
      st := jsonb_set(st, '{auction}', auc);
    end if;

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

    if was_auc then
      st  := public.mono_auction_advance(st, keep_mv);
      auc := case when jsonb_typeof(st->'auction') = 'object' then st->'auction' end;
      if auc is not null then
        phase := 'auction';
      else
        -- the starter is gone -> the leave logic already moved the turn on
        phase := case when public.mono_idx(st->'players', 'figure', auc_by) is null
                      then 'roll' else 'act' end;
      end if;
    end if;

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
             'fig4', false, 'fig5', false, 'fig6', false, 'fig7', false,
             'bought', jsonb_build_object(
               'fig0', false, 'fig1', false, 'fig2', false, 'fig3', false,
               'fig4', false, 'fig5', false, 'fig6', false, 'fig7', false)))
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
    gm      := '{}'::jsonb;
    auc     := null;   -- a running auction and a pending offer die with the game
    tr      := null;
    st := jsonb_build_object(
      'players', players, 'board', board, 'game', gm, 'events', '[]'::jsonb,
      'auction', null, 'trade', null
    );
    st := public.mono_event(st, jsonb_build_object('type', 'newGame'));

  else
    raise exception 'Unknown action %', action;
  end if;

  -- -------------------------------------------------------------------------
  -- After the action

  players := st->'players';
  board   := st->'board';
  n       := jsonb_array_length(players);

  -- A pending offer cannot outlive either party. `leave` already cancels its
  -- own; this catches a bankruptcy that happened anywhere in a landing.
  if jsonb_typeof(st->'trade') = 'object' then
    f_idx := public.mono_idx(players, 'figure', st->'trade'->>'from');
    t_idx := public.mono_idx(players, 'figure', st->'trade'->>'to');
    if f_idx is null or t_idx is null
       or public.mono_is_bankrupt(st, f_idx) or public.mono_is_bankrupt(st, t_idx) then
      st := public.mono_trade_clear(st, 'expired');
    end if;
  end if;

  -- a bankrupt player cannot finish their turn: move on
  -- (never during an auction: the turn belongs to the starter until it ends)
  if phase not in ('over', 'auction') and n > 0 then
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
  if phase = 'over' then
    -- nothing can be bid on or traded any more
    if jsonb_typeof(st->'trade') = 'object' then
      st := public.mono_trade_clear(st, 'expired');
    end if;
    st := jsonb_set(st, '{auction}', 'null'::jsonb);
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
    'log',      new_log,
    'auction',  st->'auction',
    'trade',    st->'trade'
  );

  update public.test
     set position      = board,
         "Players"     = players,
         -- six seats now, and clamped to the seats this room actually has
         -- rather than to a constant (was `least(greatest(turn, 0), 3)`,
         -- which pinned a room to its first four players)
         current_order = least(greatest(turn, 0), greatest(n - 1, 0)),
         game          = gm
   where uuid = room
  returning * into rec;

  return rec;
end;
$$;

comment on function public.game_action(text, text, jsonb) is
  'Applies one game action to a room under a row lock. Actions: 20260918140000_game_rules.sql, plus auctions and trading from 20260919100000_auction_trade.sql. Six seats and figures fig0..fig7 since 20260920100000_six_players.sql.';

revoke all on function public.game_action(text, text, jsonb) from public;
grant execute on function public.game_action(text, text, jsonb) to anon, authenticated;

-- game_action runs as the caller (security invoker), so the caller also needs
-- execute on the mono_* helpers. Functions grant execute to public by default;
-- that default is left in place on purpose, exactly as for the older helpers.
