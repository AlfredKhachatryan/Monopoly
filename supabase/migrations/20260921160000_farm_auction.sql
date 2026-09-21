-- The Weed Farm is sold at auction, and only at auction.
--
-- Until now cell 28 was an ordinary deed with an unusual income: the player who
-- landed on it while it was unowned was offered Buy 150$, and the table only
-- got a look in if they said no. In practice they never said no. 150$ is the
-- cheapest deed on that half of the board and its counter had already been
-- watered by everybody who walked past, so whoever happened to roll a 28 took
-- a growing income off the table for pocket change, unopposed. The farm was
-- the one space on the board whose value everybody could see and only one
-- player could act on.
--
-- So it stops being for sale. Landing on the unowned farm now opens an auction
-- for the WHOLE TABLE, automatically, as part of the landing itself, and there
-- is no buy step to decline first. Nothing else about the farm changes:
--
--   * a non-owner landing on it still pays nothing and still grows the crop by
--     150$. That includes the landing that triggers the auction - it is a visit
--     like any other, so the deed the winner takes home is already 150$ richer
--     than it was when they started bidding;
--   * the owner still harvests by landing on it, and the counter still restarts
--     at 50$;
--   * it is still tradable, still mortgage-free, still worth 150$ to every
--     valuation in the app, and a bankruptcy still hands it over like any deed.
--
-- The auction is the EXISTING auction, in every detail: opening bid 10$, raises
-- in multiples of 10$, the rotation runs from the player after the lander round
-- to the lander last, bankrupt seats are out, dropping is free, and if nobody
-- bids at all the farm stays with the bank and the next player to land on it
-- opens a fresh one. Nothing here invents a second kind of auction - see
-- mono_auction_open below, which is the one that a player's own auction_start
-- now goes through as well.
--
-- Applied AFTER 20260921100000_alliance_war.sql. Nothing in an already-applied
-- migration is edited.
--
-- ---------------------------------------------------------------------------
-- How a landing opens an auction
-- ---------------------------------------------------------------------------
-- mono_land is a pure-ish jsonb helper: it knows the board and the players and
-- nothing about phases, turns or whether this action has finished happening. An
-- auction is the opposite - it takes over the whole room. So the two are joined
-- the way the casino already joins them, and deliberately in the same shape so
-- there is one pattern to learn rather than two:
--
--   mono_land          writes game.farmAuction = {cell, figure}
--   game_action (tail) reads it back, checks it against the FINISHED state and
--                      opens the real auction, setting phase = 'auction'
--
-- with one difference from the casino, which is that game.casino survives on
-- the row between actions and game.farmAuction never does. It is consumed in
-- the same action that wrote it and the `gm` built at the end of game_action
-- does not carry the key, so no client, no test and no screen ever sees it.
--
-- ---------------------------------------------------------------------------
-- The two doors that close
-- ---------------------------------------------------------------------------
--   buy            on a farm -> 'The farm is only ever sold at auction'
--   auction_start  on a farm -> 'The farm auctions itself when somebody lands
--                                on it'
--
-- The second one matters more than it looks. The farm's auction can end with
-- nobody bidding, which leaves the lander standing on an unowned farm in phase
-- 'act' - and a hand-started auction would let them run the whole thing again,
-- and again, from the one seat that has already declined it at every price.
--
-- ---------------------------------------------------------------------------
-- What this migration re-creates, and why
-- ---------------------------------------------------------------------------
--   mono_auction_open  NEW. The rotation and the auction object, lifted out of
--                      game_action's auction_start branch so the automatic
--                      auction and the manual one cannot drift apart.
--   mono_land          re-created. Only the farm branch differs. The signature
--                      is unchanged, so create-or-replace is safe here: there
--                      is no second overload for it to leave behind.
--   game_action        re-created in full from 20260921100000_alliance_war.sql
--                      (it is one create-or-replace; there is no way to patch a
--                      branch of it). The signature is unchanged. What differs:
--                      the buy and auction_start refusals, auction_start going
--                      through mono_auction_open, `gm - 'farmAuction'` on the
--                      way in, and the farm block in the tail.
--
-- No function in this file changes its argument list, so nothing here needs a
-- drop-and-recreate and no stale overload can survive it.

-- ---------------------------------------------------------------------------
-- Opening an auction
--
-- The rotation is exactly what auction_start has always built: every player
-- who is not bankrupt, ordered from the one sitting after `starter` round to
-- `starter` themselves, who therefore bids LAST. The starter is in the
-- rotation - they are a bidder like everybody else, which is the whole point
-- when the auction was opened by their own landing.
--
-- `n` is the length of the players array INCLUDING bankrupt seats, because it
-- is the modulus of the seat-order arithmetic and not a count of bidders; the
-- bankrupt seats are filtered out afterwards, leaving a shorter rotation that
-- is still in the right order. This is the arithmetic that was inline in
-- auction_start, moved here unchanged.
--
-- Returns `st` untouched when there is nobody to bid at all - an empty room, a
-- table where everyone is bankrupt, a starter who is not in the players array.
-- The caller reads st->auction back to find out which happened: auction_start
-- turns "nobody" into an error for the player who asked, the farm block in the
-- tail just leaves the farm where it is.
-- ---------------------------------------------------------------------------

