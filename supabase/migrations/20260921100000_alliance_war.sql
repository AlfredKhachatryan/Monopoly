-- Diplomacy: alliances, wars and the Backstab gambit.
--
-- The playtest after the rebalance found the mid-game flat: everybody grinds
-- their own board and the only interaction is a trade. This migration adds the
-- three standing relationships a player can have with another player, and
-- every one of them is a STATUS, not an event: there are no battles, no dice,
-- no minigame. What changes is who pays whom, and how much.
--
--   ALLIANCE  two players, mutual accept, one per player. They stop charging
--             each other rent, the bank tips each of them when the other
--             collects, they can win together - and they pay for it with a
--             50$/round bill, a +25% surcharge on everybody else's rent, and a
--             shared purse that the board can reach into.
--   WAR       a 500$ declaration that doubles rent across two sides for five
--             rounds. Sides are the two principals plus whoever they happen to
--             be allied with AT THE MOMENT THE RENT IS COMPUTED, so an
--             alliance formed mid-war drags a third party in and breaking one
--             pulls them straight back out.
--   BACKSTAB  once per game: take 15% of your ally's cash and walk away. The
--             brand is permanent (never ally again) and the tax is temporary
--             (+25% rent to everybody for five rounds).
--
-- Applied AFTER 20260920170000_casino_farm_rebalance.sql. Nothing in an
-- already-applied migration is edited.
--
-- ---------------------------------------------------------------------------
-- The numbers (these are the authority; src/Hooks/diplomacy.js mirrors them)
-- ---------------------------------------------------------------------------
--   WAR_FEE         500   to the BANK, never to the parking pot
--   WAR_ROUNDS      5     endsRound = startRound + 5, expires at that start
--   ALLY_UPKEEP     50    per allied player per round, into game.pot
--   ALLY_TAX        1.25  an allied player's rent to a non-ally
--   COMMISSION      0.10  bank -> the other ally, on rent actually collected
--   BACKSTAB_CUT    0.15  of the victim's cash, floored
--   TRAITOR_ROUNDS  5     length of the +25% brand
--   TRAITOR_TAX     1.25
--
-- ---------------------------------------------------------------------------
-- New state shapes
-- ---------------------------------------------------------------------------
--   game.round        integer, starts at 1. A round ends when the turn passes
--                     back to the FIRST STILL-ACTIVE player in turn order -
--                     "still active" because a bankrupt seat is skipped and a
--                     round must not silently get longer when seat 0 goes out.
--   game.alliances    [{a, b, since}]   a = who proposed, b = who accepted
--   game.allyOffers   [{from, to}]      pending proposals, like a trade offer
--   game.wars         [{id, declarer, target, startRound, endsRound,
--                       peace: null | {from, amount}}]
--   game.winners      [fig] | [fig, fig]. `game.winner` keeps the first of them
--                     so every screen written before allied victory existed
--                     still lights up.
--   player.traitor       boolean, permanent
--   player.traitorUntil  integer, the round at whose START the +25% stops
--   player.backstabUsed  boolean
--
-- Every reader coalesces: a room that was opened before this migration has
-- none of these keys and must not crash on the next tap.
--
-- ---------------------------------------------------------------------------
-- Rent, in ONE place
-- ---------------------------------------------------------------------------
-- Rent used to be a pure function of the board, which is why mono_rent is
-- `immutable` and takes `board` and nothing else. It no longer can be: who
-- pays what now depends on `game.alliances`, `game.wars`, `game.round` and the
-- payer's own flags. Rather than widen mono_rent (and quietly change the
-- meaning of its first argument, which has the same type as before and would
-- therefore be accepted by create-or-replace without a word of warning),
-- mono_rent stays exactly what it is - the BASE rent - and two new functions
-- sit on top of it:
--
--   mono_rent_mods(st, payer, owner) -> {mult, zero, mods[]}
--   mono_rent_due(st, cell_key, payer, dice_sum, road_mult) -> {amount, mods[]}
--
-- mono_rent_due is the only place a rent figure is produced, and it applies,
-- in this order, all multiplicative, floored ONCE at the end:
--
--   1. owner in jail            -> 0   (mono_land, unchanged, as before)
--   2. payer and owner allied   -> 0
--   3. opposite sides of a war  -> x2
--   4. payer is in an alliance  -> x1.25
--   5. payer wears the brand    -> x1.25
--
-- and hands back the reasons as `mods`, which ride along on the `pay` event so
-- a phone can say WHY the bill was what it was. (4 and 5 cannot both fire in a
-- legal game - a traitor may never ally - but the arithmetic does not special
-- case it, so a state arranged by hand still multiplies.)
--
-- ---------------------------------------------------------------------------
-- New actions (all through game_action, all carry playerId)
-- ---------------------------------------------------------------------------
--   ally_propose  {to}            own turn        ally_accept  {from}  any time
--   ally_decline  {from}          any time        ally_cancel  {to}    any time
--   ally_break    {}              own turn
--   war_declare   {target}        own turn, 500$ to the bank
--   peace_propose {warId, amount} principal, own turn
--   peace_accept  {warId}         other principal, any time
--   peace_decline {warId}         other principal, any time
--   backstab      {}              own turn, allied, once per game
--
-- "Own turn" means it is your turn AND the phase is roll or act. The auction
-- and the casino lock the room for everybody, so every own-turn verb bounces
-- off them with the same sentence the existing verbs use. The any-time verbs
-- (answering a proposal) are deliberately NOT blocked: saying yes to an
-- alliance moves no money and costs nobody their place in the bidding.

