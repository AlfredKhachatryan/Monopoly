-- Post-playtest rebalance, the Free Parking pot, and the two cells that used
-- to be utilities.
--
-- The playtest found no rules bugs; it found that a six-player game ran long
-- and that the two utilities were dead weight. Everything here follows from
-- those two observations:
--
--   1. Rents go up and the Start bonus goes down, so money leaves a player's
--      pocket faster than it comes back and the game closes out in 30-45 min.
--   2. Every fine the bank collects piles up on Free Parking instead of
--      vanishing, so the board has one big swing left in it late in the game.
--   3. A landlord sitting in jail collects nothing, which turns jail from a
--      pure annoyance into a real tactical cost.
--   4. Cell 13 ("Communal / Light") becomes a CASINO nobody can own, and
--      cell 28 ("Communal / Water") becomes a WEED FARM that pays its owner
--      only when the owner physically lands on it.
--
-- Applied AFTER 20260920100000_six_players.sql. Nothing in an already-applied
-- migration is edited; every function below is re-created in full.
--
-- ---------------------------------------------------------------------------
-- The numbers (these are the authority; src/Hooks/rules.js mirrors them)
-- ---------------------------------------------------------------------------
--   street base rent   price / 8          (was price / 10)
--   house multipliers  1 6 18 50 70 90    (was 1 5 15 45 60 75), index = houses,
--                                          5 = hotel; bare with the full colour
--                                          set is still base x 2
--   railroad rent      35 70 140 280      (was 25 50 100 200)
--   Start bonus        150                (was 200)
--   start money        2500               (unchanged)
--   jail fine          50, to the BANK    (unchanged, and NOT into the pot)
--   house prices       50/100/150/200     (unchanged)
--
-- The utility rent branch is GONE, not merely unreachable: mono_rent and
-- mono_land lose their `util_mult` argument entirely (they are dropped and
-- re-created, because create-or-replace would leave the old five-argument
-- overload in place and make a three-argument call ambiguous).
--
-- ---------------------------------------------------------------------------
-- New state shapes
-- ---------------------------------------------------------------------------
--   game.pot      integer, starts 0. Cell 5 Tax, cell 39 Luxury Tax and every
--                 Chance / Community card that pays the BANK feed it. Landing
--                 on Free Parking hands the whole thing over and resets it.
--                 Jail fines, purchases, auction hammer prices and casino
--                 losses do NOT feed it - they are not fines.
--   game.casino   null, or {cell, figure, min, max} while the player standing
--                 on the casino still owes the house a bet. phase = 'casino'
--                 for exactly as long as that object is an object, and nothing
--                 else may happen in the room until it resolves.
--   board.<n>.income
--                 the Weed Farm's counter, in dollars, on the cell itself
--                 rather than in `game`, so it follows the deed through a
--                 trade and the tile can render it without a second lookup.
--
-- ---------------------------------------------------------------------------
-- New actions
-- ---------------------------------------------------------------------------
--   casino_play {playerId, game, bet, colour}
--       game   'slots' | 'roulette' | 'wheel'
--       bet    whole dollars, between game.casino.min and the player's cash
--       colour 'red' | 'black' | 'green', roulette only, ignored otherwise
--
-- ---------------------------------------------------------------------------
-- Payout convention, stated once so nobody has to re-derive it
-- ---------------------------------------------------------------------------
-- A multiplier of "x2" means the player ENDS HOLDING twice their bet, i.e. the
-- bet leaves their pocket and 2 x bet comes back, for a net profit of 1 x bet.
-- "x0" / LOSE means the bet is simply gone. That is why every play is settled
-- as two separate money movements - a `pay` of the bet to the bank followed by
-- a `collect` of bet x mult - and never as a single net figure: the event log
-- has to reconstruct the same balances the row holds.

alter table public.test
  add column if not exists game jsonb not null default '{}'::jsonb;

comment on column public.test.game is
  'Turn state: seq, phase, doubles, dice, actor, events of the last action, lastCard, winner, log, auction, trade, pot, casino. See 20260920170000_casino_farm_rebalance.sql.';

comment on column public.test.position is
  'Board state keyed by cell id "1".."40". Each cell: static card data + fig0..fig7 token flags + bought{fig0..fig7}, plus `income` on the Weed Farm. Shape from src/Hooks/baseState.jsx, normalised by mono_upgrade_cells.';