create or replace function public.mono_auction_open(
  st      jsonb,
  starter text,
  cell_id integer
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  players jsonb := case when jsonb_typeof(st->'players') = 'array'
                        then st->'players' else '[]'::jsonb end;
  n       integer := jsonb_array_length(players);
  s_idx   integer;
  s_ord   integer;
  ord     jsonb;
begin
  if n = 0 then
    return st;
  end if;
  s_idx := public.mono_idx(players, 'figure', starter);
  if s_idx is null then
    return st;
  end if;
  s_ord := (players->s_idx->>'order')::integer;

  select coalesce(jsonb_agg(p->'figure'
           order by (((p->>'order')::integer - s_ord - 1 + n) % n)), '[]'::jsonb)
    into ord
    from jsonb_array_elements(players) as p
   where not coalesce((p->>'bankrupt')::boolean, false);

  if jsonb_array_length(ord) = 0 then
    return st;
  end if;

  st := jsonb_set(st, '{auction}', jsonb_build_object(
    'cell',      cell_id,
    'startedBy', starter,
    'bid',       0,
    'leader',    null,
    'order',     ord,
    'in',        ord,
    'turn',      ord->>0,
    'last',      '{}'::jsonb
  ));
  return public.mono_event(st, jsonb_build_object(
    'type', 'auction_start', 'figure', starter, 'cell', cell_id
  ));
end;
$$;

comment on function public.mono_auction_open(jsonb, text, integer) is
  'Opens an auction on <cell_id> started by <starter>: rotation, auction object and the auction_start event. Returns st unchanged when nobody can bid. 20260921160000_farm_auction.sql.';

-- ---------------------------------------------------------------------------
-- Landing
--
-- Re-created from 20260921100000_alliance_war.sql with one change, in the farm
-- branch: a landing on a farm that NOBODY OWNS leaves an auction request on
-- `game` for game_action to pick up. Everything else - the rent branch, the
-- ally commission, the casino, the cards - is that file's version verbatim.
-- ---------------------------------------------------------------------------

create or replace function public.mono_land(
  st        jsonb,
  idx       integer,
  dice_sum  integer,
  road_mult integer default 1
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  fig        text := st->'players'->idx->>'figure';
  pos        integer := greatest(coalesce((st->'players'->idx->>'position')::integer, 1), 1);
  cell       jsonb := st->'board'->(pos::text);
  kind       text := public.mono_cell_kind(cell);
  owner      text;
  owner_idx  integer;
  card       jsonb;
  pot        integer;
  income     integer;
  cash       integer;
  due        jsonb;
  had        integer;
  paid       integer;
  comm_idx   integer;
  comm       integer;
begin
  st := public.mono_event(st, jsonb_build_object(
    'type', 'land', 'figure', fig, 'cell', pos, 'kind', kind
  ));

  if kind in ('street', 'road') then
    owner := public.mono_owner(cell);
    if owner is not null and owner <> fig then
      owner_idx := public.mono_idx(st->'players', 'figure', owner);
      if owner_idx is not null and not public.mono_is_bankrupt(st, owner_idx) then
        if coalesce((st->'players'->owner_idx->>'inJail')::boolean, false) then
          -- A landlord behind bars cannot send anyone a bill. The money is not
          -- redirected to the bank or to the pot, it is simply never charged.
          st := public.mono_event(st, jsonb_build_object(
            'type', 'rentFree', 'figure', fig, 'owner', owner,
            'cell', pos, 'reason', 'ownerInJail'
          ));
        elsif public.mono_are_allies(st, fig, owner) then
          st := public.mono_event(st, jsonb_build_object(
            'type', 'rentFree', 'figure', fig, 'owner', owner,
            'cell', pos, 'reason', 'ally'
          ));
        else
          due := public.mono_rent_due(st, pos::text, fig, dice_sum, road_mult);
          had := public.mono_money(st, owner_idx);
          st  := public.mono_charge(st, idx, (due->>'amount')::integer,
                                    owner_idx, 'rent', pos, due->'mods');
          -- 10% of what the landlord ACTUALLY banked, printed by the bank and
          -- handed to whoever the landlord is allied with. Never carved out of
          -- the rent: the landlord keeps every dollar of it.
          paid := public.mono_money(st, owner_idx) - had;
          if paid > 0 then
            comm_idx := public.mono_ally_idx(st, owner_idx);
            if comm_idx is not null then
              comm := floor(paid::numeric * 10 / 100)::integer;
              if comm > 0 then
                st := public.mono_credit(st, comm_idx, comm, 'commission');
                st := public.mono_event(st, jsonb_build_object(
                  'type', 'commission',
                  'figure', st->'players'->comm_idx->>'figure',
                  'payer', fig, 'owner', owner, 'amount', comm, 'cell', pos
                ));
              end if;
            end if;
          end if;
        end if;
      end if;
    end if;

  elsif kind = 'tax' then
    st := public.mono_charge(st, idx, coalesce((cell->>'price')::integer, 0), null, 'tax', pos);

  elsif kind = 'parking' then
    pot := coalesce((st->'game'->>'pot')::integer, 0);
    if pot > 0 then
      -- zero it BEFORE the credit: mono_credit can be followed by anything in
      -- a later migration, and a pot that is still readable after it has been
      -- paid out is the classic way to pay it twice
      st := jsonb_set(st, '{game,pot}', '0'::jsonb);
      st := public.mono_credit(st, idx, pot, 'pot');
      st := public.mono_event(st, jsonb_build_object(
        'type', 'pot', 'figure', fig, 'cell', pos, 'amount', pot
      ));
    end if;

  elsif kind = 'farm' then
    owner  := public.mono_owner(cell);
    income := greatest(coalesce((cell->>'income')::integer, 50), 50);
    if owner is not null and owner = fig then
      -- the owner came to collect: the whole counter, printed by the bank,
      -- and the field starts growing again from 50
      st := jsonb_set(st, array['board', pos::text, 'income'], '50'::jsonb);
      st := public.mono_credit(st, idx, income, 'farm');
      st := public.mono_event(st, jsonb_build_object(
        'type', 'farm', 'stage', 'harvest', 'figure', fig, 'cell', pos,
        'amount', income, 'income', 50
      ));
    else
      -- anybody else - including everybody while it is still unowned - pays
      -- nothing and leaves the crop 150$ bigger for whoever holds the deed
      income := income + 150;
      st := jsonb_set(st, array['board', pos::text, 'income'], to_jsonb(income));
      st := public.mono_event(st, jsonb_build_object(
        'type', 'farm', 'stage', 'grow', 'figure', fig, 'cell', pos,
        'amount', 0, 'income', income
      ));
      if owner is null then
        -- AND, because nobody owns it, the whole table is about to bid for it.
        -- The watering above still counts: the landing that opens the auction
        -- grows the crop exactly like any other visit, so the deed the winner
        -- carries off is already 150$ richer than it was a moment ago.
        --
        -- This is a REQUEST, not the auction itself. mono_land is a jsonb
        -- helper: it has no phase, no turn, and no idea whether the player who
        -- just landed is still solvent after everything else this action did to
        -- them. So it leaves a note where the casino leaves its pending bet -
        -- on `game` - and game_action reads it back at the bottom, checks it
        -- against the finished state and opens the real auction there.
        --
        -- Unlike game.casino this key never reaches the row: the `gm` that
        -- game_action builds at the end does not list it, so it lives for
        -- exactly one action and cannot go stale.
        st := jsonb_set(st, '{game,farmAuction}', jsonb_build_object(
          'cell', pos, 'figure', fig
        ));
      end if;
    end if;

  elsif kind = 'casino' then
    cash := public.mono_money(st, idx);
    if cash > 0 then
      st := jsonb_set(st, '{game,casino}', jsonb_build_object(
        'cell',   pos,
        'figure', fig,
        'min',    public.mono_casino_min_bet(cash),
        'max',    cash
      ));
      st := public.mono_event(st, jsonb_build_object(
        'type', 'casino', 'stage', 'enter', 'figure', fig, 'cell', pos,
        'min', public.mono_casino_min_bet(cash), 'max', cash
      ));
    end if;
    -- a player with no cash left has nothing to bet: the house waves them
    -- through rather than deadlocking the room on an impossible action

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
  -- start: the bonus is paid by mono_move_to; jail (visiting): nothing

  return st;
end;
$$;

comment on function public.mono_land(jsonb, integer, integer, integer) is
  'Resolves the cell a player stands on. A landing on the UNOWNED farm leaves an auction request on game.farmAuction for game_action to open. 20260921160000_farm_auction.sql.';

-- ---------------------------------------------------------------------------
-- game_action
--
-- Re-created in full from 20260921100000_alliance_war.sql (it is one
-- create-or-replace, so there is no way to patch a single branch). Same
-- signature, same actions, same messages. What differs:
--
--   * `buy` refuses a farm, and `auction_start` refuses a farm;
--   * `auction_start` builds its auction through mono_auction_open instead of
--     inline, so it and the farm's automatic auction are the same code;
--   * the incoming `gm` is stripped of `farmAuction`, which only a hand-edited
--     row could carry;
--   * a new block in the tail, beside the casino's, turns the request mono_land
--     left into a real auction and puts the room in phase 'auction'.
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

  -- the parking pot and the casino
  pot        integer;
  cas        jsonb;
  cas_game   text;
  cas_pick   text;
  cas_bet    integer;
  cas_res    jsonb;
  cas_idx    integer;

  -- the farm's pending auction request, left on `game` by mono_land
  fa         jsonb;
  fa_idx     integer;

  -- diplomacy
  round      integer;
  turn0      integer;
  allies     jsonb;
  offers     jsonb;
  wars       jsonb;
  winners    jsonb;
  war_row    jsonb;
  war_id     integer;
  sides      jsonb;
  other_fig  text;
  o_idx      integer;
  cut        integer;
  side_fig   text;
  found_at   integer;
  new_arr    jsonb;
  peace_amt  integer;
  w_fig      text;
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
  pot     := coalesce((gm->>'pot')::integer, 0);

  -- Diplomacy, all of it coalesced: a room that was opened before this
  -- migration has none of these keys and must not blow up on the next tap.
  round   := greatest(coalesce((gm->>'round')::integer, 1), 1);
  turn0   := turn;
  winners := case when jsonb_typeof(gm->'winners') = 'array' then gm->'winners' else '[]'::jsonb end;
  if winner is not null and jsonb_array_length(winners) = 0 then
    winners := jsonb_build_array(winner);   -- an older row that won before pairs could
  end if;
  -- alliances / offers / wars live inside `gm` and are carried by `st` from
  -- here on, so every helper that mutates them writes through jsonb_set on
  -- '{game,...}' and the end of this function reads them back out of `st`.
  gm := gm || jsonb_build_object(
    'round',      round,
    'alliances',  case when jsonb_typeof(gm->'alliances')  = 'array' then gm->'alliances'  else '[]'::jsonb end,
    'allyOffers', case when jsonb_typeof(gm->'allyOffers') = 'array' then gm->'allyOffers' else '[]'::jsonb end,
    'wars',       case when jsonb_typeof(gm->'wars')       = 'array' then gm->'wars'       else '[]'::jsonb end);

  if jsonb_typeof(gm->'lastCard') is distinct from 'object' then
    gm := gm - 'lastCard';
  end if;

  -- The farm's auction request is an intra-action signal and nothing else: it
  -- is written by mono_land during a landing and consumed at the bottom of this
  -- function, and the `gm` built down there does not carry it, so it can never
  -- reach the row. Stripping it on arrival costs one operation and means the
  -- only way it COULD be present - a hand-edited row - behaves like every other
  -- room instead of auctioning the farm on the next unrelated tap.
  gm := gm - 'farmAuction';

  -- json null and a missing key both mean "not running" / "nothing pending"
  auc := case when jsonb_typeof(gm->'auction') = 'object' then gm->'auction' end;
  tr  := case when jsonb_typeof(gm->'trade')   = 'object' then gm->'trade'   end;
  cas := case when jsonb_typeof(gm->'casino')  = 'object' then gm->'casino'  end;
  if auc is null and phase = 'auction' then
    phase := 'act';  -- defensive: a phase left behind without its auction
  end if;
  if cas is null and phase = 'casino' then
    phase := 'act';  -- same, for a casino block that went missing
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
                'auction_start', 'auction_bid', 'auction_drop', 'casino_play',
                'trade_offer', 'trade_accept', 'trade_decline', 'trade_cancel', 'trade_counter',
                'ally_propose', 'ally_accept', 'ally_decline', 'ally_cancel', 'ally_break',
                'war_declare', 'peace_propose', 'peace_accept', 'peace_decline', 'backstab') then
    if phase = 'over' then
      raise exception 'The game is over';
    end if;
    if coalesce((me->>'bankrupt')::boolean, false) then
      raise exception 'You are bankrupt';
    end if;
  end if;

  -- Nothing but bidding, dropping, skipping and leaving happens in an auction.
  -- The diplomacy verbs listed here are the OWN-TURN ones: proposing, breaking,
  -- declaring and backstabbing all belong to a turn that the auction has taken
  -- over. Answering somebody else's proposal is not on that list on purpose.
  if phase = 'auction'
     and action in ('roll', 'move', 'buy', 'build', 'pay_jail', 'use_jail_card', 'end_turn',
                    'auction_start', 'casino_play',
                    'trade_offer', 'trade_accept', 'trade_decline', 'trade_cancel', 'trade_counter',
                    'ally_propose', 'ally_break', 'war_declare', 'peace_propose', 'backstab') then
    raise exception 'An auction is running';
  end if;

  -- Landing on the casino is mandatory, and "mandatory" is enforced here: the
  -- player cannot buy, build, trade, auction or end their turn around it. Only
  -- casino_play clears it (or skip_turn / leave, for a phone that went away).
  if phase = 'casino'
     and action in ('roll', 'move', 'buy', 'build', 'pay_jail', 'use_jail_card', 'end_turn',
                    'auction_start', 'auction_bid', 'auction_drop',
                    'trade_offer', 'trade_accept', 'trade_decline', 'trade_cancel', 'trade_counter',
                    'ally_propose', 'ally_break', 'war_declare', 'peace_propose', 'backstab') then
    raise exception 'The casino is waiting';
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
      'bankrupt',  false,
      -- diplomacy starts clean: no brand, no brand clock, and the one gambit
      -- of the game still in hand
      'traitor',      false,
      'traitorUntil', 0,
      'backstabUsed', false
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
          -- third failed roll: pay the fine and move anyway. The fine goes to
          -- the bank and NOT to the parking pot - it is the price of freedom,
          -- not a penalty the table gets to share.
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
    -- The Weed Farm is never sold over the counter. Landing on it while it is
    -- unowned opens an auction for the whole table (mono_land leaves the
    -- request, the block at the bottom of this function opens it), so there is
    -- no moment at which buying it could be legal - not even the moment just
    -- after an auction found no bidder, which is exactly when a phone that has
    -- not been updated would be most tempted to offer a Buy button. The farm
    -- keeps its 150$ price for everything else that reads one (trades, the deed
    -- card, a bot's idea of what it is worth); only this one door is shut.
    if public.mono_cell_kind(cell) = 'farm' then
      raise exception 'The farm is only ever sold at auction';
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
    -- straight to the bank, deliberately not through mono_charge: the fine is
    -- not a fine the table shares, it never touches the parking pot
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
  -- Casino
  -- -------------------------------------------------------------------------
  elsif action = 'casino_play' then
    if cas is null or phase <> 'casino' then
      raise exception 'The casino is not waiting for you';
    end if;
    if my_order <> turn or cas->>'figure' is distinct from fig then
      raise exception 'The casino is not waiting for you';
    end if;

    cas_game := payload->>'game';
    if cas_game is null or cas_game not in ('slots', 'roulette', 'wheel') then
      raise exception 'Pick slots, roulette or wheel';
    end if;
    cas_pick := payload->>'colour';
    if cas_game = 'roulette' then
      if cas_pick is null or cas_pick not in ('red', 'black', 'green') then
        raise exception 'Pick red, black or green';
      end if;
    else
      cas_pick := null;   -- the other two games have nothing to choose
    end if;

    amt := (payload->>'bet')::numeric;
    if amt is null then
      raise exception 'casino_play needs a bet';
    end if;
    if amt <> trunc(amt) then
      raise exception 'The bet must be a whole number';
    end if;
    cas_bet := amt::integer;
    -- The floor and the ceiling are recomputed from the money the player has
    -- RIGHT NOW rather than read out of the pending block: the block is a hint
    -- for the slider, never an authority, and trusting it would let a stale
    -- phone bet money that has since gone to a landlord.
    min_bid := public.mono_casino_min_bet(money);
    if cas_bet > money then
      raise exception 'Not enough money';
    end if;
    if cas_bet < min_bid then
      raise exception 'Bet at least %$', min_bid;
    end if;

    cas_res := public.mono_casino_spin(cas_game, cas_bet, cas_pick);
    -- Two movements, never one net figure - see the payout convention at the
    -- top of this file. The bank is the house: the bet vanishes into it and
    -- the payout is printed by it, so neither side touches the parking pot.
    st := public.mono_charge(st, me_idx, cas_bet, null, 'casino', (cas->>'cell')::integer);
    st := public.mono_credit(st, me_idx, (cas_res->>'payout')::integer, 'casino');
    st := public.mono_event(st, jsonb_build_object(
      'type', 'casino', 'stage', 'result', 'figure', fig,
      'cell', (cas->>'cell')::integer, 'game', cas_game, 'bet', cas_bet,
      'mult', cas_res->'mult', 'payout', (cas_res->>'payout')::integer,
      'result', cas_res
    ));
    st  := jsonb_set(st, '{game,casino}', 'null'::jsonb);
    cas := null;
    -- one play per landing: back to a normal `act`, and end_turn follows
    phase := 'act';

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
    -- The farm starts its own auction and is the only cell that does. Letting a
    -- player start a second one by hand would hand them a re-run of an auction
    -- the table has just finished - every no-bid ending followed by "and
    -- again", asked for by the one seat that did not want it at any price
    -- either. Refused rather than quietly ignored, because the phone shows this
    -- sentence to the player and "nothing happened" explains nothing.
    if public.mono_cell_kind(cell) = 'farm' then
      raise exception 'The farm auctions itself when somebody lands on it';
    end if;

    -- an auction replaces whatever was on the table
    st := public.mono_trade_clear(st, 'cancelled');
    tr := null;

    -- The rotation, the auction object and the auction_start event all come out
    -- of mono_auction_open now, so an auction a player starts and the one the
    -- farm starts by itself are the SAME auction in every respect. There is no
    -- second copy of the rotation arithmetic that could drift from this one.
    st  := public.mono_auction_open(st, fig, cell_id);
    auc := case when jsonb_typeof(st->'auction') = 'object' then st->'auction' end;
    if auc is null then
      raise exception 'Nobody can bid';
    end if;
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
  -- Alliances
  --
  -- Shaped after a trade offer, which is the closest thing the room already
  -- had to "I propose, you answer": the proposal lives in `game`, either side
  -- can withdraw it, and it is re-validated when it is accepted because a war
  -- can have been declared in between.
  -- -------------------------------------------------------------------------
  elsif action = 'ally_propose' then
    if my_order <> turn then
      raise exception 'You can only propose an alliance on your turn';
    end if;
    if phase not in ('roll', 'act') then
      raise exception 'You cannot do that right now';
    end if;
    tgt_fig := payload->>'to';
    why := public.mono_can_ally(st, fig, tgt_fig);
    if why is not null then
      raise exception '%', why;
    end if;
    offers := case when jsonb_typeof(st->'game'->'allyOffers') = 'array'
                   then st->'game'->'allyOffers' else '[]'::jsonb end;
    -- one conversation at a time between any two players, in either direction:
    -- two crossing proposals would let both sides "accept" and race
    if exists (
      select 1 from jsonb_array_elements(offers) as o
       where (o->>'from' = fig and o->>'to' = tgt_fig)
          or (o->>'from' = tgt_fig and o->>'to' = fig)
    ) then
      raise exception 'There is already an offer between you';
    end if;
    st := jsonb_set(st, '{game,allyOffers}',
      offers || jsonb_build_array(jsonb_build_object('from', fig, 'to', tgt_fig)));
    st := public.mono_event(st, jsonb_build_object(
      'type', 'ally', 'stage', 'propose', 'from', fig, 'to', tgt_fig));

  -- -------------------------------------------------------------------------
  elsif action = 'ally_accept' then
    other_fig := payload->>'from';
    offers := case when jsonb_typeof(st->'game'->'allyOffers') = 'array'
                   then st->'game'->'allyOffers' else '[]'::jsonb end;
    if other_fig is null or not exists (
      select 1 from jsonb_array_elements(offers) as o
       where o->>'from' = other_fig and o->>'to' = fig
    ) then
      raise exception 'There is no offer to answer';
    end if;
    -- `fig` first, so every sentence that comes back says "you" about the
    -- player who is tapping the button
    why := public.mono_can_ally(st, fig, other_fig);
    if why is not null then
      raise exception '%', why;
    end if;
    st := jsonb_set(st, '{game,alliances}',
      (case when jsonb_typeof(st->'game'->'alliances') = 'array'
            then st->'game'->'alliances' else '[]'::jsonb end)
      || jsonb_build_array(jsonb_build_object('a', other_fig, 'b', fig, 'since', round)));
    -- both are spoken for now, so every other proposal either of them was part
    -- of is dead on arrival
    st := public.mono_ally_offers_purge(st, other_fig);
    st := public.mono_ally_offers_purge(st, fig);
    st := public.mono_event(st, jsonb_build_object(
      'type', 'ally', 'stage', 'form', 'a', other_fig, 'b', fig));

  -- -------------------------------------------------------------------------
  elsif action = 'ally_decline' then
    other_fig := payload->>'from';
    offers := case when jsonb_typeof(st->'game'->'allyOffers') = 'array'
                   then st->'game'->'allyOffers' else '[]'::jsonb end;
    if other_fig is null or not exists (
      select 1 from jsonb_array_elements(offers) as o
       where o->>'from' = other_fig and o->>'to' = fig
    ) then
      raise exception 'There is no offer to answer';
    end if;
    select coalesce(jsonb_agg(t.v order by t.i), '[]'::jsonb) into new_arr
      from jsonb_array_elements(offers) with ordinality as t(v, i)
     where not (t.v->>'from' = other_fig and t.v->>'to' = fig);
    st := jsonb_set(st, '{game,allyOffers}', new_arr);
    st := public.mono_event(st, jsonb_build_object(
      'type', 'ally', 'stage', 'decline', 'from', other_fig, 'to', fig));

  -- -------------------------------------------------------------------------
  elsif action = 'ally_cancel' then
    tgt_fig := payload->>'to';
    offers := case when jsonb_typeof(st->'game'->'allyOffers') = 'array'
                   then st->'game'->'allyOffers' else '[]'::jsonb end;
    if tgt_fig is null or not exists (
      select 1 from jsonb_array_elements(offers) as o
       where o->>'from' = fig and o->>'to' = tgt_fig
    ) then
      raise exception 'There is no offer to cancel';
    end if;
    select coalesce(jsonb_agg(t.v order by t.i), '[]'::jsonb) into new_arr
      from jsonb_array_elements(offers) with ordinality as t(v, i)
     where not (t.v->>'from' = fig and t.v->>'to' = tgt_fig);
    st := jsonb_set(st, '{game,allyOffers}', new_arr);
    st := public.mono_event(st, jsonb_build_object(
      'type', 'ally', 'stage', 'cancel', 'from', fig, 'to', tgt_fig));

  -- -------------------------------------------------------------------------
  elsif action = 'ally_break' then
    if my_order <> turn then
      raise exception 'You can only break an alliance on your turn';
    end if;
    if phase not in ('roll', 'act') then
      raise exception 'You cannot do that right now';
    end if;
    other_fig := public.mono_ally_of(st, fig);
    if other_fig is null then
      raise exception 'You are not in an alliance';
    end if;
    -- free, and no brand: walking away openly is the honest move, which is the
    -- whole reason `backstab` can charge a price for the dishonest one
    st := public.mono_ally_dissolve(st, fig);
    st := public.mono_event(st, jsonb_build_object(
      'type', 'ally', 'stage', 'break', 'figure', fig, 'other', other_fig));

  -- -------------------------------------------------------------------------
  -- War
  -- -------------------------------------------------------------------------
  elsif action = 'war_declare' then
    if my_order <> turn then
      raise exception 'You can only declare war on your turn';
    end if;
    if phase not in ('roll', 'act') then
      raise exception 'You cannot do that right now';
    end if;
    tgt_fig := payload->>'target';
    t_idx   := public.mono_idx(st->'players', 'figure', tgt_fig);
    if tgt_fig is null or t_idx is null then
      raise exception 'That player is not in this room';
    end if;
    if tgt_fig = fig then
      raise exception 'You cannot declare war on yourself';
    end if;
    if public.mono_is_bankrupt(st, t_idx) then
      raise exception 'That player is bankrupt';
    end if;
    if public.mono_are_allies(st, fig, tgt_fig) then
      raise exception 'You cannot declare war on your ally';
    end if;
    if money < 500 then
      raise exception 'Not enough money';
    end if;

    war_row := jsonb_build_object(
      'id',         seq,
      'declarer',   fig,
      'target',     tgt_fig,
      'startRound', round,
      'endsRound',  round + 5,
      'peace',      null);
    -- Four people can be dragged into one declaration, and none of them may
    -- already owe double rent somewhere else: two overlapping wars would ask
    -- the rent rules to double twice for reasons a player cannot see.
    sides := public.mono_war_sides(st, war_row);
    -- the parentheses are load-bearing: `->` and `||` sit on the same
    -- precedence level and associate LEFT, so `sides->'a' || sides->'b'`
    -- silently parses as `((sides->'a') || sides)->'b'` and yields null
    for side_fig in
      select t.v#>>'{}' from jsonb_array_elements((sides->'a') || (sides->'b')) as t(v)
    loop
      if public.mono_in_any_war(st, side_fig) then
        raise exception 'Somebody here is already at war';
      end if;
    end loop;

    -- 500$ to the BANK. Deliberately not into the parking pot: a declaration
    -- is a price paid for a status, not a fine the table gets to share.
    st := public.mono_charge(st, me_idx, 500, null, 'warFee');
    st := jsonb_set(st, '{game,wars}',
      (case when jsonb_typeof(st->'game'->'wars') = 'array'
            then st->'game'->'wars' else '[]'::jsonb end)
      || jsonb_build_array(war_row));
    st := public.mono_event(st, jsonb_build_object(
      'type', 'war', 'stage', 'declare', 'declarer', fig, 'target', tgt_fig,
      'sideA', sides->'a', 'sideB', sides->'b', 'endsRound', round + 5));

  -- -------------------------------------------------------------------------
  elsif action = 'peace_propose' then
    if my_order <> turn then
      raise exception 'You can only offer peace on your turn';
    end if;
    if phase not in ('roll', 'act') then
      raise exception 'You cannot do that right now';
    end if;
    war_id := (payload->>'warId')::integer;
    wars   := case when jsonb_typeof(st->'game'->'wars') = 'array'
                   then st->'game'->'wars' else '[]'::jsonb end;
    select t.v into war_row
      from jsonb_array_elements(wars) as t(v)
     where (t.v->>'id')::integer = war_id
     limit 1;
    if war_id is null or war_row is null then
      raise exception 'There is no such war';
    end if;
    if fig not in (war_row->>'declarer', war_row->>'target') then
      raise exception 'Only the two sides can make peace';
    end if;
    amt := coalesce((payload->>'amount')::numeric, 0);
    if amt < 0 then
      raise exception 'A peace payment cannot be negative';
    end if;
    if amt <> trunc(amt) then
      raise exception 'The payment must be a whole number';
    end if;
    if amt > money then
      raise exception 'You do not have that much cash';
    end if;
    peace_amt := amt::integer;
    select coalesce(jsonb_agg(
             case when (t.v->>'id')::integer = war_id
                  then jsonb_set(t.v, '{peace}',
                         jsonb_build_object('from', fig, 'amount', peace_amt))
                  else t.v end order by t.i), '[]'::jsonb)
      into new_arr
      from jsonb_array_elements(wars) with ordinality as t(v, i);
    st := jsonb_set(st, '{game,wars}', new_arr);
    st := public.mono_event(st, jsonb_build_object(
      'type', 'war', 'stage', 'peaceOffer', 'warId', war_id,
      'from', fig, 'amount', peace_amt));

  -- -------------------------------------------------------------------------
  elsif action in ('peace_accept', 'peace_decline') then
    war_id := (payload->>'warId')::integer;
    wars   := case when jsonb_typeof(st->'game'->'wars') = 'array'
                   then st->'game'->'wars' else '[]'::jsonb end;
    select t.v into war_row
      from jsonb_array_elements(wars) as t(v)
     where (t.v->>'id')::integer = war_id
     limit 1;
    if war_id is null or war_row is null then
      raise exception 'There is no such war';
    end if;
    if jsonb_typeof(war_row->'peace') <> 'object' then
      raise exception 'There is no peace offer to answer';
    end if;
    other_fig := war_row->'peace'->>'from';
    if fig not in (war_row->>'declarer', war_row->>'target') or fig = other_fig then
      raise exception 'This offer is not yours to answer';
    end if;
    peace_amt := coalesce((war_row->'peace'->>'amount')::integer, 0);

    if action = 'peace_decline' then
      select coalesce(jsonb_agg(
               case when (t.v->>'id')::integer = war_id
                    then jsonb_set(t.v, '{peace}', 'null'::jsonb)
                    else t.v end order by t.i), '[]'::jsonb)
        into new_arr
        from jsonb_array_elements(wars) with ordinality as t(v, i);
      st := jsonb_set(st, '{game,wars}', new_arr);
      st := public.mono_event(st, jsonb_build_object(
        'type', 'war', 'stage', 'peaceDecline', 'warId', war_id,
        'from', other_fig, 'amount', peace_amt));
    else
      o_idx := public.mono_idx(st->'players', 'figure', other_fig);
      if o_idx is null then
        raise exception 'That player is not in this room';
      end if;
      -- The purse can have emptied between the offer and the answer. Refusing
      -- here rolls the whole call back, which leaves the offer standing and
      -- lets the other side decline it instead of quietly getting less than
      -- they were promised.
      if peace_amt > 0 and public.mono_money(st, o_idx) < peace_amt then
        raise exception 'They can no longer pay what they promised';
      end if;
      if peace_amt > 0 then
        st := public.mono_patch_player(st, o_idx, jsonb_build_object(
          'money', public.mono_money(st, o_idx) - peace_amt));
        st := public.mono_patch_player(st, me_idx, jsonb_build_object(
          'money', public.mono_money(st, me_idx) + peace_amt));
        st := public.mono_event(st, jsonb_build_object(
          'type', 'pay', 'figure', other_fig, 'to', fig,
          'amount', peace_amt, 'reason', 'peace', 'cell', null));
      end if;
      select coalesce(jsonb_agg(t.v order by t.i), '[]'::jsonb) into new_arr
        from jsonb_array_elements(wars) with ordinality as t(v, i)
       where (t.v->>'id')::integer is distinct from war_id;
      st := jsonb_set(st, '{game,wars}', new_arr);
      -- peace covers both whole sides, which needs no extra work: the sides
      -- only ever existed as a reading of this one row
      st := public.mono_event(st, jsonb_build_object(
        'type', 'war', 'stage', 'peace', 'warId', war_id, 'amount', peace_amt));
    end if;

  -- -------------------------------------------------------------------------
  -- Backstab
  -- -------------------------------------------------------------------------
  elsif action = 'backstab' then
    if my_order <> turn then
      raise exception 'You can only backstab on your turn';
    end if;
    if phase not in ('roll', 'act') then
      raise exception 'You cannot do that right now';
    end if;
    if coalesce((me->>'backstabUsed')::boolean, false) then
      raise exception 'You only have one backstab in you';
    end if;
    other_fig := public.mono_ally_of(st, fig);
    if other_fig is null then
      raise exception 'You are not in an alliance';
    end if;
    o_idx := public.mono_idx(st->'players', 'figure', other_fig);
    if o_idx is null then
      raise exception 'You are not in an alliance';
    end if;

    -- 15% of what the victim is holding right now, floored. Not a charge: this
    -- money cannot bankrupt anybody and never reaches for a third pocket.
    cut := floor(public.mono_money(st, o_idx)::numeric * 15 / 100)::integer;
    if cut > 0 then
      st := public.mono_patch_player(st, o_idx, jsonb_build_object(
        'money', public.mono_money(st, o_idx) - cut));
      st := public.mono_patch_player(st, me_idx, jsonb_build_object(
        'money', public.mono_money(st, me_idx) + cut));
      st := public.mono_event(st, jsonb_build_object(
        'type', 'pay', 'figure', other_fig, 'to', fig,
        'amount', cut, 'reason', 'backstab', 'cell', null));
    end if;
    -- silent: the `backstab` event below is a better sentence than "the
    -- alliance dissolved" and the UI should only tell the story once
    st := public.mono_ally_dissolve(st, fig);
    st := public.mono_patch_player(st, me_idx, jsonb_build_object(
      'traitor', true, 'traitorUntil', round + 5, 'backstabUsed', true));
    -- the brand is permanent, so any proposal they had out is now impossible
    st := public.mono_ally_offers_purge(st, fig);
    st := public.mono_event(st, jsonb_build_object(
      'type', 'backstab', 'figure', fig, 'victim', other_fig, 'amount', cut));

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

    if cas is not null and phase = 'casino' then
      -- a phone that went to sleep at the table must not hold the room: the
      -- house lets this one go unplayed and the turn moves on
      st  := jsonb_set(st, '{game,casino}', 'null'::jsonb);
      st  := public.mono_event(st, jsonb_build_object(
        'type', 'casino', 'stage', 'skipped', 'figure', cas->>'figure',
        'cell', (cas->>'cell')::integer
      ));
      cas := null;
      st := public.mono_trade_clear(st, 'cancelled');
      tr := null;
      turn := public.mono_next_turn(st->'players', turn);
      doubles := 0;
      phase := 'roll';
      st := public.mono_event(st, jsonb_build_object('type', 'skip', 'order', turn));
    elsif auc is not null and phase = 'auction' then
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

    -- and so does every diplomatic tie. Done here rather than in the reconcile
    -- at the bottom because the player is about to be spliced out of `players`
    -- entirely, and after that nothing can tell "left" from "was never here".
    st := public.mono_ally_dissolve(st, fig, 'left');
    st := public.mono_wars_end_for(st, fig, 'left');
    st := public.mono_ally_offers_purge(st, fig);

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
    -- The payload comes straight off a phone, and a phone that has not
    -- reloaded still seeds "Communal / Light" and "Communal / Water". Normalise
    -- it here so a stale client cannot start a game with no casino and no farm.
    board := public.mono_upgrade_cells(payload->'position');
    start_id := coalesce(public.mono_cell_of_kind(board, 'start'), 1);

    -- everyone keeps their seat, everything else starts over
    select coalesce(jsonb_agg(
             p || jsonb_build_object(
               'money', 2500, 'position', start_id, 'inJail', false,
               'jailTurns', 0, 'jailCards', 0, 'bankrupt', false,
               -- a traitor is a traitor for the rest of THAT game, not of the
               -- evening: the brand, its clock and the one-shot gambit all
               -- come back with the money
               'traitor', false, 'traitorUntil', 0, 'backstabUsed', false
             ) order by (p->>'order')::integer), '[]'::jsonb)
      into players
      from jsonb_array_elements(players) as p;
    -- no tokens, no owners, no houses, and the farm counter back to seed,
    -- whatever the payload carried
    select jsonb_object_agg(e.key, (e.value - 'houses') || jsonb_build_object(
             'fig0', false, 'fig1', false, 'fig2', false, 'fig3', false,
             'fig4', false, 'fig5', false, 'fig6', false, 'fig7', false,
             'bought', jsonb_build_object(
               'fig0', false, 'fig1', false, 'fig2', false, 'fig3', false,
               'fig4', false, 'fig5', false, 'fig6', false, 'fig7', false))
           || case when public.mono_cell_kind(e.value) = 'farm'
                   then jsonb_build_object('income', 50) else '{}'::jsonb end)
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
    winners := '[]'::jsonb;
    auc     := null;   -- a running auction, a pending offer and an unplayed
    tr      := null;   -- bet all die with the game
    cas     := null;
    pot     := 0;
    -- and so do the alliances, the proposals nobody answered, the wars and the
    -- round counter. gm is rebuilt rather than patched so that a key added by
    -- some future migration cannot survive a new game by accident.
    round   := 1;
    gm      := jsonb_build_object(
      'round', 1, 'alliances', '[]'::jsonb,
      'allyOffers', '[]'::jsonb, 'wars', '[]'::jsonb);
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

  -- -------------------------------------------------------------------------
  -- Diplomacy, reconciled
  --
  -- A bankruptcy can happen anywhere inside a landing - a card that charges
  -- every player, a rent that an ally could not cover - so this is swept up
  -- here rather than at each of those call sites, the same way the pending
  -- trade offer above is. A bankrupt player's alliance dissolves, every war
  -- they were a PRINCIPAL in ends (an ally merely dropping off a side does
  -- not end anything), and their proposals go with them.
  -- -------------------------------------------------------------------------
  if n > 0 then
    for i in 0 .. n - 1 loop
      if public.mono_is_bankrupt(st, i) then
        w_fig := players->i->>'figure';
        st := public.mono_ally_dissolve(st, w_fig, 'bankrupt');
        st := public.mono_wars_end_for(st, w_fig, 'bankrupt');
        st := public.mono_ally_offers_purge(st, w_fig);
      end if;
    end loop;
  end if;

  -- The same sweep for figures that are not in the room at all. `leave` cleans
  -- up after itself, so this only ever fires on a row that was hand-edited or
  -- written by an older client; it costs one pass and it keeps game.alliances
  -- from ever naming somebody who is not there.
  for war_row in
    select v from jsonb_array_elements(
      case when jsonb_typeof(st->'game'->'alliances') = 'array'
           then st->'game'->'alliances' else '[]'::jsonb end) as t(v)
  loop
    if public.mono_idx(players, 'figure', war_row->>'a') is null
       or public.mono_idx(players, 'figure', war_row->>'b') is null then
      st := public.mono_ally_dissolve(st, war_row->>'a', 'left');
      st := public.mono_ally_dissolve(st, war_row->>'b', 'left');
    end if;
  end loop;
  for war_row in
    select v from jsonb_array_elements(
      case when jsonb_typeof(st->'game'->'wars') = 'array'
           then st->'game'->'wars' else '[]'::jsonb end) as t(v)
  loop
    if public.mono_idx(players, 'figure', war_row->>'declarer') is null then
      st := public.mono_wars_end_for(st, war_row->>'declarer', 'left');
    elsif public.mono_idx(players, 'figure', war_row->>'target') is null then
      st := public.mono_wars_end_for(st, war_row->>'target', 'left');
    end if;
  end loop;

  -- -------------------------------------------------------------------------
  -- The round
  --
  -- A round ends when the turn comes back round to the first player who is
  -- still in the game. That is checked HERE, once, rather than at each of the
  -- four places that call mono_next_turn, because all of them funnel through
  -- this block and only one of them - the bankrupt-seat skip directly above -
  -- can move the turn a second time in the same action.
  --
  -- new_game is excluded by name: it sets the turn back to 0, which would
  -- otherwise read as a wrap and tick the freshly reset counter to 2.
  -- -------------------------------------------------------------------------
  if action not in ('new_game', 'reset_board')
     and phase <> 'over'
     and n > 0
     and turn is distinct from turn0
     and turn = public.mono_first_active(players) then
    round := round + 1;
    st := public.mono_round_tick(st, round);
    players := st->'players';   -- upkeep moved money
  end if;

  -- read back after the round hook, which feeds the pot
  pot := coalesce((st->'game'->>'pot')::integer, 0);

  -- A bet can have been opened anywhere in this action - a roll, a debug move,
  -- or a Chance card that sent the player to the casino from the other side of
  -- the board - so the pending block is read back out of `st` rather than
  -- tracked branch by branch. A player who left or went broke on the way there
  -- owes the house nothing.
  cas := case when jsonb_typeof(st->'game'->'casino') = 'object' then st->'game'->'casino' end;
  if cas is not null then
    cas_idx := public.mono_idx(players, 'figure', cas->>'figure');
    if cas_idx is null or public.mono_is_bankrupt(st, cas_idx) then
      cas := null;
    end if;
  end if;
  if phase not in ('over', 'auction') then
    if cas is not null then
      phase := 'casino';
    elsif phase = 'casino' then
      phase := 'act';
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- The farm auctions itself
  --
  -- mono_land left a request on `game` when somebody landed on the UNOWNED
  -- farm. It is read back here, next to the casino's pending bet and for the
  -- same reason: the landing can have come from a roll, from the debug jump or
  -- from a Chance card that moved the player clear across the board, and
  -- tracking it branch by branch would mean getting it right in three places
  -- instead of one.
  --
  -- Everything the request is checked against is the FINISHED state of this
  -- action, never the state mono_land saw:
  --
  --   * the lander is still in the room and still solvent. The farm itself
  --     charges nothing, so the landing cannot bankrupt anybody - but a card
  --     can do plenty on the way there, and the block directly above has
  --     already moved the turn on if it did. No auction is opened for a seat
  --     that is out; the farm simply stays unowned and the next landing opens a
  --     fresh one, exactly as it does when nobody bids.
  --   * the lander holds the turn. An auction ends by handing the move back to
  --     whoever started it, so it only means anything inside somebody's turn.
  --     The debug `move` verb has no turn check, so teleporting a player whose
  --     turn it is NOT waters the crop and stops there.
  --   * nobody owns it after all, and no auction or bet already owns the room.
  --     A pending bet cannot co-occur with a farm landing (one landing, one
  --     cell), but if a hand-edited row ever manages it the mandatory bet wins
  --     and the request is dropped - which is self-healing, because the farm is
  --     still unowned and the next landing opens an auction.
  --
  -- What opens is the ORDINARY auction: same opening bid, same 10$ raise, same
  -- everybody-including-the-lander rotation. It ends through
  -- mono_auction_advance like every other one, which is what hands the turn
  -- back to the lander in phase 'act' with their doubles intact - the same
  -- resume a declined-buy auction has always had - and a no-bid ending leaves
  -- the farm with the bank for the next player to land on it.
  -- -------------------------------------------------------------------------
  fa := case when jsonb_typeof(st->'game'->'farmAuction') = 'object'
             then st->'game'->'farmAuction' end;
  if fa is not null
     and phase not in ('over', 'auction', 'casino')
     and auc is null and cas is null and n > 0 then
    fa_idx := public.mono_idx(players, 'figure', fa->>'figure');
    if fa_idx is not null
       and not public.mono_is_bankrupt(st, fa_idx)
       and (players->fa_idx->>'order')::integer = turn
       and public.mono_owner(st->'board'->(fa->>'cell')) is null then
      -- an auction replaces whatever was on the table, exactly as a player's
      -- own auction_start does
      st := public.mono_trade_clear(st, 'cancelled');
      tr := null;
      st := public.mono_auction_open(st, fa->>'figure', (fa->>'cell')::integer);
      auc := case when jsonb_typeof(st->'auction') = 'object' then st->'auction' end;
      if auc is not null then
        phase := 'auction';
      end if;
    end if;
  end if;

  -- Last one standing wins - or the last PAIR standing, if the two of them are
  -- allied. An alliance is the only way two players can be left and the game
  -- still be over; two survivors who are not allies still have a game to play.
  select count(*) into active
    from jsonb_array_elements(players) as p
   where not coalesce((p->>'bankrupt')::boolean, false);
  if winner is null and n >= 2 and active in (1, 2) then
    select coalesce(jsonb_agg(p->'figure' order by (p->>'order')::integer), '[]'::jsonb)
      into new_arr
      from jsonb_array_elements(players) as p
     where not coalesce((p->>'bankrupt')::boolean, false);
    if active = 1
       or public.mono_are_allies(st, new_arr->>0, new_arr->>1) then
      winners := new_arr;
      -- the legacy single-winner field keeps the first of them, so a screen
      -- that never heard of `winners` still has somebody to congratulate
      winner  := winners->>0;
      phase   := 'over';
      st := public.mono_event(st, jsonb_build_object(
        'type', 'win', 'figure', winner, 'figures', winners));
    end if;
  end if;
  if winner is not null then
    phase := 'over';
  end if;
  if phase = 'over' then
    -- nothing can be bid on, traded or wagered any more
    if jsonb_typeof(st->'trade') = 'object' then
      st := public.mono_trade_clear(st, 'expired');
    end if;
    st  := jsonb_set(st, '{auction}', 'null'::jsonb);
    cas := null;
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

  -- The diplomatic state is read back out of `st` rather than tracked in local
  -- variables: every verb and every helper above writes it through jsonb_set
  -- on '{game,...}', so `st` is the only copy that is always current.
  allies := case when jsonb_typeof(st->'game'->'alliances')  = 'array' then st->'game'->'alliances'  else '[]'::jsonb end;
  offers := case when jsonb_typeof(st->'game'->'allyOffers') = 'array' then st->'game'->'allyOffers' else '[]'::jsonb end;
  wars   := case when jsonb_typeof(st->'game'->'wars')       = 'array' then st->'game'->'wars'       else '[]'::jsonb end;
  round  := greatest(coalesce((st->'game'->>'round')::integer, round), 1);

  gm := jsonb_build_object(
    'seq',        seq,
    'phase',      phase,
    'doubles',    doubles,
    'dice',       dice,
    'actor',      pid,
    'action',     action,
    'events',     st->'events',
    'lastCard',   st->'game'->'lastCard',
    'winner',     winner,
    'log',        new_log,
    'auction',    st->'auction',
    'trade',      st->'trade',
    'pot',        pot,
    'casino',     case when cas is null then 'null'::jsonb else cas end,
    'round',      round,
    'alliances',  allies,
    'allyOffers', offers,
    'wars',       wars,
    'winners',    winners
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
  'Applies one game action to a room under a row lock. Actions: 20260918140000_game_rules.sql, auctions and trading from 20260919100000_auction_trade.sql, casino_play from 20260920170000_casino_farm_rebalance.sql, alliances / wars / backstab from 20260921100000_alliance_war.sql. The farm auctions itself on landing and can never be bought: 20260921160000_farm_auction.sql. Six seats, figures fig0..fig7.';

revoke all on function public.game_action(text, text, jsonb) from public;
grant execute on function public.game_action(text, text, jsonb) to anon, authenticated;