-- ---------------------------------------------------------------------------
-- Reading the diplomatic state
--
-- All of these take the whole `st` bundle rather than `game`, because an
-- alliance is a fact about two PLAYERS and half of the questions here need the
-- players array as well (is that ally bankrupt? what round is it?). They are
-- immutable: `st` is a value, not a table.
-- ---------------------------------------------------------------------------

-- The seat that owns the round. Lowest `order` still in the game - not
-- necessarily 0, because seat 0 can be bankrupt and is then skipped forever.
create or replace function public.mono_first_active(players jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select min((p->>'order')::integer)
    from jsonb_array_elements(coalesce(players, '[]'::jsonb)) as p
   where not coalesce((p->>'bankrupt')::boolean, false);
$$;

comment on function public.mono_first_active(jsonb) is
  'Turn order of the first player who is not bankrupt, or null. A round wraps when the turn comes back to them. 20260921100000_alliance_war.sql.';

-- Who <fig> is allied with, or null. One alliance per player is an invariant
-- the verbs enforce, so `limit 1` is a statement of that rule and not a guess.
create or replace function public.mono_ally_of(st jsonb, fig text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when a.v->>'a' = fig then a.v->>'b' else a.v->>'a' end
    from jsonb_array_elements(
           case when jsonb_typeof(st->'game'->'alliances') = 'array'
                then st->'game'->'alliances' else '[]'::jsonb end) as a(v)
   where fig is not null
     and (a.v->>'a' = fig or a.v->>'b' = fig)
   limit 1;
$$;

create or replace function public.mono_are_allies(st jsonb, a text, b text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select a is not null and b is not null and a is distinct from b
     and public.mono_ally_of(st, a) = b;
$$;

-- Index of <idx>'s ally, but only while that ally can actually pay for
-- anything: a bankrupt ally is an empty pocket and the reconcile at the end of
-- the action is about to dissolve the pair anyway.
create or replace function public.mono_ally_idx(st jsonb, idx integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select t.i
    from (select public.mono_idx(st->'players', 'figure',
                   public.mono_ally_of(st, st->'players'->idx->>'figure')) as i) as t
   where t.i is not null
     and not public.mono_is_bankrupt(st, t.i);
$$;

-- The two sides of one war, computed LIVE. Nothing about who is on which side
-- is stored: an alliance formed while the war runs drags the new ally in on
-- the next rent, and breaking it pulls them out again just as fast.
create or replace function public.mono_war_sides(st jsonb, war jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'a', jsonb_build_array(war->>'declarer')
         || case when public.mono_ally_of(st, war->>'declarer') is null
                 then '[]'::jsonb
                 else jsonb_build_array(public.mono_ally_of(st, war->>'declarer')) end,
    'b', jsonb_build_array(war->>'target')
         || case when public.mono_ally_of(st, war->>'target') is null
                 then '[]'::jsonb
                 else jsonb_build_array(public.mono_ally_of(st, war->>'target')) end);
$$;

comment on function public.mono_war_sides(jsonb, jsonb) is
  'Live sides of a war: {a:[declarer, its ally], b:[target, its ally]}. Never stored. 20260921100000_alliance_war.sql.';

-- The war that puts these two on OPPOSITE sides, or null. Two members of the
-- same side are not at war with each other, which is the whole point of
-- getting dragged in.
create or replace function public.mono_war_between(st jsonb, f1 text, f2 text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  w jsonb;
  s jsonb;
begin
  if f1 is null or f2 is null or f1 = f2 then
    return null;
  end if;
  for w in
    select v from jsonb_array_elements(
      case when jsonb_typeof(st->'game'->'wars') = 'array'
           then st->'game'->'wars' else '[]'::jsonb end) as t(v)
  loop
    s := public.mono_war_sides(st, w);
    if (s->'a' @> to_jsonb(f1) and s->'b' @> to_jsonb(f2))
       or (s->'b' @> to_jsonb(f1) and s->'a' @> to_jsonb(f2)) then
      return w;
    end if;
  end loop;
  return null;
end;
$$;

-- The ids of every war <fig> is currently caught up in, as a principal or as
-- somebody's ally. Used by the "no two wars at once" guard.
create or replace function public.mono_wars_of(st jsonb, fig text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  w   jsonb;
  s   jsonb;
  out jsonb := '[]'::jsonb;
begin
  if fig is null then
    return out;
  end if;
  for w in
    select v from jsonb_array_elements(
      case when jsonb_typeof(st->'game'->'wars') = 'array'
           then st->'game'->'wars' else '[]'::jsonb end) as t(v)
  loop
    s := public.mono_war_sides(st, w);
    if s->'a' @> to_jsonb(fig) or s->'b' @> to_jsonb(fig) then
      out := out || jsonb_build_array(w->'id');
    end if;
  end loop;
  return out;
end;
$$;

create or replace function public.mono_in_any_war(st jsonb, fig text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_array_length(public.mono_wars_of(st, fig)) > 0;
$$;

-- Is the +25% brand still burning? `traitor` is forever, `traitorUntil` is the
-- round at whose START it stops, so it is live for exactly the rounds strictly
-- before it. 0 (or a missing key, on a room from before this migration) means
-- no brand.
create or replace function public.mono_is_traitor_now(st jsonb, fig text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select coalesce((p->>'traitorUntil')::integer, 0)
           > greatest(coalesce((st->'game'->>'round')::integer, 1), 1)
      from jsonb_array_elements(coalesce(st->'players', '[]'::jsonb)) as p
     where p->>'figure' = fig
     limit 1), false);
$$;

-- Why can these two not ally? Returns the sentence to show the player, or null
-- when the pairing is legal. Called at propose time AND again at accept time,
-- because a war can be declared or an alliance formed in between.
create or replace function public.mono_can_ally(st jsonb, a text, b text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  a_idx integer;
  b_idx integer;
  n     integer;
begin
  if a is null or b is null then
    return 'That player is not in this room';
  end if;
  if a = b then
    return 'You cannot ally with yourself';
  end if;
  a_idx := public.mono_idx(st->'players', 'figure', a);
  b_idx := public.mono_idx(st->'players', 'figure', b);
  if a_idx is null or b_idx is null then
    return 'That player is not in this room';
  end if;
  if public.mono_is_bankrupt(st, a_idx) then
    return 'You are bankrupt';
  end if;
  if public.mono_is_bankrupt(st, b_idx) then
    return 'That player is bankrupt';
  end if;
  if coalesce((st->'players'->a_idx->>'traitor')::boolean, false) then
    return 'You are a traitor, nobody will ally with you';
  end if;
  if coalesce((st->'players'->b_idx->>'traitor')::boolean, false) then
    return 'They are a traitor, nobody will ally with them';
  end if;
  if public.mono_ally_of(st, a) is not null then
    return 'You are already in an alliance';
  end if;
  if public.mono_ally_of(st, b) is not null then
    return 'They are already in an alliance';
  end if;
  if public.mono_war_between(st, a, b) is not null then
    return 'You are on opposite sides of a war';
  end if;
  -- Forming the pair merges their two war lists. One war between them is fine
  -- (the newcomer simply joins it); two is a player who would owe double rent
  -- in both directions at once, which the rent rules cannot express.
  select count(distinct t.v#>>'{}') into n
    from jsonb_array_elements(
           public.mono_wars_of(st, a) || public.mono_wars_of(st, b)) as t(v);
  if n > 1 then
    return 'That would put you in two wars at once';
  end if;
  return null;
end;
$$;

comment on function public.mono_can_ally(jsonb, text, text) is
  'Null when these two may ally, otherwise the sentence to show. Mirrors canAlly() in src/Hooks/diplomacy.js. 20260921100000_alliance_war.sql.';

-- ---------------------------------------------------------------------------
-- Writing the diplomatic state
-- ---------------------------------------------------------------------------

-- Tear up <fig>'s alliance. With a `reason` it logs the dissolve event the UI
-- narrates; with none it is silent, which is what `ally_break` and `backstab`
-- want because they log a better sentence of their own.
create or replace function public.mono_ally_dissolve(st jsonb, fig text, reason text default null)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  keep jsonb := '[]'::jsonb;
  gone jsonb := null;
  e    jsonb;
begin
  if fig is null then
    return st;
  end if;
  for e in
    select v from jsonb_array_elements(
      case when jsonb_typeof(st->'game'->'alliances') = 'array'
           then st->'game'->'alliances' else '[]'::jsonb end) as t(v)
  loop
    if e->>'a' = fig or e->>'b' = fig then
      gone := e;
    else
      keep := keep || jsonb_build_array(e);
    end if;
  end loop;
  if gone is null then
    return st;   -- not allied: nothing to do, and nothing to say
  end if;
  st := jsonb_set(st, '{game,alliances}', keep);
  if reason is null then
    return st;
  end if;
  return public.mono_event(st, jsonb_build_object(
    'type', 'ally', 'stage', 'dissolve',
    'a', gone->>'a', 'b', gone->>'b', 'reason', reason));
end;
$$;

-- Drop every pending proposal that touches <fig>. Silent on purpose: this runs
-- when a player allies, goes bankrupt, leaves or is branded, and in all four
-- cases the log already carries the sentence that explains it.
create or replace function public.mono_ally_offers_purge(st jsonb, fig text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_set(st, '{game,allyOffers}', coalesce((
    select jsonb_agg(t.v order by t.i)
      from jsonb_array_elements(
             case when jsonb_typeof(st->'game'->'allyOffers') = 'array'
                  then st->'game'->'allyOffers' else '[]'::jsonb end)
           with ordinality as t(v, i)
     where t.v->>'from' is distinct from fig
       and t.v->>'to'   is distinct from fig), '[]'::jsonb));
$$;

-- End every war <fig> is a PRINCIPAL in. An ally dropping out of a side does
-- not end anything - the war is between the two who declared it.
create or replace function public.mono_wars_end_for(st jsonb, fig text, reason text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  keep jsonb := '[]'::jsonb;
  e    jsonb;
  hit  jsonb := '[]'::jsonb;
begin
  if fig is null then
    return st;
  end if;
  for e in
    select v from jsonb_array_elements(
      case when jsonb_typeof(st->'game'->'wars') = 'array'
           then st->'game'->'wars' else '[]'::jsonb end) as t(v)
  loop
    if e->>'declarer' = fig or e->>'target' = fig then
      hit := hit || jsonb_build_array(e);
    else
      keep := keep || jsonb_build_array(e);
    end if;
  end loop;
  if jsonb_array_length(hit) = 0 then
    return st;
  end if;
  st := jsonb_set(st, '{game,wars}', keep);
  for e in select v from jsonb_array_elements(hit) as t(v) loop
    st := public.mono_event(st, jsonb_build_object(
      'type', 'war', 'stage', 'end', 'warId', e->'id', 'reason', reason));
  end loop;
  return st;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rent modifiers
--
-- Kept apart from mono_rent (which still answers "what does this deed charge")
-- so there is exactly one place that answers "and what does THIS player pay for
-- standing on it". Both the board and the phones read the same two numbers out
-- of it, and the `mods` array is the only explanation either of them gets.
-- ---------------------------------------------------------------------------

create or replace function public.mono_rent_mods(st jsonb, payer text, owner_fig text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  mult numeric := 1;
  mods jsonb   := '[]'::jsonb;
begin
  if payer is null or owner_fig is null or payer = owner_fig then
    return jsonb_build_object('mult', 1, 'zero', false, 'mods', mods);
  end if;

  -- 2. allies never bill each other. Nothing else can apply on top of free.
  if public.mono_are_allies(st, payer, owner_fig) then
    return jsonb_build_object('mult', 0, 'zero', true, 'mods', mods);
  end if;

  -- 3. across the lines of a war, including for allies dragged in
  if public.mono_war_between(st, payer, owner_fig) is not null then
    mult := mult * 2;
    mods := mods || '["war"]'::jsonb;
  end if;

  -- 4. the target on an allied player's back
  if public.mono_ally_of(st, payer) is not null then
    mult := mult * 1.25;
    mods := mods || '["allyTax"]'::jsonb;
  end if;

  -- 5. and the brand a backstabber wears for five rounds
  if public.mono_is_traitor_now(st, payer) then
    mult := mult * 1.25;
    mods := mods || '["traitor"]'::jsonb;
  end if;

  return jsonb_build_object('mult', mult, 'zero', false, 'mods', mods);
end;
$$;

comment on function public.mono_rent_mods(jsonb, text, text) is
  'Rent multiplier and its reasons for one payer/owner pair: {mult, zero, mods[]}. Mirrors rentMods() in src/Hooks/diplomacy.js. 20260921100000_alliance_war.sql.';

-- The bill, and why. Floored ONCE, at the very end, so 100 x2 x1.25 is 250 and
-- not 200 rounded twice.
create or replace function public.mono_rent_due(
  st        jsonb,
  cell_key  text,
  payer     text,
  dice_sum  integer,
  road_mult integer default 1
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  base      integer := public.mono_rent(st->'board', cell_key, dice_sum, road_mult);
  owner_fig text    := public.mono_owner(st->'board'->cell_key);
  m         jsonb;
begin
  m := public.mono_rent_mods(st, payer, owner_fig);
  if coalesce((m->>'zero')::boolean, false) then
    return jsonb_build_object('amount', 0, 'zero', true, 'mods', m->'mods');
  end if;
  return jsonb_build_object(
    'amount', floor(coalesce(base, 0)::numeric * (m->>'mult')::numeric)::integer,
    'zero',   false,
    'mods',   m->'mods');
end;
$$;

comment on function public.mono_rent_due(jsonb, text, text, integer, integer) is
  'What <payer> owes for standing on <cell_key>, with the modifier names: {amount, zero, mods[]}. 20260921100000_alliance_war.sql.';

-- ---------------------------------------------------------------------------
-- Charging, with shared debts
--
-- Dropped and re-created rather than replaced: the `pay` event now carries the
-- rent modifiers, which means a seventh argument, and a create-or-replace
-- would leave the six-argument version sitting next to it and make every
-- existing five- and six-argument call ambiguous. (The previous migration hit
-- exactly this with mono_rent and mono_land.)
--
-- The new rule is the shared purse. When a FORCED charge - one that can
-- bankrupt somebody today - is bigger than the payer's cash and the payer has
-- an ally, the two pockets are counted together:
--
--   * together they cover it -> the ally hands over the shortfall and ONLY the
--     shortfall, the charge is then paid in full, and nobody goes bankrupt.
--   * together they still cannot -> the ally is not touched at all and the
--     payer goes bankrupt exactly as they would have before this migration.
--     Dragging an ally down to 0 for nothing would make every alliance a
--     suicide pact.
--
-- Voluntary spending is never shared, which is why the forced reasons are
-- listed here by name rather than inferred: buying, building, bidding, a
-- casino bet and the war fee all check the payer's own cash at their own call
-- site and never reach this branch.
-- ---------------------------------------------------------------------------

drop function if exists public.mono_charge(jsonb, integer, integer, integer, text, integer);

create or replace function public.mono_charge(
  st     jsonb,
  idx    integer,
  amount integer,
  to_idx integer,
  reason text,
  cell   integer default null,
  mods   jsonb   default null
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  money    integer := public.mono_money(st, idx);
  fig      text    := st->'players'->idx->>'figure';
  to_fig   text    := case when to_idx is null then null else st->'players'->to_idx->>'figure' end;
  forced   boolean := reason in ('rent', 'tax', 'card', 'repairs', 'jailFee');
  ally_idx integer;
  ally_fig text;
  short    integer;
begin
  if idx is null or amount is null or amount <= 0 or public.mono_is_bankrupt(st, idx) then
    return st;
  end if;

  if money < amount then
    ally_idx := case when forced then public.mono_ally_idx(st, idx) end;
    if ally_idx is not null
       and money + public.mono_money(st, ally_idx) >= amount then
      -- the ally covers the gap, and the gap only
      short    := amount - money;
      ally_fig := st->'players'->ally_idx->>'figure';
      st := public.mono_patch_player(st, ally_idx, jsonb_build_object(
        'money', public.mono_money(st, ally_idx) - short));
      st := public.mono_patch_player(st, idx, jsonb_build_object('money', money + short));
      st := public.mono_event(st, jsonb_build_object(
        'type', 'pay', 'figure', ally_fig, 'to', fig,
        'amount', short, 'reason', 'debtShare', 'cell', cell));
      st := public.mono_event(st, jsonb_build_object(
        'type', 'debtShare', 'figure', fig, 'ally', ally_fig,
        'amount', short, 'reason', reason));
      money := amount;
    else
      -- the pot never sees a bankruptcy: what little they had goes to the
      -- creditor or to the bank, and mono_bankrupt says so in its own event
      return public.mono_bankrupt(st, idx, to_idx, reason, amount);
    end if;
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
  ) || case when mods is null then '{}'::jsonb else jsonb_build_object('mods', mods) end);
end;
$$;

comment on function public.mono_charge(jsonb, integer, integer, integer, text, integer, jsonb) is
  'Money out of a player. Fines to the bank (tax, card, repairs) pile up on game.pot; a forced charge an ally can cover is shared. 20260921100000_alliance_war.sql.';

-- ---------------------------------------------------------------------------
-- The start of a round
--
-- Three things happen, in this order, before anybody rolls:
--   1. UPKEEP. Every allied player pays 50$ into the parking pot. A player who
--      cannot find the 50$ does not go bankrupt over it and does not reach into
--      their ally's pocket - the alliance simply dissolves. The two members are
--      billed in seat order, so the same table state always writes the same
--      log, and a pair whose FIRST member already paid before the second one
--      came up short does not get that 50$ back: the bill was for the round
--      that the alliance was alive at the start of.
--   2. WAR EXPIRY. A war whose endsRound has arrived is over.
--   3. THE BRAND. A traitorUntil that has arrived stops costing 25%. The
--      `traitor` flag itself never expires - the ban on allying is for good.
-- ---------------------------------------------------------------------------

create or replace function public.mono_round_tick(st jsonb, new_round integer)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  pair  jsonb;
  e     jsonb;
  keep  jsonb;
  a_idx integer;
  b_idx integer;
  k     integer;
  k_idx integer;
  k_fig text;
  tmp   integer;
  i     integer;
  n     integer;
begin
  -- The counter goes in first: everything below is measured against it, and so
  -- is every rent charged for the rest of the round.
  st := jsonb_set(st, '{game,round}', to_jsonb(new_round));

  -- 1. upkeep. The snapshot is safe to walk while dissolving, because one
  --    alliance per player means the pairs are disjoint: tearing one up can
  --    never remove a different one from the list.
  for pair in
    select v from jsonb_array_elements(
      case when jsonb_typeof(st->'game'->'alliances') = 'array'
           then st->'game'->'alliances' else '[]'::jsonb end) as t(v)
  loop
    a_idx := public.mono_idx(st->'players', 'figure', pair->>'a');
    b_idx := public.mono_idx(st->'players', 'figure', pair->>'b');
    if a_idx is null or b_idx is null then
      -- somebody walked out of the room between actions
      st := public.mono_ally_dissolve(st, coalesce(pair->>'a', pair->>'b'), 'left');
      continue;
    end if;
    -- bill them in seat order
    if coalesce((st->'players'->a_idx->>'order')::integer, 0)
       > coalesce((st->'players'->b_idx->>'order')::integer, 0) then
      tmp := a_idx; a_idx := b_idx; b_idx := tmp;
    end if;

    for k in 1 .. 2 loop
      k_idx := case when k = 1 then a_idx else b_idx end;
      k_fig := st->'players'->k_idx->>'figure';
      if public.mono_is_bankrupt(st, k_idx) then
        st := public.mono_ally_dissolve(st, k_fig, 'bankrupt');
        exit;
      end if;
      if public.mono_money(st, k_idx) < 50 then
        st := public.mono_ally_dissolve(st, k_fig, 'upkeep');
        exit;
      end if;
      st := public.mono_patch_player(st, k_idx, jsonb_build_object(
        'money', public.mono_money(st, k_idx) - 50));
      st := jsonb_set(st, '{game,pot}',
        to_jsonb(coalesce((st->'game'->>'pot')::integer, 0) + 50));
      st := public.mono_event(st, jsonb_build_object(
        'type', 'pay', 'figure', k_fig, 'to', null,
        'amount', 50, 'reason', 'allyUpkeep', 'cell', null));
      st := public.mono_event(st, jsonb_build_object(
        'type', 'allyUpkeep', 'figure', k_fig, 'amount', 50));
    end loop;
  end loop;

  -- 2. wars that have run their five rounds
  keep := '[]'::jsonb;
  for e in
    select v from jsonb_array_elements(
      case when jsonb_typeof(st->'game'->'wars') = 'array'
           then st->'game'->'wars' else '[]'::jsonb end) as t(v)
  loop
    if new_round >= coalesce((e->>'endsRound')::integer, new_round) then
      st := public.mono_event(st, jsonb_build_object(
        'type', 'war', 'stage', 'expire', 'warId', e->'id'));
    else
      keep := keep || jsonb_build_array(e);
    end if;
  end loop;
  st := jsonb_set(st, '{game,wars}', keep);

  -- 3. brands that have burnt out
  n := jsonb_array_length(coalesce(st->'players', '[]'::jsonb));
  for i in 0 .. greatest(n - 1, 0) loop
    exit when n = 0;
    if coalesce((st->'players'->i->>'traitorUntil')::integer, 0) > 0
       and new_round >= (st->'players'->i->>'traitorUntil')::integer then
      st := public.mono_patch_player(st, i, jsonb_build_object('traitorUntil', 0));
      st := public.mono_event(st, jsonb_build_object(
        'type', 'traitor', 'stage', 'expire',
        'figure', st->'players'->i->>'figure'));
    end if;
  end loop;

  return st;
end;
$$;

comment on function public.mono_round_tick(jsonb, integer) is
  'Start-of-round hook: alliance upkeep into the pot (dissolving what cannot be paid), war expiry, traitor brand expiry. 20260921100000_alliance_war.sql.';

-- ---------------------------------------------------------------------------
-- Landing
--
-- Re-created (the signature is unchanged, so a plain replace is safe here).
-- Only the rent branch differs, and it now does three things it did not:
--
--   * the bill comes from mono_rent_due, so the war / ally-tax / traitor
--     multipliers are applied in one place and travel with the `pay` event;
--   * rent between allies is free, and says so with the same `rentFree` event
--     the jailed-landlord rule already uses, because both are "no charge, and
--     here is why" and a phone should not have to learn two shapes;
--   * the landlord's ally gets a 10% commission FROM THE BANK, computed from
--     the money that actually arrived rather than from the bill, so a payer who
--     went bankrupt halfway does not tip the table for money nobody received.
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
  'Resolves the cell a player stands on. Rent now runs through mono_rent_due (free between allies, x2 across a war, +25% for allies and traitors) and tips the landlord''s ally 10% from the bank. 20260921100000_alliance_war.sql.';
-- ---------------------------------------------------------------------------
-- game_action
--
-- Re-created in full from 20260920170000_casino_farm_rebalance.sql (it is a
-- create-or-replace, so there is no way to patch one branch). What differs:
--
--   * `round`, `allies`, `offers`, `wars` and `winners` are read out of `game`
--     next to `pot` and `cas`, and written back with them at the end. Every
--     read coalesces, so a room opened before this migration keeps working.
--   * ten new actions: the five alliance verbs, war_declare, the three peace
--     verbs and backstab.
--   * the auction and casino locks grow to cover every new OWN-TURN verb. The
--     verbs that only answer somebody else's proposal stay legal, because
--     saying yes moves no money and costs nobody their place in the bidding.
--   * after the action, before the winner is decided: bankrupt and departed
--     players are cut out of every alliance, war and pending proposal, and if
--     the turn has come back round to the first still-active player, the round
--     counter ticks over and mono_round_tick runs the start-of-round hooks.
--   * the game is over when the survivors are ONE player or ONE ALLIED PAIR.
--     `game.winners` is the array; `game.winner` keeps its first entry so
--     every screen written before this still lights up.
--   * new_game / reset_board clear all of it, and seed the three new player
--     flags along with the money and the position.
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
  'Applies one game action to a room under a row lock. Actions: 20260918140000_game_rules.sql, auctions and trading from 20260919100000_auction_trade.sql, casino_play from 20260920170000_casino_farm_rebalance.sql, alliances / wars / backstab from 20260921100000_alliance_war.sql. Six seats, figures fig0..fig7.';

revoke all on function public.game_action(text, text, jsonb) from public;
grant execute on function public.game_action(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Every room that already exists, brought up to the new shape.
--
-- The reads above all coalesce, so this backfill is not strictly required for
-- correctness - it is required so that a phone or a TV that subscribes to the
-- row sees the same keys on an old game as on a new one, and never has to
-- decide whether a missing `alliances` means "none" or "not loaded yet".
--
-- `defaults || existing` order matters on the players: the right-hand side of
-- || wins, so a room that somehow already carries these flags keeps them.
-- ---------------------------------------------------------------------------

update public.test
   set game = coalesce(game, '{}'::jsonb) || jsonb_build_object(
     'round',      greatest(coalesce((game->>'round')::integer, 1), 1),
     'alliances',  case when jsonb_typeof(game->'alliances')  = 'array' then game->'alliances'  else '[]'::jsonb end,
     'allyOffers', case when jsonb_typeof(game->'allyOffers') = 'array' then game->'allyOffers' else '[]'::jsonb end,
     'wars',       case when jsonb_typeof(game->'wars')       = 'array' then game->'wars'       else '[]'::jsonb end,
     'winners',    case when jsonb_typeof(game->'winners') = 'array' then game->'winners'
                        when game->>'winner' is not null    then jsonb_build_array(game->>'winner')
                        else '[]'::jsonb end);

update public.test
   set "Players" = coalesce((
     select jsonb_agg(
              jsonb_build_object('traitor', false, 'traitorUntil', 0, 'backstabUsed', false) || p
              order by (p->>'order')::integer)
       from jsonb_array_elements("Players") as p), '[]'::jsonb)
 where jsonb_typeof("Players") = 'array';