-- ---------------------------------------------------------------------------
-- Cell kinds
--
-- The board JSON is seeded by the CLIENT (src/Hooks/baseState.jsx) and only
-- then normalised here, so this function has to read two vintages at once:
-- a new client writes `casino: true` on 13 and `farm: true` on 28, an old one
-- (or a game already in flight) writes `communal: true` with `info` set to
-- "Light" or "Water". Both must land on the same kind, or a room that was
-- opened this morning breaks when the phones update this afternoon.
--
-- A `communal` cell that is neither Light nor Water is read as a farm rather
-- than a casino on purpose: a farm is ownable and a casino is not, so this is
-- the reading that cannot silently confiscate somebody's deed.
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
    when coalesce((cell->>'casino')::boolean, false)    then 'casino'
    when coalesce((cell->>'farm')::boolean, false)      then 'farm'
    when coalesce((cell->>'communal')::boolean, false)  then
      case when cell->>'info' = 'Light' or cell->>'id' = '13'
           then 'casino' else 'farm' end
    else 'street'
  end;
$$;

comment on function public.mono_cell_kind(jsonb) is
  'Cell kind from its flags. Reads both the new casino/farm flags and the legacy communal + info vintage. 20260920170000_casino_farm_rebalance.sql.';

-- Purchase price. The casino has none and never will: the bank is the house.
-- The farm keeps the 150 the utility it replaced carried, so it goes through
-- `buy`, `auction_start` and `mono_tradable` exactly like any other deed.
create or replace function public.mono_price(cell jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case public.mono_cell_kind(cell)
    when 'street' then (cell->>'price')::integer
    when 'road'   then coalesce((cell->>'price')::integer, 200)
    when 'farm'   then coalesce((cell->>'price')::integer, 150)
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- Board upgrade
--
-- Supersedes the version in 20260920100000_six_players.sql. It still widens
-- every cell to the eight-figure shape, and it now also migrates a board that
-- is mid-game: the old "Light" becomes a casino, the old "Water" becomes a
-- farm with a counter, and a leftover `communal` flag is dropped so no code
-- path can reach the rent branch that no longer exists.
--
-- Ownership of the CASINO is cleared. That is a deliberate, one-way confiscation
-- and the only thing this function can do that moves a deed: the casino has no
-- owner by definition, so a board where somebody had bought "Light" simply has
-- no legal state to keep. There is no refund - the alternative (leaving the
-- deed in place) would leave a cell that is owned, unsellable and rentless,
-- which is worse than 150$ gone.
--
-- Idempotent: a board that has already been through this comes back unchanged,
-- including an accumulated farm counter, which is clamped up to 50 but never
-- down.
-- ---------------------------------------------------------------------------

create or replace function public.mono_upgrade_cells(board jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  figs jsonb := jsonb_build_object(
    'fig0', false, 'fig1', false, 'fig2', false, 'fig3', false,
    'fig4', false, 'fig5', false, 'fig6', false, 'fig7', false);
  out  jsonb := '{}'::jsonb;
  e    record;
  cell jsonb;
begin
  for e in select key, value from jsonb_each(coalesce(board, '{}'::jsonb)) loop
    -- non-object entries were never cells; pass them through untouched
    if jsonb_typeof(e.value) <> 'object' then
      out := jsonb_set(out, array[e.key], e.value, true);
      continue;
    end if;

    -- `defaults || existing`: the right-hand side of || wins, so every key the
    -- cell already had keeps its value and only the missing ones are filled in
    cell := (figs || e.value) || jsonb_build_object('bought',
      figs || case when jsonb_typeof(e.value->'bought') = 'object'
                   then e.value->'bought' else '{}'::jsonb end);

    case public.mono_cell_kind(cell)
      when 'casino' then
        cell := (cell - 'communal' - 'price' - 'income')
              || jsonb_build_object('casino', true, 'bought', figs);
      when 'farm' then
        cell := (cell - 'communal') || jsonb_build_object(
          'farm',   true,
          'price',  to_jsonb(coalesce((cell->>'price')::integer, 150)),
          'income', to_jsonb(greatest(coalesce((cell->>'income')::integer, 50), 50)));
      else
        null;
    end case;

    out := jsonb_set(out, array[e.key], cell, true);
  end loop;
  return out;
end;
$$;

comment on function public.mono_upgrade_cells(jsonb) is
  'Normalises a board of any vintage: eight figure keys, casino on the old Light cell, farm + income counter on the old Water cell. Idempotent. 20260920170000_casino_farm_rebalance.sql.';

-- ---------------------------------------------------------------------------
-- Rent
--
-- Dropped rather than replaced: the utility multiplier argument goes away, and
-- a create-or-replace would leave the five-argument version sitting next to the
-- four-argument one, making every existing three-argument call ambiguous.
--
-- `dice_sum` survives the cut even though nothing reads it any more. It is the
-- only thing standing between this signature and a second round of drop-and-
-- recreate the day somebody adds a dice-based cell, and every call site already
-- has the number in hand.
-- ---------------------------------------------------------------------------

drop function if exists public.mono_rent(jsonb, text, integer, integer, integer);

create or replace function public.mono_rent(
  board     jsonb,
  cell_key  text,
  dice_sum  integer,
  road_mult integer default 1
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
    base   := coalesce((cell->>'price')::integer, 0) / 8;
    houses := coalesce((cell->>'houses')::integer, 0);
    if houses <= 0 then
      if public.mono_owns_set(board, owner, cell->>'color') then
        return base * 2;
      end if;
      return base;
    end if;
    return base * (case houses when 1 then 6 when 2 then 18 when 3 then 50 when 4 then 70 else 90 end);

  elsif kind = 'road' then
    select count(*) into cnt
      from jsonb_each(board) as c
     where public.mono_cell_kind(c.value) = 'road'
       and public.mono_owner(c.value) = owner;
    return (35 << greatest(cnt - 1, 0)) * coalesce(road_mult, 1);
  end if;

  -- casino: nobody owns it, so nobody charges for it.
  -- farm:   a visitor pays nothing at all; the owner harvests the counter by
  --         landing on it themselves. Neither is rent, so neither is here.
  return 0;
end;
$$;

comment on function public.mono_rent(jsonb, text, integer, integer) is
  'Rent a visitor owes. Streets price/8 with 1/6/18/50/70/90, railroads 35/70/140/280. Casino and farm never charge. 20260920170000_casino_farm_rebalance.sql.';

-- ---------------------------------------------------------------------------
-- Charging, with the Free Parking pot
--
-- Only money that leaves the game as a FINE lands on Free Parking. A charge
-- with a creditor is somebody else's income; a charge to the bank for a jail
-- fine, a deed or a losing bet is a price paid, not a penalty. That leaves
-- exactly three reasons, and they are listed here rather than at the call
-- sites so the rule lives in one place.
-- ---------------------------------------------------------------------------

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
    -- the pot never sees a bankruptcy: what little they had goes to the
    -- creditor or to the bank, and mono_bankrupt says so in its own event
    return public.mono_bankrupt(st, idx, to_idx, reason, amount);
  end if;

  st := public.mono_patch_player(st, idx, jsonb_build_object('money', money - amount));
  if to_idx is not null then
    st := public.mono_patch_player(st, to_idx, jsonb_build_object('money', public.mono_money(st, to_idx) + amount));
  elsif reason in ('tax', 'card', 'repairs') and jsonb_typeof(st->'game') = 'object' then
    st := jsonb_set(st, '{game,pot}',
      to_jsonb(coalesce((st->'game'->>'pot')::integer, 0) + amount));
  end if;
  return public.mono_event(st, jsonb_build_object(
    'type', 'pay', 'figure', fig, 'to', to_fig, 'amount', amount, 'reason', reason, 'cell', cell
  ));
end;
$$;

comment on function public.mono_charge(jsonb, integer, integer, integer, text, integer) is
  'Money out of a player. Fines to the bank (tax, card, repairs) pile up on game.pot. 20260920170000_casino_farm_rebalance.sql.';

-- The Start bonus drops to 150. Everything else about the move is unchanged;
-- the function is re-created only because the number is baked into it.
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
    st := public.mono_credit(st, idx, 150, 'passGo');
  end if;
  return st;
end;
$$;

-- ---------------------------------------------------------------------------
-- The casino
-- ---------------------------------------------------------------------------

-- The minimum bet: 15% of the player's cash, rounded UP to the nearest 10$ so
-- the slider has round numbers to snap to, and then clamped to their cash so a
-- nearly-broke player is never asked for more than they own.
--
-- Both mono_land (which writes the pending block) and game_action (which
-- validates the bet that comes back) call this, because a player's cash must
-- not be able to drift between the two and leave the slider offering a bet the
-- server will then reject.
create or replace function public.mono_casino_min_bet(cash integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(cash, 0) <= 0 then 0
    else least(greatest(ceil(cash::numeric * 15 / 100 / 10)::integer * 10, 10), cash)
  end;
$$;

comment on function public.mono_casino_min_bet(integer) is
  'Minimum casino bet: 15% of cash rounded up to 10$, never more than the cash. 20260920170000_casino_farm_rebalance.sql.';

-- One play, resolved. VOLATILE, and it has to stay that way: an immutable or
-- stable function is free to be folded to a single evaluation inside one
-- statement, which is exactly how a casino ends up dealing every player the
-- same hand. Nothing about the outcome is ever sent by the client - it only
-- animates what comes back - so replaying the RPC cannot reroll a loss.
--
-- The odds, and where they come from:
--
--   SLOTS     three independent reels of six symbols. The natural distribution
--             of 6^3 = 216 outcomes already IS the spec: 6 triples = 2.78%,
--             C(3,2) x 6 x 5 = 90 exact pairs = 41.67%, 120 all-different.
--             No table needed, and no way for the three to disagree.
--   ROULETTE  a single slot 0..36. 0 is green, 1..18 red, 19..36 black, so
--             18/37 - 18/37 - 1/37 exactly. Right colour pays x2, green x14.
--   WHEEL     twelve equal segments: 1-5 lose, 6-9 pay x1.5, 10-11 pay x3,
--             12 pays x10. One spin, nothing to decide after the bet.
--
-- x1.5 on an odd bet is floored, because the board deals in whole dollars and
-- rounding the house's way is the convention every casino already uses.
create or replace function public.mono_casino_spin(game_id text, bet integer, pick text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  r1     integer;
  r2     integer;
  r3     integer;
  slot   integer;
  seg    integer;
  colour text;
  mult   numeric := 0;
  res    jsonb;
begin
  if game_id = 'slots' then
    r1 := floor(random() * 6)::integer;
    r2 := floor(random() * 6)::integer;
    r3 := floor(random() * 6)::integer;
    if r1 = r2 and r2 = r3 then
      mult := 10;
    elsif r1 = r2 or r2 = r3 or r1 = r3 then
      mult := 2;
    else
      mult := 0;
    end if;
    res := jsonb_build_object('reels', jsonb_build_array(r1, r2, r3));

  elsif game_id = 'roulette' then
    slot   := floor(random() * 37)::integer;
    colour := case when slot = 0 then 'green'
                   when slot <= 18 then 'red'
                   else 'black' end;
    if pick = colour then
      mult := case when colour = 'green' then 14 else 2 end;
    else
      mult := 0;
    end if;
    res := jsonb_build_object('slot', slot, 'colour', colour, 'pick', pick);

  elsif game_id = 'wheel' then
    seg  := floor(random() * 12)::integer + 1;
    mult := case when seg <= 5  then 0
                 when seg <= 9  then 1.5
                 when seg <= 11 then 3
                 else 10 end;
    res := jsonb_build_object('segment', seg);

  else
    raise exception 'Unknown casino game %', game_id;
  end if;

  return res || jsonb_build_object(
    'game', game_id, 'bet', bet, 'mult', mult,
    'payout', floor(bet::numeric * mult)::integer
  );
end;
$$;

comment on function public.mono_casino_spin(text, integer, text) is
  'Server-side randomness for one casino play. VOLATILE on purpose. Returns {game, bet, mult, payout, ...}. 20260920170000_casino_farm_rebalance.sql.';

-- ---------------------------------------------------------------------------
-- The decks
--
-- Re-created for two reasons. The Start bonus is 150 now and the card texts
-- were still promising 200, which the phones show verbatim. And the "advance
-- to the nearest utility" card has nothing left to advance to: there are no
-- utilities, and its `nearest` kind used to pass a utility multiplier into a
-- rent branch that no longer exists.
--
-- It is RETARGETED rather than deleted, so the Chance deck keeps its fifteen
-- cards and its odds: it now sends you to the Casino, where the mandatory-bet
-- rule does the rest. The "nearest railroad" card (c5) is untouched and is the
-- only remaining user of the `nearest` kind.
-- ---------------------------------------------------------------------------

create or replace function public.mono_deck(deck text, board jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  start_id  integer := coalesce(public.mono_cell_of_kind(board, 'start'), 1);
  road_id   integer := coalesce(public.mono_cell_of_kind(board, 'road'), 6);
  casino_id integer := coalesce(public.mono_cell_of_kind(board, 'casino'), 13);
begin
  if deck = 'chance' then
    return jsonb_build_array(
      jsonb_build_object('id', 'c1',  'kind', 'moveTo', 'cell', start_id,
        'text', 'Advance to ' || coalesce(board->(start_id::text)->>'header', 'Start') || '. Collect $150.'),
      jsonb_build_object('id', 'c2',  'kind', 'moveTo', 'cell', 25,
        'text', 'Advance to ' || coalesce(board->'25'->>'header', 'cell 25') || '. If you pass Start, collect $150.'),
      jsonb_build_object('id', 'c3',  'kind', 'moveTo', 'cell', 12,
        'text', 'Advance to ' || coalesce(board->'12'->>'header', 'cell 12') || '. If you pass Start, collect $150.'),
      jsonb_build_object('id', 'c4',  'kind', 'moveTo', 'cell', casino_id,
        'text', 'The house misses you. Advance to the Casino and place a bet.'),
      jsonb_build_object('id', 'c5',  'kind', 'nearest', 'what', 'road',
        'text', 'Advance to the nearest railroad. If it is owned, pay double rent.'),
      jsonb_build_object('id', 'c6',  'kind', 'collect', 'amount', 50,
        'text', 'Bank pays you a dividend of $50.'),
      jsonb_build_object('id', 'c7',  'kind', 'jailCard',
        'text', 'Get Out Of Jail Free. Keep this card until you need it.'),
      jsonb_build_object('id', 'c8',  'kind', 'back', 'steps', 3,
        'text', 'Go back 3 spaces.'),
      jsonb_build_object('id', 'c9',  'kind', 'goJail',
        'text', 'Go directly to Jail. Do not pass Start, do not collect $150.'),
      jsonb_build_object('id', 'c10', 'kind', 'repairs', 'house', 25, 'hotel', 100,
        'text', 'Make general repairs on all your property: $25 per house, $100 per hotel.'),
      jsonb_build_object('id', 'c11', 'kind', 'pay', 'amount', 15,
        'text', 'Speeding fine. Pay $15.'),
      jsonb_build_object('id', 'c12', 'kind', 'moveTo', 'cell', road_id,
        'text', 'Take a trip to ' || coalesce(board->(road_id::text)->>'info', 'the first railroad') || '. If you pass Start, collect $150.'),
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
      'text', 'Advance to ' || coalesce(board->(start_id::text)->>'header', 'Start') || '. Collect $150.'),
    jsonb_build_object('id', 'k2',  'kind', 'collect', 'amount', 200,
      'text', 'Bank error in your favour. Collect $200.'),
    jsonb_build_object('id', 'k3',  'kind', 'pay', 'amount', 50,
      'text', 'Doctor''s fee. Pay $50.'),
    jsonb_build_object('id', 'k4',  'kind', 'collect', 'amount', 50,
      'text', 'From sale of stock you get $50.'),
    jsonb_build_object('id', 'k5',  'kind', 'jailCard',
      'text', 'Get Out Of Jail Free. Keep this card until you need it.'),
    jsonb_build_object('id', 'k6',  'kind', 'goJail',
      'text', 'Go directly to Jail. Do not pass Start, do not collect $150.'),
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

-- ---------------------------------------------------------------------------
-- Landing
--
-- Dropped and re-created for the same reason as mono_rent: the util_mult
-- argument goes, and an overload would make every existing call ambiguous.
--
-- Four things are new in the body:
--   jail     a landlord in jail collects nothing. The visitor pays nobody -
--            not the owner, not the pot, not the bank - and an event says so
--            so the log does not look like a dropped charge.
--   parking  hands over game.pot and zeroes it. A pot of 0 is silent.
--   farm     the owner harvests by landing on it; everybody else waters it.
--   casino   writes the pending block. The turn cannot move on until the
--            player has bet, which is what "mandatory" means here.
-- ---------------------------------------------------------------------------

drop function if exists public.mono_land(jsonb, integer, integer, integer, integer);

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
  fig       text := st->'players'->idx->>'figure';
  pos       integer := greatest(coalesce((st->'players'->idx->>'position')::integer, 1), 1);
  cell      jsonb := st->'board'->(pos::text);
  kind      text := public.mono_cell_kind(cell);
  owner     text;
  owner_idx integer;
  card      jsonb;
  pot       integer;
  income    integer;
  cash      integer;
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
        else
          st := public.mono_charge(st, idx,
            public.mono_rent(st->'board', pos::text, dice_sum, road_mult),
            owner_idx, 'rent', pos);
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
  'Resolves the cell a player stands on: rent (unless the owner is in jail), tax, the parking pot, the farm counter, the mandatory casino bet, Go To Jail, a card. 20260920170000_casino_farm_rebalance.sql.';

-- Re-created only because its `nearest` branch called mono_land with the
-- utility multiplier that no longer exists. Everything else is verbatim.
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
        st := public.mono_land(st, idx, dice_sum, 2);
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

-- ---------------------------------------------------------------------------
-- game_action
--
-- Re-created in full from 20260920100000_six_players.sql (it is a
-- create-or-replace, so there is no way to patch one branch). What differs:
--
--   * `pot` and `cas` are read out of `game` next to `auc` and `tr`, and
--     written back with them at the end.
--   * a new guard: while a casino bet is pending, nothing else happens in the
--     room. Same shape as the auction guard directly above it.
--   * a new action, casino_play.
--   * skip_turn resolves a stuck casino the way it already resolves a stuck
--     auction, so a sleeping phone cannot freeze the table.
--   * new_game runs its payload board through mono_upgrade_cells, so a phone
--     that has not reloaded yet cannot seed a board with no casino, no farm
--     and no counter; farm counters are reset to 50 with everything else.
--   * after the action, the pending casino is reconciled against the players
--     that are left and drives the phase.
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

  if jsonb_typeof(gm->'lastCard') is distinct from 'object' then
    gm := gm - 'lastCard';
  end if;

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
                    'auction_start', 'casino_play',
                    'trade_offer', 'trade_accept', 'trade_decline', 'trade_cancel', 'trade_counter') then
    raise exception 'An auction is running';
  end if;

  -- Landing on the casino is mandatory, and "mandatory" is enforced here: the
  -- player cannot buy, build, trade, auction or end their turn around it. Only
  -- casino_play clears it (or skip_turn / leave, for a phone that went away).
  if phase = 'casino'
     and action in ('roll', 'move', 'buy', 'build', 'pay_jail', 'use_jail_card', 'end_turn',
                    'auction_start', 'auction_bid', 'auction_drop',
                    'trade_offer', 'trade_accept', 'trade_decline', 'trade_cancel', 'trade_counter') then
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
               'jailTurns', 0, 'jailCards', 0, 'bankrupt', false
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
    gm      := '{}'::jsonb;
    auc     := null;   -- a running auction, a pending offer and an unplayed
    tr      := null;   -- bet all die with the game
    cas     := null;
    pot     := 0;
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
  pot     := coalesce((st->'game'->>'pot')::integer, 0);

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
    'trade',    st->'trade',
    'pot',      pot,
    'casino',   case when cas is null then 'null'::jsonb else cas end
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
  'Applies one game action to a room under a row lock. Actions: 20260918140000_game_rules.sql, auctions and trading from 20260919100000_auction_trade.sql, casino_play from 20260920170000_casino_farm_rebalance.sql. Six seats, figures fig0..fig7.';

revoke all on function public.game_action(text, text, jsonb) from public;
grant execute on function public.game_action(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Every room that already exists, brought up to the new board shape. The
-- function is idempotent, so re-running the whole migration is harmless, and
-- the pot is seeded on any row that has never had one.
-- ---------------------------------------------------------------------------

update public.test
   set position = public.mono_upgrade_cells(position);

update public.test
   set game = game || jsonb_build_object('pot', 0)
 where not (game ? 'pot');
