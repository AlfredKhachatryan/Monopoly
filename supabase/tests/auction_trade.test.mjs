#!/usr/bin/env node
/**
 * Offline tests for the auction + trading server rules.
 *
 *   npm run test:sql
 *
 * Applies EVERY migration in supabase/migrations, in filename order, to a
 * throw-away in-process Postgres (@electric-sql/pglite), then drives
 * public.game_action the way the phones do. Nothing here talks to a network,
 * a Supabase project or the supabase CLI.
 *
 * The only thing the loader does to the migrations is create the roles they
 * grant to (anon / authenticated / service_role), which a hosted Supabase
 * project already has and a bare Postgres does not. The migration files
 * themselves are read verbatim; `alter publication supabase_realtime` is
 * already guarded by an `if exists` in 20260904123000 and takes its notice
 * branch here.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', 'migrations');

// ---------------------------------------------------------------------------
// tiny test runner
// ---------------------------------------------------------------------------

const results = [];
let group = '';

function section(name) {
  group = name;
}

async function test(name, fn) {
  try {
    await fn();
    results.push({ group, name, ok: true });
  } catch (err) {
    results.push({ group, name, ok: false, err });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

/** JSON.stringify with object keys sorted, so key order never matters. */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

function eq(actual, expected, msg) {
  const a = canon(actual);
  const b = canon(expected);
  if (a !== b) throw new Error(`${msg || 'not equal'}: got ${a}, want ${b}`);
}

// ---------------------------------------------------------------------------
// database
// ---------------------------------------------------------------------------

const db = await PGlite.create();

await db.exec(`
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
  end $$;
`);

const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  try {
    await db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  } catch (err) {
    console.error(`\nFAILED to apply migration ${f}:\n${err.message}\n`);
    process.exit(1);
  }
}

const SEED_BOARD = (
  await db.query(`select position from public.test where uuid = 'v6Pstf'`)
).rows[0].position;

let roomSeq = 0;

/** Every selectable figure, fig0..fig7 (20260920100000_six_players.sql). */
const FIGS = ['fig0', 'fig1', 'fig2', 'fig3', 'fig4', 'fig5', 'fig6', 'fig7'];
/** Six seats is the cap; the two spare figures only exist so the last picker has a choice. */
const MAX_SEATS = 6;
/** Six names, so `newRoom(SIX)` fills a room to the cap (fig0..fig5, p0..p5). */
const SIX = ['Ero', 'Koli', 'Gaya', 'Afo', 'Bat', 'Mummy'];

/**
 * Fresh room with `names.length` players joined through the real `join` action.
 * Seat i takes `fig<i>` as playerId `p<i>`; pass `figs` to seat other figures
 * (the playerId still matches the figure: fig6 is always p6).
 */
async function newRoom(names = ['Ero', 'Koli', 'Gaya', 'Afo'], figs = null) {
  const room = 'rm' + String(++roomSeq).padStart(4, '0');
  await db.query(
    `insert into public.test (uuid, position, "Players", current_order)
     values ($1, $2::jsonb, '[]'::jsonb, 0)`,
    [room, JSON.stringify(SEED_BOARD)],
  );
  for (let i = 0; i < names.length; i += 1) {
    const fig = figs ? figs[i] : `fig${i}`;
    await call(room, 'join', { name: names[i], figure: fig, playerId: `p${fig.slice(3)}` });
  }
  return room;
}

async function call(room, action, payload = {}) {
  const res = await db.query(
    `with r as (select public.game_action($1, $2, $3::jsonb) as t)
     select (t).uuid as uuid, (t).position as position, (t)."Players" as players,
            (t).current_order as current_order, (t).game as game
       from r`,
    [room, action, JSON.stringify(payload)],
  );
  return res.rows[0];
}

/** Expect `call` to be rejected; returns the message. */
async function rejects(room, action, payload, match) {
  const before = await row(room);
  let message = null;
  try {
    await call(room, action, payload);
  } catch (err) {
    message = err.message;
  }
  assert(message !== null, `${action} should have been rejected`);
  if (match) {
    assert(
      match instanceof RegExp ? match.test(message) : message.includes(match),
      `${action}: message ${JSON.stringify(message)} does not match ${match}`,
    );
  }
  const after = await row(room);
  eq(after, before, `${action} was rejected but the row changed`);
  return message;
}

async function row(room) {
  const res = await db.query(
    `select position, "Players" as players, current_order, game from public.test where uuid = $1`,
    [room],
  );
  return res.rows[0];
}

/** Write a known state straight into the row, so tests do not depend on dice. */
async function arrange(room, patch) {
  const r = await row(room);
  const players = r.players.map((p) => {
    const over = (patch.players || {})[p.figure] || {};
    return { ...p, ...over };
  });
  const board = JSON.parse(JSON.stringify(r.position));
  for (const [cell, fig] of Object.entries(patch.owners || {})) {
    for (const f of FIGS) board[cell].bought[f] = false;
    if (fig) board[cell].bought[fig] = true;
  }
  for (const [cell, h] of Object.entries(patch.houses || {})) board[cell].houses = h;
  const game = { ...r.game, ...(patch.game || {}) };
  await db.query(
    `update public.test
        set "Players" = $2::jsonb, position = $3::jsonb, current_order = $4, game = $5::jsonb
      where uuid = $1`,
    [
      room,
      JSON.stringify(players),
      JSON.stringify(board),
      patch.current_order ?? r.current_order,
      JSON.stringify(game),
    ],
  );
}

const money = (r, fig) => r.players.find((p) => p.figure === fig).money;
const owner = (r, cell) => {
  const b = r.position[String(cell)].bought || {};
  const own = Object.keys(b).filter((k) => b[k] === true);
  assert(own.length <= 1, `cell ${cell} has ${own.length} owners: ${own}`);
  return own[0] || null;
};
const types = (r) => (r.game.events || []).map((e) => e.type);
const ev = (r, type) => (r.game.events || []).find((e) => e.type === type);

/** phase 'act' for the player at `current_order`, standing on `cell`. */
async function standOn(room, fig, cell, extra = {}) {
  await arrange(room, {
    players: { [fig]: { position: cell, ...(extra.player || {}) }, ...(extra.players || {}) },
    game: { phase: 'act', doubles: 0, auction: null, trade: null, ...(extra.game || {}) },
    ...(extra.owners ? { owners: extra.owners } : {}),
  });
}

// ---------------------------------------------------------------------------
// 1. Auctions
// ---------------------------------------------------------------------------

section('auction');

await test('start builds the rotation: after startedBy first, startedBy last', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27); // fig0 is current_order 0
  const r = await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  eq(r.game.phase, 'auction', 'phase');
  eq(r.game.auction.order, ['fig1', 'fig2', 'fig3', 'fig0'], 'order');
  eq(r.game.auction.in, ['fig1', 'fig2', 'fig3', 'fig0'], 'in');
  eq(r.game.auction.turn, 'fig1', 'turn');
  eq(r.game.auction.bid, 0, 'bid');
  eq(r.game.auction.leader, null, 'leader');
  eq(r.game.auction.cell, 27, 'cell');
  eq(r.game.auction.startedBy, 'fig0', 'startedBy');
  eq(ev(r, 'auction_start'), { type: 'auction_start', figure: 'fig0', cell: 27 }, 'event');
});

await test('bids rotate, skip the leader, and the last bidder wins and pays', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });

  let r = await call(room, 'auction_bid', { playerId: 'p1', amount: 100 });
  eq(r.game.auction.bid, 100);
  eq(r.game.auction.leader, 'fig1');
  eq(r.game.auction.turn, 'fig2', 'leader must not be asked to bid against himself');
  eq(r.game.auction.last, { fig1: 100 });

  r = await call(room, 'auction_bid', { playerId: 'p2', amount: 110 });
  eq(r.game.auction.leader, 'fig2');
  eq(r.game.auction.turn, 'fig3');

  r = await call(room, 'auction_drop', { playerId: 'p3' });
  eq(r.game.auction.in, ['fig1', 'fig2', 'fig0']);
  eq(r.game.auction.turn, 'fig0');

  r = await call(room, 'auction_drop', { playerId: 'p0' });
  eq(r.game.auction.turn, 'fig1', 'back to the only other live bidder');

  const before = money(await row(room), 'fig2');
  r = await call(room, 'auction_drop', { playerId: 'p1' });
  eq(r.game.auction, null, 'auction cleared');
  eq(r.game.phase, 'act', 'starter continues their turn');
  eq(owner(r, 27), 'fig2', 'winner owns the cell');
  eq(money(r, 'fig2'), before - 110, 'winner paid exactly the high bid');
  eq(ev(r, 'auction_won'), { type: 'auction_won', figure: 'fig2', cell: 27, amount: 110 });
  eq(ev(r, 'pay'), {
    type: 'pay', figure: 'fig2', to: null, amount: 110, reason: 'auction', cell: 27,
  });
  eq(r.position['27'].houses, undefined, 'houses untouched');
});

await test('nobody bids: the cell stays with the bank', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  const cash = (await row(room)).players.map((p) => p.money);
  await call(room, 'auction_drop', { playerId: 'p1' });
  await call(room, 'auction_drop', { playerId: 'p2' });
  await call(room, 'auction_drop', { playerId: 'p3' });
  const r = await call(room, 'auction_drop', { playerId: 'p0' });
  eq(r.game.auction, null);
  eq(r.game.phase, 'act');
  eq(owner(r, 27), null, 'bank keeps it');
  eq(ev(r, 'auction_none'), { type: 'auction_none', cell: 27 });
  eq(r.players.map((p) => p.money), cash, 'no money moved');
});

await test('the single player left with no bid still gets their move (bid)', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  await call(room, 'auction_drop', { playerId: 'p1' });
  await call(room, 'auction_drop', { playerId: 'p2' });
  let r = await call(room, 'auction_drop', { playerId: 'p3' });
  eq(r.game.auction.in, ['fig0'], 'only the starter is left');
  eq(r.game.auction.turn, 'fig0', 'and it is still their move');
  eq(r.game.auction.leader, null);
  const before = money(r, 'fig0');
  r = await call(room, 'auction_bid', { playerId: 'p0', amount: 10 });
  eq(r.game.auction, null, 'a bid with nobody to answer wins at once');
  eq(owner(r, 27), 'fig0');
  eq(money(r, 'fig0'), before - 10);
});

await test('the single player left with no bid can also drop', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  await call(room, 'auction_drop', { playerId: 'p1' });
  await call(room, 'auction_drop', { playerId: 'p2' });
  await call(room, 'auction_drop', { playerId: 'p3' });
  const r = await call(room, 'auction_drop', { playerId: 'p0' });
  eq(r.game.auction, null);
  eq(owner(r, 27), null);
  assert(types(r).includes('auction_none'));
});

await test('bid validation: too low, not a multiple of 10, over money, out of turn, dropped', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27, { players: { fig1: { money: 150 } } });
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });

  eq(await rejects(room, 'auction_bid', { playerId: 'p1', amount: 0 }, 'Bid at least 10$'),
     'Bid at least 10$');
  await rejects(room, 'auction_bid', { playerId: 'p1', amount: 15 }, 'multiple of 10');
  await rejects(room, 'auction_bid', { playerId: 'p1', amount: 160 }, 'Not enough money');
  await rejects(room, 'auction_bid', { playerId: 'p2', amount: 100 }, 'not your turn to bid');
  await rejects(room, 'auction_drop', { playerId: 'p2' }, 'not your turn to bid');

  await call(room, 'auction_bid', { playerId: 'p1', amount: 100 });
  await rejects(room, 'auction_bid', { playerId: 'p2', amount: 100 }, 'Bid at least 110$');
  await rejects(room, 'auction_bid', { playerId: 'p2', amount: 105 }, 'multiple of 10');

  await call(room, 'auction_drop', { playerId: 'p2' });
  // fig2 dropped: they are no longer the mover, so both of their actions bounce
  await rejects(room, 'auction_bid', { playerId: 'p2', amount: 500 }, 'not your turn to bid');
  await rejects(room, 'auction_drop', { playerId: 'p2' }, 'not your turn to bid');
});

await test('every other gameplay action is rejected while an auction runs', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27, { owners: { 17: 'fig1' } });
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  const blocked = [
    ['roll', { playerId: 'p0' }],
    ['move', { playerId: 'p0', to: 5 }],
    ['buy', { playerId: 'p0', cell: '27' }],
    ['build', { playerId: 'p0', cell: '2' }],
    ['pay_jail', { playerId: 'p0' }],
    ['use_jail_card', { playerId: 'p0' }],
    ['end_turn', { playerId: 'p0' }],
    ['auction_start', { playerId: 'p0', cell: 27 }],
    ['trade_offer', { playerId: 'p0', to: 'fig1', give: { cells: [], cash: 100 }, get: { cells: [17], cash: 0 } }],
    ['trade_accept', { playerId: 'p1' }],
    ['trade_decline', { playerId: 'p1' }],
    ['trade_cancel', { playerId: 'p0' }],
    ['trade_counter', { playerId: 'p1', give: { cells: [], cash: 0 }, get: { cells: [], cash: 10 } }],
  ];
  for (const [action, payload] of blocked) {
    await rejects(room, action, payload, 'An auction is running');
  }
});

await test('skip_turn drops the current bidder instead of moving the game turn', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  let r = await call(room, 'skip_turn', {});
  eq(r.current_order, 0, 'the game turn is untouched');
  eq(r.game.phase, 'auction');
  eq(r.game.auction.in, ['fig2', 'fig3', 'fig0']);
  eq(r.game.auction.turn, 'fig2');
  eq(ev(r, 'drop'), { type: 'drop', figure: 'fig1', cell: 27 });

  await call(room, 'auction_bid', { playerId: 'p2', amount: 20 });
  await call(room, 'skip_turn', {});          // fig3 drops
  r = await call(room, 'skip_turn', {});      // fig0 drops -> fig2 alone -> wins
  eq(r.game.auction, null);
  eq(owner(r, 27), 'fig2');
  eq(r.game.phase, 'act');
});

await test('after the auction the starter can end_turn, and rolls again on doubles', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27, { game: { doubles: 1 } });
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  await call(room, 'auction_bid', { playerId: 'p1', amount: 10 });
  await call(room, 'auction_drop', { playerId: 'p2' });
  await call(room, 'auction_drop', { playerId: 'p3' });
  let r = await call(room, 'auction_drop', { playerId: 'p0' });
  eq(r.game.phase, 'act');
  eq(r.game.doubles, 1, 'doubles survive the auction');
  r = await call(room, 'end_turn', { playerId: 'p0' });
  eq(r.current_order, 0, 'doubles: same player rolls again');
  eq(r.game.phase, 'roll');
  assert(types(r).includes('again'));

  // and without doubles the turn moves on
  const room2 = await newRoom();
  await standOn(room2, 'fig0', 27);
  await call(room2, 'auction_start', { playerId: 'p0', cell: 27 });
  for (const p of ['p1', 'p2', 'p3', 'p0']) await call(room2, 'auction_drop', { playerId: p });
  const r2 = await call(room2, 'end_turn', { playerId: 'p0' });
  eq(r2.current_order, 1);
});

await test('leave by the auction leader clears the bid and keeps the auction running', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  await call(room, 'auction_bid', { playerId: 'p1', amount: 100 });   // leader fig1, turn fig2
  // A second bid from someone who is NOT leaving: with only one bid ever
  // placed, removing just the leaver's own `last` key is indistinguishable
  // from resetting the whole map to {} — this bid tells the two apart.
  await call(room, 'auction_bid', { playerId: 'p2', amount: 110 });   // leader fig2, turn fig3
  const r = await call(room, 'leave', { playerId: 'p2' });
  eq(r.game.phase, 'auction');
  eq(r.game.auction.leader, null, 'leader cleared');
  eq(r.game.auction.bid, 0, 'bid reset');
  eq(r.game.auction.last, {}, 'every chip is gone, not just the leader\'s own — bidding genuinely restarts');
  eq(r.game.auction.order, ['fig1', 'fig3', 'fig0']);
  eq(r.game.auction.in, ['fig1', 'fig3', 'fig0']);
  eq(r.game.auction.turn, 'fig3', 'the mover is unchanged');
  eq(r.players.length, 3);
});

await test('leave by the bidder to move hands the move on correctly', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 }); // turn fig1
  const r = await call(room, 'leave', { playerId: 'p1' });
  eq(r.game.phase, 'auction');
  eq(r.game.auction.order, ['fig2', 'fig3', 'fig0']);
  eq(r.game.auction.turn, 'fig2', 'the next one in the rotation moves');
});

await test('leave by startedBy: the auction finishes, then the next player rolls', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  await call(room, 'auction_bid', { playerId: 'p1', amount: 50 });

  let r = await call(room, 'leave', { playerId: 'p0' });
  eq(r.game.phase, 'auction', 'the auction survives the starter leaving');
  eq(r.game.auction.order, ['fig1', 'fig2', 'fig3']);
  eq(r.game.auction.startedBy, 'fig0');

  await call(room, 'auction_drop', { playerId: 'p2' });
  const before = money(await row(room), 'fig1');
  r = await call(room, 'auction_drop', { playerId: 'p3' });
  eq(r.game.auction, null);
  eq(owner(r, 27), 'fig1', 'the leader still wins');
  eq(money(r, 'fig1'), before - 50);
  eq(r.game.phase, 'roll', 'the starter is gone, so the new current player rolls');
});

await test('leave by the last bidder in an auction of one ends it with no sale', async () => {
  const room = await newRoom(['Ero', 'Koli']);
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 }); // order [fig1, fig0]
  await call(room, 'auction_drop', { playerId: 'p1' });            // in [fig0], turn fig0
  const r = await call(room, 'leave', { playerId: 'p0' });
  eq(r.game.auction, null);
  eq(owner(r, 27), null);
  assert(types(r).includes('auction_none'));
});

await test('auction_start guards: not your turn, wrong phase, wrong cell, owned cell', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await rejects(room, 'auction_start', { playerId: 'p1', cell: 27 }, 'Not your turn');
  await rejects(room, 'auction_start', { playerId: 'p0', cell: 26 }, 'not standing on that cell');
  await arrange(room, { game: { phase: 'roll' } });
  await rejects(room, 'auction_start', { playerId: 'p0', cell: 27 }, 'Roll first');
  await arrange(room, { game: { phase: 'act' }, owners: { 27: 'fig1' } });
  await rejects(room, 'auction_start', { playerId: 'p0', cell: 27 }, 'Already owned');
  await standOn(room, 'fig0', 21); // Free parking
  await rejects(room, 'auction_start', { playerId: 'p0', cell: 21 }, 'not for sale');
});

await test('bankrupt players are left out of the rotation', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27, { players: { fig2: { bankrupt: true, money: 0 } } });
  const r = await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  eq(r.game.auction.order, ['fig1', 'fig3', 'fig0']);
  await rejects(room, 'auction_bid', { playerId: 'p2', amount: 10 }, 'You are bankrupt');
});

await test('the log carries the new events with seq and by', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  await call(room, 'auction_bid', { playerId: 'p1', amount: 100 });
  await call(room, 'auction_drop', { playerId: 'p2' });
  await call(room, 'auction_drop', { playerId: 'p3' });
  const r = await call(room, 'auction_drop', { playerId: 'p0' });
  const log = r.game.log;
  assert(Array.isArray(log) && log.length > 0, 'log exists');
  for (const e of log) {
    assert(typeof e.seq === 'number', `log row has no seq: ${JSON.stringify(e)}`);
    assert('by' in e, `log row has no by: ${JSON.stringify(e)}`);
  }
  const wanted = ['auction_start', 'bid', 'drop', 'auction_won', 'pay'];
  for (const t of wanted) {
    assert(log.some((e) => e.type === t), `log is missing ${t}`);
  }
  const bid = log.find((e) => e.type === 'bid');
  eq(bid.by, 'p1', 'bid tagged with the bidder');
  assert(log.length <= 40, 'log capped at 40');
});

await test('a long auction still leaves the log capped at 40', async () => {
  const room = await newRoom();
  for (let i = 0; i < 12; i += 1) {
    await standOn(room, 'fig0', 27);
    await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
    for (const p of ['p1', 'p2', 'p3', 'p0']) await call(room, 'auction_drop', { playerId: p });
  }
  const r = await row(room);
  assert(r.game.log.length === 40, `log length ${r.game.log.length}`);
});

// ---------------------------------------------------------------------------
// 2. Trading
// ---------------------------------------------------------------------------

section('trade');

/** fig0 owns 17, fig1 owns 27; fig0 is the current player in phase 'act'. */
async function tradeRoom() {
  const room = await newRoom();
  await arrange(room, {
    owners: { 17: 'fig0', 27: 'fig1', 19: 'fig2' },
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  return room;
}

await test('offer only by the current-turn player', async () => {
  const room = await tradeRoom();
  await rejects(
    room, 'trade_offer',
    { playerId: 'p1', to: 'fig0', give: { cells: [27], cash: 0 }, get: { cells: [17], cash: 0 } },
    'only offer a trade on your turn',
  );
  const r = await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 180 },
  });
  eq(r.game.trade.from, 'fig0');
  eq(r.game.trade.to, 'fig1');
  eq(r.game.trade.give, { cells: [17], cash: 0 });
  eq(r.game.trade.get, { cells: [], cash: 180 });
  eq(r.game.trade.counter, false);
  eq(r.game.trade.id, r.game.seq, 'id is the seq at creation');
  eq(ev(r, 'trade'), {
    type: 'trade', status: 'offered', figure: 'fig0', to: 'fig1',
    give: { cells: [17], cash: 0 }, get: { cells: [], cash: 180 }, id: r.game.seq,
  });
});

await test('only one pending offer at a time', async () => {
  const room = await tradeRoom();
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 180 },
  });
  await rejects(
    room, 'trade_offer',
    { playerId: 'p0', to: 'fig2', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 } },
    'already a pending offer',
  );
});

await test('offer validation', async () => {
  const room = await tradeRoom();
  const offer = (o) => ({ playerId: 'p0', to: 'fig1', give: { cells: [], cash: 0 }, get: { cells: [], cash: 0 }, ...o });

  await rejects(room, 'trade_offer', offer({ give: { cells: [27], cash: 0 } }), 'You do not own Ubisoft');
  await rejects(room, 'trade_offer', offer({ get: { cells: [17], cash: 0 } }), 'They do not own Далма Молл');
  await rejects(room, 'trade_offer', offer({ give: { cells: [], cash: 99990 } }), 'You do not have that much cash');
  await rejects(room, 'trade_offer', offer({ get: { cells: [], cash: 99990 } }), 'They do not have that much cash');
  await rejects(room, 'trade_offer', offer({ give: { cells: [], cash: 15 } }), 'whole number of 10');
  await rejects(room, 'trade_offer', offer({ give: { cells: [], cash: -10 } }), 'whole number of 10');
  await rejects(room, 'trade_offer', offer({}), 'cannot be empty');
  await rejects(room, 'trade_offer', offer({ to: 'fig0', give: { cells: [17], cash: 0 } }), 'trade with yourself');
  await rejects(room, 'trade_offer', offer({ to: 'fig9', give: { cells: [17], cash: 0 } }), 'not in this room');

  await arrange(room, { players: { fig1: { bankrupt: true } } });
  await rejects(room, 'trade_offer', offer({ give: { cells: [17], cash: 0 } }), 'is bankrupt');
  await arrange(room, { players: { fig1: { bankrupt: false } } });

  // a colour set with buildings is not tradable in either direction
  await arrange(room, { owners: { 17: 'fig0', 19: 'fig0', 20: 'fig0' }, houses: { 19: 1 } });
  await rejects(room, 'trade_offer', offer({ give: { cells: [17], cash: 0 } }),
                'Далма Молл has buildings in its colour set');
  // railroads never have a colour set, so they stay tradable
  await arrange(room, { owners: { 6: 'fig0' } });
  const r = await call(room, 'trade_offer', offer({ give: { cells: [6], cash: 0 } }));
  eq(r.game.trade.give.cells, [6]);
});

await test('accept swaps cells and cash exactly, and clears', async () => {
  const room = await tradeRoom();
  const b = await row(room);
  const m0 = money(b, 'fig0');
  const m1 = money(b, 'fig1');
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 40 }, get: { cells: [27], cash: 180 },
  });
  const r = await call(room, 'trade_accept', { playerId: 'p1' });
  eq(owner(r, 17), 'fig1', '17 changed hands');
  eq(owner(r, 27), 'fig0', '27 changed hands');
  eq(r.position['17'].bought.fig0, false, "old owner's key cleared");
  eq(money(r, 'fig0'), m0 - 40 + 180, 'fig0 cash');
  eq(money(r, 'fig1'), m1 + 40 - 180, 'fig1 cash');
  eq(money(r, 'fig0') + money(r, 'fig1'), m0 + m1, 'cash conserved');
  eq(r.game.trade, null, 'cleared');
  eq(ev(r, 'trade').status, 'accepted');
  eq(ev(r, 'trade').figure, 'fig0', 'figure is always the offer from');
});

await test('decline and cancel', async () => {
  let room = await tradeRoom();
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 },
  });
  await rejects(room, 'trade_decline', { playerId: 'p2' }, 'not yours to answer');
  await rejects(room, 'trade_cancel', { playerId: 'p1' }, 'not yours to cancel');
  let r = await call(room, 'trade_decline', { playerId: 'p1' });
  eq(r.game.trade, null);
  eq(ev(r, 'trade').status, 'declined');
  eq(owner(r, 17), 'fig0', 'nothing moved');

  room = await tradeRoom();
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 },
  });
  r = await call(room, 'trade_cancel', { playerId: 'p0' });
  eq(r.game.trade, null);
  eq(ev(r, 'trade').status, 'cancelled');
});

await test('counter by `to` flips from/to, sets counter:true and a new id', async () => {
  const room = await tradeRoom();
  const first = await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 180 },
  });
  await rejects(room, 'trade_counter',
    { playerId: 'p2', give: { cells: [], cash: 0 }, get: { cells: [17], cash: 0 } },
    'not yours to answer');
  const r = await call(room, 'trade_counter', {
    playerId: 'p1', give: { cells: [], cash: 100 }, get: { cells: [17], cash: 0 },
  });
  eq(r.game.trade.from, 'fig1');
  eq(r.game.trade.to, 'fig0');
  eq(r.game.trade.counter, true);
  assert(r.game.trade.id !== first.game.trade.id, 'new id');
  eq(ev(r, 'trade').status, 'countered');
  eq(ev(r, 'trade').figure, 'fig1');

  // the counter can then be accepted by the original proposer, off their turn
  const m0 = money(r, 'fig0');
  const acc = await call(room, 'trade_accept', { playerId: 'p0' });
  eq(owner(acc, 17), 'fig1');
  eq(money(acc, 'fig0'), m0 + 100);
  eq(acc.game.trade, null);
});

await test('counter is allowed at any time, also when it is not the countering player turn', async () => {
  const room = await tradeRoom();
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 180 },
  });
  await arrange(room, { current_order: 2, game: { phase: 'roll' } });
  const r = await call(room, 'trade_counter', {
    playerId: 'p1', give: { cells: [27], cash: 0 }, get: { cells: [17], cash: 0 },
  });
  eq(r.game.trade.from, 'fig1');
  eq(r.current_order, 2, 'the game turn is untouched');
});

await test('accept-time revalidation expires the offer', async () => {
  const room = await tradeRoom();
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 180 },
  });
  // 17 changes hands behind the offer's back
  await arrange(room, { owners: { 17: 'fig2' } });
  const r = await call(room, 'trade_accept', { playerId: 'p1' });
  eq(r.game.trade, null, 'the dead offer is cleared');
  eq(ev(r, 'trade').status, 'expired');
  assert(/do not own/.test(ev(r, 'trade').reason), 'reason recorded');
  eq(owner(r, 17), 'fig2', 'nothing moved');
});

await test('accept-time revalidation also catches money that has since been spent', async () => {
  const room = await tradeRoom();
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 2000 },
  });
  await arrange(room, { players: { fig1: { money: 100 } } });
  const r = await call(room, 'trade_accept', { playerId: 'p1' });
  eq(ev(r, 'trade').status, 'expired');
  eq(money(r, 'fig1'), 100);
  eq(owner(r, 17), 'fig0');
});

await test('end_turn, skip_turn and auction_start cancel a pending offer', async () => {
  for (const [action, payload] of [
    ['end_turn', { playerId: 'p0' }],
    ['skip_turn', {}],
  ]) {
    const room = await tradeRoom();
    await call(room, 'trade_offer', {
      playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 },
    });
    const r = await call(room, action, payload);
    eq(r.game.trade, null, `${action} cleared the offer`);
    eq(ev(r, 'trade').status, 'cancelled', `${action} event`);
  }

  const room = await tradeRoom();
  await arrange(room, { players: { fig0: { position: 29 } } });
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 },
  });
  const r = await call(room, 'auction_start', { playerId: 'p0', cell: 29 });
  eq(r.game.trade, null);
  eq(ev(r, 'trade').status, 'cancelled');
  eq(r.game.phase, 'auction');
});

await test('leave by either party cancels the offer', async () => {
  for (const who of ['p0', 'p1']) {
    const room = await tradeRoom();
    await call(room, 'trade_offer', {
      playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 },
    });
    const r = await call(room, 'leave', { playerId: who });
    eq(r.game.trade, null, `${who} leaving cleared it`);
    eq(ev(r, 'trade').status, 'cancelled');
  }
  // a third party leaving does not touch it
  const room = await tradeRoom();
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 },
  });
  const r = await call(room, 'leave', { playerId: 'p3' });
  assert(r.game.trade !== null, 'offer survives an unrelated leave');
});

await test('a party going bankrupt inside a landing expires the offer', async () => {
  const room = await tradeRoom();
  // fig1 owns 27 (Ubisoft, 260) with a hotel worth of rent; fig2 is broke
  await arrange(room, {
    owners: { 27: 'fig1', 29: 'fig1', 30: 'fig1' },
    houses: { 27: 5, 29: 5, 30: 5 },
    players: { fig2: { money: 5, position: 1 } },
    game: { phase: 'act', dice: [3, 4] },
  });
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig2', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 0 },
  });
  const r = await call(room, 'move', { playerId: 'p2', to: 27 });
  assert(r.players.find((p) => p.figure === 'fig2').bankrupt, 'fig2 went bankrupt');
  eq(r.game.trade, null, 'the offer died with them');
  eq(ev(r, 'trade').status, 'expired');
});

await test('rent after a trade goes to the new owner', async () => {
  const room = await tradeRoom();
  await arrange(room, { owners: { 17: 'fig0' }, game: { phase: 'act', dice: [3, 4] } });
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 },
  });
  await call(room, 'trade_accept', { playerId: 'p1' });
  const before = await row(room);
  const r = await call(room, 'move', { playerId: 'p2', to: 17 });
  const rent = 160 / 10;
  eq(money(r, 'fig1'), money(before, 'fig1') + rent, 'new owner collected');
  eq(money(r, 'fig0'), money(before, 'fig0'), 'old owner got nothing');
  eq(money(r, 'fig2'), money(before, 'fig2') - rent);
});

await test('trades are rejected while an auction runs, and resume after it', async () => {
  const room = await tradeRoom();
  await arrange(room, { players: { fig0: { position: 29 } } });
  await call(room, 'auction_start', { playerId: 'p0', cell: 29 });
  await rejects(room, 'trade_offer',
    { playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 } },
    'An auction is running');
  for (const p of ['p1', 'p2', 'p3', 'p0']) await call(room, 'auction_drop', { playerId: p });
  const r = await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 },
  });
  assert(r.game.trade !== null, 'trading works again');
});

await test('answering with nothing pending is rejected', async () => {
  const room = await tradeRoom();
  await rejects(room, 'trade_accept', { playerId: 'p1' }, 'no offer to answer');
  await rejects(room, 'trade_decline', { playerId: 'p1' }, 'no offer to answer');
  await rejects(room, 'trade_counter',
    { playerId: 'p1', give: { cells: [], cash: 0 }, get: { cells: [], cash: 10 } },
    'no offer to answer');
  await rejects(room, 'trade_cancel', { playerId: 'p0' }, 'no offer to cancel');
});

await test('game.auction and game.trade are json null, never missing', async () => {
  const room = await tradeRoom();
  const r = await call(room, 'end_turn', { playerId: 'p0' });
  assert('auction' in r.game, 'auction key present');
  assert('trade' in r.game, 'trade key present');
  eq(r.game.auction, null);
  eq(r.game.trade, null);
  // and the phone-side `game?.auction ?? null` yields null either way
  eq(r.game?.auction ?? null, null);
  eq(r.game?.trade ?? null, null);
});

await test('new_game clears a running auction and a pending offer', async () => {
  const room = await tradeRoom();
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [17], cash: 0 }, get: { cells: [], cash: 10 },
  });
  const r = await call(room, 'new_game', { position: SEED_BOARD });
  eq(r.game.trade, null);
  eq(r.game.auction, null);
  eq(r.game.phase, 'roll');
  eq(owner(r, 17), null);
});

// ---------------------------------------------------------------------------
// 3. Six players, eight figures (20260920100000_six_players.sql)
// ---------------------------------------------------------------------------

section('six players');

/** SEED_BOARD as a pre-20260920100000 client would have written it: fig0..fig3 only. */
function legacyBoard(owners = {}) {
  const board = JSON.parse(JSON.stringify(SEED_BOARD));
  for (const cell of Object.values(board)) {
    for (const f of ['fig4', 'fig5', 'fig6', 'fig7']) {
      delete cell[f];
      if (cell.bought) delete cell.bought[f];
    }
  }
  for (const [cell, fig] of Object.entries(owners)) board[cell].bought[fig] = true;
  return board;
}

/** Every cell's `bought` (and token flags) carry exactly fig0..fig7. */
function assertEightKeys(board, what) {
  for (const [key, cell] of Object.entries(board)) {
    eq(Object.keys(cell.bought || {}).sort(), FIGS, `${what}: cell ${key} bought keys`);
    for (const f of FIGS) {
      assert(f in cell, `${what}: cell ${key} has no ${f} token flag`);
    }
  }
}

await test('a 5th and a 6th player can join, a 7th cannot', async () => {
  const room = await newRoom(['Ero', 'Koli', 'Gaya', 'Afo']);
  let r = await call(room, 'join', { name: 'Bat', figure: 'fig4', playerId: 'p4' });
  eq(r.players.length, 5, 'five seated');
  eq(r.players[4], {
    name: 'Bat', figure: 'fig4', money: 2500, position: 1, order: 4,
    playerId: 'p4', inJail: false, jailTurns: 0, jailCards: 0, bankrupt: false,
  }, 'the 5th seat is a normal player row');

  r = await call(room, 'join', { name: 'Mummy', figure: 'fig5', playerId: 'p5' });
  eq(r.players.length, MAX_SEATS, 'six seated');
  eq(r.players.map((p) => p.order), [0, 1, 2, 3, 4, 5], 'orders are 0..5');
  eq(r.position['1'].fig5, true, 'the 6th token is on Start');

  await rejects(room, 'join', { name: 'Octo', figure: 'fig6', playerId: 'p6' }, 'Room is full');
});

await test('fig4..fig7 are accepted, a bogus figure is not, a taken one is not', async () => {
  const room = await newRoom([]);
  for (const fig of ['fig4', 'fig5', 'fig6', 'fig7']) {
    const r = await call(room, 'join', { name: fig, figure: fig, playerId: `x-${fig}` });
    assert(r.players.some((p) => p.figure === fig), `${fig} should have been seated`);
  }
  eq((await row(room)).players.length, 4, 'four of the new figures seated alone');

  await rejects(room, 'join', { name: 'Nope', figure: 'fig8', playerId: 'x8' }, 'Unknown figure fig8');
  await rejects(room, 'join', { name: 'Nope', figure: 'figX', playerId: 'xX' }, 'Unknown figure figX');
  await rejects(room, 'join', { name: 'Nope', figure: 'fig5', playerId: 'xdup' },
    'Figure is already taken');
});

await test('the turn cycles through all six seats and comes back round', async () => {
  const room = await newRoom(SIX);
  eq((await row(room)).current_order, 0, 'starts at seat 0');
  const seen = [];
  for (let i = 0; i < MAX_SEATS + 1; i += 1) {
    const r = await call(room, 'skip_turn', {});
    seen.push(r.current_order);
  }
  eq(seen, [1, 2, 3, 4, 5, 0, 1], 'seats 4 and 5 are reachable and it wraps');
});

await test('current_order is clamped to the seat count, not to 3', async () => {
  const room = await newRoom(SIX);
  await arrange(room, { current_order: 5, game: { phase: 'act', doubles: 0 } });
  const r = await call(room, 'skip_turn', {});
  eq(r.current_order, 0, 'seat 5 wraps to 0, it is not clamped down to 3');

  // and a room that is back down to two seats still clamps to its own size
  const small = await newRoom(['Ero', 'Koli']);
  await arrange(small, { current_order: 1, game: { phase: 'act', doubles: 0 } });
  eq((await call(small, 'skip_turn', {})).current_order, 0, 'two seats wrap at 1');
});

await test('a fig5 player buys, collects rent from fig0, completes a set and builds', async () => {
  const room = await newRoom(SIX);
  // the salmon set: 12 ($140), 14 ($140), 15 ($160)
  await arrange(room, {
    players: { fig5: { position: 12, money: 1000 }, fig0: { position: 1, money: 500 } },
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  let r = await call(room, 'buy', { playerId: 'p5', cell: '12' });
  eq(owner(r, 12), 'fig5', 'fig5 owns 12');
  eq(money(r, 'fig5'), 860, 'paid 140');

  await arrange(room, { players: { fig5: { position: 14 } } });
  r = await call(room, 'buy', { playerId: 'p5', cell: '14' });
  await arrange(room, { players: { fig5: { position: 15 } } });
  r = await call(room, 'buy', { playerId: 'p5', cell: '15' });
  eq(owner(r, 14), 'fig5');
  eq(owner(r, 15), 'fig5');
  eq(money(r, 'fig5'), 1000 - 140 - 140 - 160, 'paid for all three');

  // fig0 lands on 12: full set, no houses -> double the base rent (140/10 * 2)
  const cash5 = money(await row(room), 'fig5');
  r = await call(room, 'move', { playerId: 'p0', to: 12 });
  eq(money(r, 'fig0'), 500 - 28, 'fig0 paid the doubled base rent');
  eq(money(r, 'fig5'), cash5 + 28, 'fig5 collected it');
  eq(ev(r, 'pay'), {
    type: 'pay', figure: 'fig0', to: 'fig5', amount: 28, reason: 'rent', cell: 12,
  }, 'rent event names both sides');

  // and with the whole set fig5 may build; cell 12 is in the 11..20 band ($100)
  const before = money(await row(room), 'fig5');
  r = await call(room, 'build', { playerId: 'p5', cell: '12' });
  eq(r.position['12'].houses, 1, 'one house up');
  eq(money(r, 'fig5'), before - 100, 'house price paid');
  eq(ev(r, 'build'), {
    type: 'build', figure: 'fig5', cell: 12, amount: 100, houses: 1,
  });
});

await test('an auction rotates through all six bidders', async () => {
  const room = await newRoom(SIX);
  await standOn(room, 'fig0', 27);
  let r = await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  eq(r.game.auction.order, ['fig1', 'fig2', 'fig3', 'fig4', 'fig5', 'fig0'],
    'the starter is last, everyone else follows them in seat order');
  eq(r.game.auction.in, ['fig1', 'fig2', 'fig3', 'fig4', 'fig5', 'fig0'], 'all six bid');
  eq(r.game.auction.turn, 'fig1');

  // one bid each, all the way round
  const turns = [];
  for (const [i, pid] of ['p1', 'p2', 'p3', 'p4', 'p5', 'p0'].entries()) {
    r = await call(room, 'auction_bid', { playerId: pid, amount: 10 * (i + 1) });
    turns.push(r.game.auction.turn);
  }
  eq(turns, ['fig2', 'fig3', 'fig4', 'fig5', 'fig0', 'fig1'],
    'the move walks the whole rotation and wraps past the starter');
  eq(r.game.auction.leader, 'fig0', 'the last bidder leads at 60');
  eq(r.game.auction.bid, 60);
  eq(r.game.auction.last, {
    fig1: 10, fig2: 20, fig3: 30, fig4: 40, fig5: 50, fig0: 60,
  }, 'a chip for every one of the six');

  // everyone but the leader drops
  for (const pid of ['p1', 'p2', 'p3', 'p4']) {
    await call(room, 'auction_drop', { playerId: pid });
  }
  const before = money(await row(room), 'fig0');
  r = await call(room, 'auction_drop', { playerId: 'p5' });
  eq(r.game.auction, null, 'the auction is over');
  eq(owner(r, 27), 'fig0', 'the leader won it');
  eq(money(r, 'fig0'), before - 60, 'and paid exactly the high bid');
});

await test('a fig6 player going bankrupt hands everything to the creditor', async () => {
  // seats fig0..fig4 and fig6, so the bankrupt player is a *new* figure
  const room = await newRoom(SIX, ['fig0', 'fig1', 'fig2', 'fig3', 'fig4', 'fig6']);
  await arrange(room, {
    owners: { 17: 'fig6', 19: 'fig6', 38: 'fig0', 40: 'fig0' },
    houses: {
      17: 0, 19: 0, 40: 5, // a hotel on 40: base 40 * 75 = 3000 rent
    },
    players: {
      fig6: { position: 1, money: 100, jailCards: 1 },
      fig0: { position: 6, money: 1000 },
    },
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  const r = await call(room, 'move', { playerId: 'p6', to: 40 });

  const six = r.players.find((p) => p.figure === 'fig6');
  eq(six.bankrupt, true, 'fig6 is bankrupt');
  eq(six.money, 0, 'and has nothing left');
  eq(six.jailCards, 0, 'their jail card went too');
  eq(money(r, 'fig0'), 1100, 'the creditor took their last 100$');
  eq(r.players.find((p) => p.figure === 'fig0').jailCards, 1, 'and the jail card');
  eq(owner(r, 17), 'fig0', 'cell 17 changed hands');
  eq(owner(r, 19), 'fig0', 'cell 19 changed hands');
  eq(r.position['1'].fig6, false, 'the token is off the board');
  eq(ev(r, 'bankrupt'), {
    type: 'bankrupt', figure: 'fig6', to: 'fig0', reason: 'rent', amount: 3000,
  });
  eq(r.game.winner, null, 'five players are still standing');
  eq(r.players.length, MAX_SEATS, 'a bankrupt player keeps their seat');
});

await test('new_game rebuilds every cell with the eight-key shape', async () => {
  const room = await newRoom(SIX);
  await arrange(room, { owners: { 12: 'fig5', 27: 'fig0' }, houses: { 12: 3 } });
  // the payload is what an un-updated client would still post: four keys only
  const r = await call(room, 'new_game', { position: legacyBoard() });
  assertEightKeys(r.position, 'new_game');
  eq(owner(r, 12), null, 'ownership is wiped');
  eq(r.position['12'].houses, undefined, 'houses are wiped');
  eq(r.current_order, 0);
  eq(r.players.map((p) => p.order), [0, 1, 2, 3, 4, 5], 'all six keep their seats');
  for (const p of r.players) {
    eq(p.money, 2500, `${p.figure} money`);
    eq(p.position, 1, `${p.figure} back on Start`);
    eq(r.position['1'][p.figure], true, `${p.figure} token on Start`);
  }
});

await test('reset_board does the same', async () => {
  const room = await newRoom(SIX);
  const r = await call(room, 'reset_board', { position: legacyBoard({ 27: 'fig2' }) });
  assertEightKeys(r.position, 'reset_board');
  eq(owner(r, 27), null, 'the payload carried an owner; the reset drops it');
});

await test('the migration upgraded the room that was already in the table', async () => {
  // SEED_BOARD is read back AFTER every migration has run, so this is the data
  // step's own output on the row 20260904123000 inserted.
  assertEightKeys(SEED_BOARD, 'seeded v6Pstf');
});

await test('mono_upgrade_cells turns a four-key row into an eight-key row, keeping owners', async () => {
  const roomId = 'legacy01';
  const before = legacyBoard({ 12: 'fig1', 27: 'fig3', 6: 'fig0' });
  before['12'].houses = 2;
  await db.query(
    `insert into public.test (uuid, position, "Players", current_order)
     values ($1, $2::jsonb, '[]'::jsonb, 0)`,
    [roomId, JSON.stringify(before)],
  );
  // exactly the statement the migration's data step runs
  await db.query(
    `update public.test set position = public.mono_upgrade_cells(position) where uuid = $1`,
    [roomId],
  );
  const after = (await row(roomId)).position;
  assertEightKeys(after, 'upgraded legacy row');
  eq(after['12'].bought.fig1, true, 'owner kept');
  eq(after['27'].bought.fig3, true, 'owner kept');
  eq(after['6'].bought.fig0, true, 'owner kept');
  eq(after['12'].houses, 2, 'houses untouched');
  eq(after['12'].fig4, false, 'new token flags default to false');
  eq(after['12'].bought.fig4, false, 'new ownership flags default to false');
  // nothing but the eight figure keys moved
  for (const key of Object.keys(before)) {
    const a = { ...after[key] };
    const b = { ...before[key] };
    for (const f of FIGS) { delete a[f]; delete b[f]; }
    delete a.bought;
    delete b.bought;
    eq(a, b, `cell ${key}: static card data untouched`);
  }

  // idempotent
  await db.query(
    `update public.test set position = public.mono_upgrade_cells(position) where uuid = $1`,
    [roomId],
  );
  eq((await row(roomId)).position, after, 'running it again changes nothing');
});

await test('a fig7 player can join a room whose board still has only four keys', async () => {
  // The client seed (src/Hooks/baseState.jsx) may still write fig0..fig3; the
  // server must not need fig4..fig7 to be there already.
  const roomId = 'legacy02';
  await db.query(
    `insert into public.test (uuid, position, "Players", current_order)
     values ($1, $2::jsonb, '[]'::jsonb, 0)`,
    [roomId, JSON.stringify(legacyBoard())],
  );
  await call(roomId, 'join', { name: 'Slime', figure: 'fig7', playerId: 'q7' });
  await call(roomId, 'join', { name: 'Imp', figure: 'fig0', playerId: 'q0' });

  await db.query(
    `update public.test
        set "Players" = jsonb_set(jsonb_set("Players", '{0,position}', '12'),
                                  '{1,money}', '500'),
            game = jsonb_set(coalesce(game, '{}'::jsonb), '{phase}', '"act"')
      where uuid = $1`,
    [roomId],
  );
  let r = await call(roomId, 'buy', { playerId: 'q7', cell: '12' });
  eq(owner(r, 12), 'fig7', 'a missing bought.fig7 key did not stop the purchase');

  r = await call(roomId, 'move', { playerId: 'q0', to: 12 });
  eq(money(r, 'fig7'), 2500 - 140 + 14, 'rent reached the fig7 owner');
  eq(money(r, 'fig0'), 500 - 14, 'and left the fig0 payer');

  r = await call(roomId, 'leave', { playerId: 'q7' });
  eq(owner(r, 12), null, 'and the cell went back to the bank on leave');
});

// ---------------------------------------------------------------------------
// 4. Jail, Go To Jail, three doubles, Get Out Of Jail Free
//
// Field names the UI needs:
//   game.doubles          integer, the run of consecutive doubles THIS player
//                         has rolled; 0 when there is none
//   Players[].inJail      boolean
//   Players[].jailTurns   integer, failed rolls served so far (0..2)
//   Players[].jailCards   integer, Get Out Of Jail Free cards held
//
// Events (all also land in game.log with `seq` and `by`):
//   {type:'roll',     figure, d1, d2, doubles:boolean}
//   {type:'jail',     figure, reason:'gtj'|'card'|'doubles'}
//   {type:'jailStay', figure, turn}            failed roll, still inside
//   {type:'jailLeave',figure, how:'doubles'|'fee'|'pay'|'card'}
//   {type:'again',    figure, doubles}         end_turn on a live doubles run
//   {type:'turn',     order}                   end_turn that passes the turn
// ---------------------------------------------------------------------------

section('jail & doubles');

// ---------------------------------------------------------------------------
// Forced dice.
//
// `roll` reads two `random()` values and nothing else does until the landing is
// resolved, and setseed() governs the session PRNG across statements and inside
// plpgsql. So: find the seed that makes the next two draws come out as the dice
// we want, set it, and call `roll`. Every jail/doubles test below therefore
// knows BOTH dice and the exact cell the player lands on.
//
// This matters more than it looks. Rolling "any double" from an arbitrary cell
// is not a controlled experiment: on this board a double can land you on 31
// (Go To Jail) or on a Chance / Community cell whose card jails you or moves
// you to Start -- and the server then legitimately clears game.doubles,
// because your turn is over. Tests that rolled until they saw a double were
// flaky for exactly that reason, not because the rule was wrong.
// ---------------------------------------------------------------------------

const diceSeeds = new Map();

/** A seed that makes the next `roll` come out as exactly (d1, d2). */
async function seedFor(d1, d2) {
  const key = `${d1},${d2}`;
  if (diceSeeds.has(key)) return diceSeeds.get(key);
  for (let i = 1; i <= 50000; i += 1) {
    const s = i / 50000;
    await db.query('select setseed($1)', [s]);
    const r = (await db.query(
      'select floor(random()*6)::int+1 as a, floor(random()*6)::int+1 as b',
    )).rows[0];
    if (r.a === d1 && r.b === d2) {
      diceSeeds.set(key, s);
      return s;
    }
  }
  throw new Error(`no seed produces the dice ${d1},${d2}`);
}

/** Roll exactly (d1, d2). Asserts the dice actually came out that way. */
async function rollDice(room, pid, d1, d2) {
  const seed = await seedFor(d1, d2);
  await db.query('select setseed($1)', [seed]);
  const r = await call(room, 'roll', { playerId: pid });
  eq(r.game.dice, [d1, d2], `forced dice ${d1},${d2}`);
  return r;
}

// Cells that are safe to land on in these tests: unowned streets / railroads /
// utilities, so the landing charges nothing, draws no card and jails nobody.
//   from 20, a double of (1,1) -> 22    from 20, (2,3) -> 25
//   from 11, a double of (2,2) -> 15    from 11, (1,2) -> 14
// The two deliberate exceptions are 24 + (3,4) -> 31 and 25 + (3,3) -> 31,
// which is the Go To Jail cell on purpose.

const player = (r, fig) => r.players.find((p) => p.figure === fig);

await test('landing on Go To Jail (31) jails you, pays no 200$, and ends the doubles run', async () => {
  const room = await newRoom(SIX);
  // 24 + (3,4) = 31, the Go To Jail cell, on a plain non-doubles roll.
  await arrange(room, {
    players: { fig0: { position: 24, money: 1000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await rollDice(room, 'p0', 3, 4);
  eq(player(r, 'fig0').position, 11, 'moved to the Jail cell');
  eq(player(r, 'fig0').inJail, true, 'and locked up');
  eq(player(r, 'fig0').jailTurns, 0, 'no turns served yet');
  eq(money(r, 'fig0'), 1000, 'no 200$ and no other money moved');
  eq(ev(r, 'jail'), { type: 'jail', figure: 'fig0', reason: 'gtj' });
  assert(!types(r).includes('collect'), 'nothing was collected on the way');
  eq(r.game.doubles, 0, 'no doubles run');
  eq(r.game.phase, 'act', 'the turn is still theirs to end');
  eq(r.current_order, 0, 'the turn has not moved yet');

  const after = await call(room, 'end_turn', { playerId: 'p0' });
  eq(after.current_order, 1, 'end_turn passes it on');
  eq(ev(after, 'turn'), { type: 'turn', order: 1 });
});

await test('a double that lands on Go To Jail still ends the doubles run', async () => {
  const room = await newRoom(SIX);
  // 25 + (3,3) = 31: a genuine double that lands on Go To Jail.
  await arrange(room, {
    players: { fig0: { position: 25, money: 1000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 1, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await rollDice(room, 'p0', 3, 3);
  eq(ev(r, 'roll').doubles, true, 'it really was a double');
  eq((ev(r, 'jail') || {}).reason, 'gtj', 'and the cell is what jailed them');
  eq(player(r, 'fig0').inJail, true);
  eq(r.game.doubles, 0, 'being jailed cancels the run, there is no extra roll');
  const after = await call(room, 'end_turn', { playerId: 'p0' });
  eq(after.current_order, 1, 'and the turn passes on instead of coming round again');
  assert(!types(after).includes('again'), 'no "roll again"');
});

await test('doubles run: 1, then 2, and the third goes to jail without moving by that roll', async () => {
  const room = await newRoom(SIX);
  // Always 20 + (1,1) -> 22, an unowned street: the landing itself can never
  // move, charge or jail anybody, so only the doubles rule is under test.
  const setup = (doubles) => arrange(room, {
    players: { fig0: { position: 20, money: 2000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles, dice: null, auction: null, trade: null, winner: null },
  });

  // 1st double
  await setup(0);
  let r = await rollDice(room, 'p0', 1, 1);
  eq(player(r, 'fig0').position, 22, 'landed on the harmless cell we aimed at');
  eq(r.game.doubles, 1, 'game.doubles is 1 right after the 1st double');
  eq(r.game.phase, 'act');
  eq(r.current_order, 0, 'the turn does not move');
  let after = await call(room, 'end_turn', { playerId: 'p0' });
  eq(after.game.doubles, 1, 'and it survives end_turn');
  eq(after.current_order, 0, 'the same player rolls again');
  eq(ev(after, 'again'), { type: 'again', figure: 'fig0', doubles: 1 });
  assert(!types(after).includes('turn'), 'no turn event on a roll-again');

  // 2nd double, from the state end_turn just left behind
  await setup(1);
  r = await rollDice(room, 'p0', 1, 1);
  eq(r.game.doubles, 2, 'game.doubles is 2 after the 2nd');

  // 3rd double
  await setup(2);
  r = await rollDice(room, 'p0', 1, 1);
  eq(ev(r, 'jail'), { type: 'jail', figure: 'fig0', reason: 'doubles' },
    'the third double is distinguishable from every other way into jail');
  eq(player(r, 'fig0').position, 11, 'straight to Jail');
  eq(player(r, 'fig0').inJail, true);
  eq(money(r, 'fig0'), 2000, 'no money moved: the roll was never walked');
  assert(!types(r).includes('land'), 'the cell the dice pointed at is never resolved');
  eq(types(r), ['roll', 'move', 'jail'], 'exactly roll -> move-to-jail -> jail');
  eq(r.game.doubles, 0, 'the run resets');
  after = await call(room, 'end_turn', { playerId: 'p0' });
  eq(after.current_order, 1, 'and the turn passes on');
});

await test('a plain roll clears the doubles counter and passes the turn', async () => {
  const room = await newRoom(SIX);
  // 20 + (2,3) -> 25, an unowned street.
  await arrange(room, {
    players: { fig0: { position: 20, money: 2000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 2, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await rollDice(room, 'p0', 2, 3);
  eq(player(r, 'fig0').position, 25, 'landed where we aimed');
  eq(money(r, 'fig0'), 2000, 'and the landing cost nothing');
  eq(r.game.doubles, 0, 'the run is broken');
  const after = await call(room, 'end_turn', { playerId: 'p0' });
  eq(after.current_order, 1);
});

await test('in jail: doubles free you and move you, but grant no extra roll', async () => {
  const room = await newRoom(SIX);
  // 11 + (2,2) -> 15, an unowned street.
  await arrange(room, {
    players: { fig0: { position: 11, money: 2000, inJail: true, jailTurns: 1 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await rollDice(room, 'p0', 2, 2);
  eq(ev(r, 'jailLeave'), { type: 'jailLeave', figure: 'fig0', how: 'doubles' });
  eq(player(r, 'fig0').inJail, false, 'out');
  eq(player(r, 'fig0').jailTurns, 0, 'counter cleared');
  eq(player(r, 'fig0').position, 15, 'and moved by that roll');
  eq(money(r, 'fig0'), 2000, 'the cell they reached cost nothing');
  assert(types(r).includes('land'), 'the cell they reached is resolved normally');
  eq(r.game.doubles, 0, 'leaving jail on doubles does NOT grant another roll');
  const after = await call(room, 'end_turn', { playerId: 'p0' });
  eq(after.current_order, 1, 'the turn passes on');
});

await test('in jail: a failed roll keeps you in and ends the turn', async () => {
  const room = await newRoom(SIX);
  await arrange(room, {
    players: { fig0: { position: 11, money: 2000, inJail: true, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await rollDice(room, 'p0', 1, 2);
  eq(ev(r, 'jailStay'), { type: 'jailStay', figure: 'fig0', turn: 1 });
  eq(player(r, 'fig0').inJail, true, 'still inside');
  eq(player(r, 'fig0').jailTurns, 1, 'one turn served');
  eq(player(r, 'fig0').position, 11, 'did not move');
  eq(money(r, 'fig0'), 2000, 'and paid nothing');
  assert(!types(r).includes('move'), 'no move event');
  eq(r.game.phase, 'act', 'they still have to end the turn');
  const after = await call(room, 'end_turn', { playerId: 'p0' });
  eq(after.current_order, 1);
});

await test('in jail: the third failed roll takes the 50$ fine and moves you anyway', async () => {
  const room = await newRoom(SIX);
  await arrange(room, {
    players: { fig0: { position: 11, money: 2000, inJail: true, jailTurns: 2 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  // 11 + (1,2) -> 14, an unowned street.
  const r = await rollDice(room, 'p0', 1, 2);
  eq(ev(r, 'pay'), {
    type: 'pay', figure: 'fig0', to: null, amount: 50, reason: 'jailFee', cell: null,
  }, 'the fine goes to the bank');
  eq(ev(r, 'jailLeave'), { type: 'jailLeave', figure: 'fig0', how: 'fee' });
  eq(player(r, 'fig0').inJail, false);
  eq(player(r, 'fig0').jailTurns, 0);
  eq(player(r, 'fig0').position, 14, 'moved by the failed roll');
  eq(money(r, 'fig0'), 1950, 'the fine and nothing else');
});

await test('in jail: the forced fine can bankrupt you (to the bank)', async () => {
  const room = await newRoom(SIX);
  await arrange(room, {
    owners: { 6: 'fig0' },
    players: { fig0: { position: 11, money: 40, inJail: true, jailTurns: 2, jailCards: 1 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  // the fine is charged before the move, so the target cell never matters
  const r = await rollDice(room, 'p0', 1, 2);
  eq(ev(r, 'bankrupt'), {
    type: 'bankrupt', figure: 'fig0', to: null, reason: 'jailFee', amount: 50,
  }, 'the bank takes everything');
  eq(player(r, 'fig0').bankrupt, true);
  eq(player(r, 'fig0').money, 0);
  eq(player(r, 'fig0').inJail, false, 'bankruptcy also lets them out');
  eq(player(r, 'fig0').jailCards, 0, 'and eats the jail card');
  eq(owner(r, 6), null, 'their property went back to the bank');
  assert(!types(r).includes('jailLeave'), 'no jailLeave: they never got out on their own');
  eq(r.current_order, 1, 'a bankrupt player cannot finish their turn');
});

await test('pay_jail: 50$ buys the way out and you may then roll', async () => {
  const room = await newRoom(SIX);
  await arrange(room, {
    players: { fig0: { position: 11, money: 500, inJail: true, jailTurns: 1 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await call(room, 'pay_jail', { playerId: 'p0' });
  eq(money(r, 'fig0'), 450);
  eq(player(r, 'fig0').inJail, false);
  eq(player(r, 'fig0').jailTurns, 0);
  eq(ev(r, 'pay'), {
    type: 'pay', figure: 'fig0', to: null, amount: 50, reason: 'jailFee',
  });
  eq(ev(r, 'jailLeave'), { type: 'jailLeave', figure: 'fig0', how: 'pay' });
  eq(r.game.phase, 'roll', 'they still have their roll');
  const after = await rollDice(room, 'p0', 1, 2); // 11 -> 14, unowned
  eq(after.game.phase, 'act', 'and it went through');
  eq(player(after, 'fig0').position, 14, 'and they moved normally');
});

await test('pay_jail guards: not in jail, not your turn, already rolled, too poor', async () => {
  const room = await newRoom(SIX);
  await arrange(room, {
    players: { fig0: { position: 11, money: 40, inJail: true, jailTurns: 1 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  await rejects(room, 'pay_jail', { playerId: 'p0' }, 'Not enough money');
  await rejects(room, 'pay_jail', { playerId: 'p1' }, 'Not your turn');

  await arrange(room, { players: { fig0: { money: 500 } }, game: { phase: 'act' } });
  await rejects(room, 'pay_jail', { playerId: 'p0' }, 'You already rolled');

  await arrange(room, {
    players: { fig0: { inJail: false, jailTurns: 0 } },
    game: { phase: 'roll' },
  });
  await rejects(room, 'pay_jail', { playerId: 'p0' }, 'You are not in jail');
});

await test('use_jail_card: spends one card, frees you, and is refused at zero', async () => {
  const room = await newRoom(SIX);
  await arrange(room, {
    players: { fig0: { position: 11, money: 500, inJail: true, jailTurns: 2, jailCards: 2 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await call(room, 'use_jail_card', { playerId: 'p0' });
  eq(player(r, 'fig0').jailCards, 1, 'one card spent, the other kept');
  eq(player(r, 'fig0').inJail, false);
  eq(player(r, 'fig0').jailTurns, 0);
  eq(money(r, 'fig0'), 500, 'the card is free');
  eq(ev(r, 'jailLeave'), { type: 'jailLeave', figure: 'fig0', how: 'card' });
  eq(r.game.phase, 'roll', 'they still have their roll');

  await arrange(room, {
    players: { fig0: { position: 11, inJail: true, jailTurns: 1, jailCards: 0 } },
    game: { phase: 'roll' },
  });
  await rejects(room, 'use_jail_card', { playerId: 'p0' },
    'You have no Get Out Of Jail Free card');
  await rejects(room, 'use_jail_card', { playerId: 'p1' }, 'Not your turn');
});

await test('both decks carry Get Out Of Jail Free and Go To Jail', async () => {
  const board = JSON.stringify(SEED_BOARD);
  for (const deck of ['chance', 'community']) {
    const cards = (await db.query(
      `select public.mono_deck($1, $2::jsonb) as d`, [deck, board],
    )).rows[0].d;
    const kinds = cards.map((c) => c.kind);
    assert(kinds.includes('jailCard'), `${deck} has no Get Out Of Jail Free card`);
    assert(kinds.includes('goJail'), `${deck} has no Go To Jail card`);
  }
});

await test('the jailCard card increments the holder, and two players can hold one at once', async () => {
  const room = await newRoom(SIX);
  const board = JSON.stringify(SEED_BOARD);
  const cards = (await db.query(
    `select public.mono_deck('chance', $1::jsonb) as d`, [board],
  )).rows[0].d;
  const card = cards.find((c) => c.kind === 'jailCard');

  // mono_apply_card is the deck's own handler; drive it directly so the test
  // does not depend on landing on a Chance cell twice.
  for (const [fig, idx] of [['fig0', 0], ['fig4', 4]]) {
    const before = await row(room);
    const st = JSON.stringify({
      players: before.players, board: before.position, game: {}, events: [],
    });
    const out = (await db.query(
      `select public.mono_apply_card($1::jsonb, $2, $3::jsonb, 7) as st`,
      [st, idx, JSON.stringify(card)],
    )).rows[0].st;
    eq(out.players[idx].jailCards, 1, `${fig} picked a card up`);
    await db.query(
      `update public.test set "Players" = $2::jsonb where uuid = $1`,
      [room, JSON.stringify(out.players)],
    );
  }
  const both = await row(room);
  eq(both.players.filter((p) => p.jailCards > 0).map((p) => p.figure), ['fig0', 'fig4'],
    'the deck is drawn with replacement, so two holders at once is legal');

  // and both can spend theirs
  for (const pid of ['p0', 'p4']) {
    const fig = `fig${pid.slice(1)}`;
    await arrange(room, {
      players: { [fig]: { position: 11, inJail: true, jailTurns: 1 } },
      current_order: Number(pid.slice(1)),
      game: { phase: 'roll', doubles: 0, auction: null, trade: null, winner: null },
    });
    const r = await call(room, 'use_jail_card', { playerId: pid });
    eq(player(r, fig).jailCards, 0, `${fig} spent theirs`);
    eq(player(r, fig).inJail, false);
  }
});

await test('new_game clears every jail card and every jail state', async () => {
  const room = await newRoom(SIX);
  await arrange(room, {
    players: {
      fig0: { jailCards: 2, inJail: true, jailTurns: 2, position: 11 },
      fig5: { jailCards: 1 },
    },
  });
  const r = await call(room, 'new_game', { position: legacyBoard() });
  for (const p of r.players) {
    eq(p.jailCards, 0, `${p.figure} jailCards`);
    eq(p.inJail, false, `${p.figure} inJail`);
    eq(p.jailTurns, 0, `${p.figure} jailTurns`);
  }
  eq(r.game.doubles, 0, 'and the doubles run');
});

await test('a jailed player still collects rent, bids in an auction and answers a trade', async () => {
  const room = await newRoom(SIX);
  // fig3 is locked up and owns 12/14/15 (the salmon set)
  await arrange(room, {
    owners: { 12: 'fig3', 14: 'fig3', 15: 'fig3' },
    players: {
      fig3: { position: 11, inJail: true, jailTurns: 1, money: 1000 },
      fig0: { position: 1, money: 900 },
    },
    current_order: 0,
    game: { phase: 'act', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  let r = await call(room, 'move', { playerId: 'p0', to: 12 });
  eq(money(r, 'fig3'), 1028, 'rent reaches a jailed owner');
  eq(player(r, 'fig3').inJail, true, 'and does not let them out');

  // an auction started by fig0 puts the jailed fig3 in the rotation
  await arrange(room, {
    players: { fig0: { position: 27 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null },
  });
  r = await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  assert(r.game.auction.in.includes('fig3'), 'a jailed player is still a bidder');
  await call(room, 'auction_bid', { playerId: 'p1', amount: 10 });
  await call(room, 'auction_bid', { playerId: 'p2', amount: 20 });
  r = await call(room, 'auction_bid', { playerId: 'p3', amount: 30 });
  eq(r.game.auction.leader, 'fig3', 'a jailed player can bid');
  for (const pid of ['p4', 'p5', 'p0', 'p1', 'p2']) {
    r = await call(room, 'auction_drop', { playerId: pid });
  }
  eq(owner(r, 27), 'fig3', 'and can win');

  // and answer a trade
  await arrange(room, {
    current_order: 0,
    players: { fig0: { position: 1, money: 900 } },
    game: { phase: 'roll', doubles: 0, auction: null, trade: null, winner: null },
  });
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig3', give: { cells: [], cash: 100 }, get: { cells: [27], cash: 0 },
  });
  r = await call(room, 'trade_accept', { playerId: 'p3' });
  eq(owner(r, 27), 'fig0', 'a jailed player can accept a trade');
  eq(player(r, 'fig3').inJail, true, 'still jailed afterwards');
});

// ---------------------------------------------------------------------------
// 5. Railroads and utilities
//
// From a bug report after real play: "I cannot buy the second Railroad."
// Railroads are cells 6/16/26/36 and utilities 13/28; all six carry colour
// "#000", which is also the colour of Start, Tax, Jail, Chance and Community
// Chest. Anything that identified a property by its COLOUR or GROUP instead
// of its cell id would therefore treat the second railroad as already
// yours/owned. These tests pin the server down on that: every landing below
// is a real forced roll, not the debug `move`.
//
// The defect turned out to be on the phone (ClientScreen's buy/build offer
// was derived from a live `land` event, so a reloaded phone never saw it).
// These stay as the record that the SERVER was, and remains, right.
// ---------------------------------------------------------------------------

section('railroads & utilities');

const RAILS = [6, 16, 26, 36];
const UTILS = [13, 28];

/** mono_rent for one cell, straight out of the stored board. */
async function rentOf(room, cell, diceSum = 7) {
  const res = await db.query(
    `select public.mono_rent(position, $2, $3) as rent from public.test where uuid = $1`,
    [room, String(cell), diceSum],
  );
  return res.rows[0].rent;
}

/**
 * fig0 already owns `owned`, stands on `from`, rolls (d1,d2) onto `to` and
 * buys it. Returns the row after the purchase.
 */
async function landAndBuy(room, { from, to, dice, owned = [] }) {
  const owners = {};
  for (const c of owned) owners[c] = 'fig0';
  await arrange(room, {
    owners,
    players: { fig0: { position: from, money: 2000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const landed = await rollDice(room, 'p0', dice[0], dice[1]);
  eq(player(landed, 'fig0').position, to, `landed on ${to}`);
  eq(money(landed, 'fig0'), 2000, 'an unowned space charges nothing on landing');
  eq(owner(landed, to), null, 'and nobody owns it yet');
  eq(landed.game.phase, 'act', 'the turn is still theirs to act on');
  eq(landed.game.auction, null, 'no auction was started for them');
  eq(types(landed), ['roll', 'move', 'land'], 'roll -> move -> land, nothing else');
  return call(room, 'buy', { playerId: 'p0', cell: String(to) });
}

await test('the 2nd, 3rd and 4th railroad can each be bought after a real roll', async () => {
  const room = await newRoom();
  // 1 -> 6, then 6 -> 16 -> 26 -> 36 ten steps at a time, keeping everything
  // bought so far. No roll here crosses Start, so the 200$ never muddies the
  // "the landing itself cost nothing" assertion.
  let r = await landAndBuy(room, { from: 1, to: 6, dice: [2, 3], owned: [] });
  eq(owner(r, 6), 'fig0', 'first railroad bought');
  eq(money(r, 'fig0'), 1800);

  r = await landAndBuy(room, { from: 6, to: 16, dice: [4, 6], owned: [6] });
  eq(owner(r, 16), 'fig0', 'SECOND railroad bought while already holding one');
  eq(money(r, 'fig0'), 1800);

  r = await landAndBuy(room, { from: 16, to: 26, dice: [4, 6], owned: [6, 16] });
  eq(owner(r, 26), 'fig0', 'third railroad bought');

  r = await landAndBuy(room, { from: 26, to: 36, dice: [4, 6], owned: [6, 16, 26] });
  eq(owner(r, 36), 'fig0', 'fourth railroad bought');
});

await test('landing on an unowned railroad while somebody else owns another is still a free space', async () => {
  const room = await newRoom();
  // fig1 owns 6; fig0 owns nothing and lands on 26.
  await arrange(room, {
    owners: { 6: 'fig1' },
    players: { fig0: { position: 16, money: 2000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const landed = await rollDice(room, 'p0', 4, 6); // 16 -> 26
  eq(player(landed, 'fig0').position, 26);
  eq(money(landed, 'fig0'), 2000, 'another player owning a DIFFERENT railroad charges nothing');
  eq(money(landed, 'fig1'), 2500, 'and pays nobody');
  const r = await call(room, 'buy', { playerId: 'p0', cell: '26' });
  eq(owner(r, 26), 'fig0');
  eq(owner(r, 6), 'fig1', 'the other owner keeps theirs');
});

await test('the second utility can be bought after a real roll, both ways round', async () => {
  let room = await newRoom();
  let r = await landAndBuy(room, { from: 23, to: 28, dice: [2, 3], owned: [13] });
  eq(owner(r, 28), 'fig0', 'SECOND utility bought while already holding 13');
  eq(money(r, 'fig0'), 1850);
  eq(owner(r, 13), 'fig0', '13 is untouched');

  room = await newRoom();
  r = await landAndBuy(room, { from: 8, to: 13, dice: [2, 3], owned: [28] });
  eq(owner(r, 13), 'fig0', 'and the other way round');
  eq(money(r, 'fig0'), 1850);
});

await test('buy is refused for the right reasons, not for owning a sibling railroad', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { 6: 'fig0', 26: 'fig1' },
    players: { fig0: { position: 16, money: 150 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null },
  });
  await rejects(room, 'buy', { playerId: 'p0', cell: '16' }, 'Not enough money');
  await rejects(room, 'buy', { playerId: 'p0', cell: '36' }, 'You are not standing on that cell');

  await arrange(room, { players: { fig0: { money: 2000, position: 26 } } });
  await rejects(room, 'buy', { playerId: 'p0', cell: '26' }, 'Already owned');

  await arrange(room, { players: { fig0: { position: 11 } } });
  await rejects(room, 'buy', { playerId: 'p0', cell: '11' }, 'This cell is not for sale');
});

await test('railroad rent is 25/50/100/200 by CELLS owned, and follows a trade', async () => {
  const room = await newRoom();
  const expect = [25, 50, 100, 200];
  for (let n = 1; n <= 4; n += 1) {
    const owners = {};
    for (const c of RAILS.slice(0, n)) owners[c] = 'fig0';
    await arrange(room, { owners });
    for (const c of RAILS.slice(0, n)) {
      eq(await rentOf(room, c), expect[n - 1], `${n} railroad(s): cell ${c}`);
    }
  }
  // Trading one away drops the other three to the 3-railroad rate and gives
  // the receiver the 1-railroad rate -- ownership is per cell, not per group.
  await arrange(room, {
    owners: { 6: 'fig0', 16: 'fig0', 26: 'fig0', 36: 'fig0' },
    players: { fig0: { position: 20, money: 2000 }, fig3: { money: 2000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null },
  });
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig3', give: { cells: [36], cash: 0 }, get: { cells: [], cash: 100 },
  });
  const r = await call(room, 'trade_accept', { playerId: 'p3' });
  eq(owner(r, 36), 'fig3', 'a railroad is tradable on its own');
  eq(await rentOf(room, 6), 100, 'the seller is down to three');
  eq(await rentOf(room, 36), 25, 'the buyer has one');
});

await test('utility rent is 4x / 10x by CELLS owned', async () => {
  const room = await newRoom();
  await arrange(room, { owners: { 13: 'fig0', 28: null } });
  eq(await rentOf(room, 13, 9), 36, 'one utility: 4 x dice');
  await arrange(room, { owners: { 13: 'fig0', 28: 'fig0' } });
  eq(await rentOf(room, 13, 9), 90, 'both utilities: 10 x dice');
  eq(await rentOf(room, 28, 9), 90);
  await arrange(room, { owners: { 13: 'fig0', 28: 'fig1' } });
  eq(await rentOf(room, 13, 9), 36, 'split ownership is 4x for each of them');
  eq(await rentOf(room, 28, 9), 36);
});

await test('a real landing pays railroad rent for the owner’s count, not the colour', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { 6: 'fig1', 26: 'fig1' },
    players: { fig0: { position: 16, money: 2000 }, fig1: { money: 2000 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await rollDice(room, 'p0', 4, 6); // 16 -> 26, owned by fig1 who holds two
  eq(money(r, 'fig0'), 1950, 'paid 50, the two-railroad rate');
  eq(money(r, 'fig1'), 2050);
  eq(ev(r, 'pay'), {
    type: 'pay', figure: 'fig0', to: 'fig1', amount: 50, reason: 'rent', cell: 26,
  });
});

await test('a railroad goes through an auction like any other space', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 36, { owners: { 6: 'fig0', 16: 'fig0' } });
  await call(room, 'auction_start', { playerId: 'p0', cell: 36 });
  await call(room, 'auction_bid', { playerId: 'p1', amount: 120 });
  await call(room, 'auction_drop', { playerId: 'p2' });
  await call(room, 'auction_drop', { playerId: 'p3' });
  const r = await call(room, 'auction_drop', { playerId: 'p0' });
  eq(owner(r, 36), 'fig1', 'the bidder won it');
  eq(await rentOf(room, 6), 50, 'the starter still has exactly two');
  eq(await rentOf(room, 36), 25, 'the winner has one');
});

await test('bankruptcy hands every railroad and utility over as individual cells', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { 6: 'fig0', 16: 'fig0', 26: 'fig0', 13: 'fig0', 36: 'fig1', 28: 'fig1' },
    // 26 + (4,6) = 36, which fig1 owns: the rent is what bankrupts fig0.
    players: { fig0: { position: 26, money: 10 }, fig1: { position: 20, money: 2000 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await rollDice(room, 'p0', 4, 6);
  eq(player(r, 'fig0').bankrupt, true, 'could not pay the rent');
  for (const c of [...RAILS, ...UTILS]) {
    eq(owner(r, c), 'fig1', `cell ${c} went to the creditor`);
  }
  eq(await rentOf(room, 6), 200, 'the creditor now holds all four railroads');
  eq(await rentOf(room, 13, 9), 90, 'and both utilities');
});

// ---------------------------------------------------------------------------
// 6. "Advance to the nearest railroad / utility" -- Chance c5 and c4
//
// This is the one card that relocates a player and then resolves a landing
// WITHOUT a roll of its own, and until now it was the only branch of
// mono_apply_card with no test at all. It had been read, never executed. The
// bug that started this whole work item was a lost-track-of-position bug, so
// "the server moves you somewhere you did not roll to" is exactly the shape of
// thing that deserves to be pinned down rather than trusted.
//
// What the SQL actually says (20260918140000_game_rules.sql):
//
//   * mono_deck line 450 / 452 -- c4 is {kind:'nearest', what:'communal'} and
//     c5 is {kind:'nearest', what:'road'}; 0-based indices 3 and 4 of the
//     15-card Chance deck.
//   * mono_apply_card lines 553-566 -- the target is the LOWEST cell of that
//     kind strictly above the player's current cell:
//         where mono_cell_kind(cell) = card->>'what' and key::integer > pos
//         order by key::integer limit 1
//     and when nothing is above `pos` it falls back to mono_cell_of_kind
//     (line 146: the lowest cell of that kind on the whole board), which is
//     what makes the move wrap. Chance is 8 / 23 / 37; railroads 6 / 16 / 26 /
//     36; utilities 13 / 28. So 37 is the only Chance cell that wraps, and it
//     wraps for BOTH kinds -- to railroad 6 and to utility 13.
//   * mono_move_to is called with collect_go = true (line 564), and line 407
//     pays the 200$ when `new_pos <= old_pos`. The wrap therefore collects and
//     the two forward moves do not.
//   * mono_land is called with road_mult = 2 and util_mult = 10 (line 565),
//     unconditionally for both cards -- which is harmless, because mono_rent
//     only consults road_mult on a 'road' cell (line 251) and util_mult on a
//     'communal' one (line 258), and the card can only ever land you on the
//     kind it asked for.
//   * The two multipliers are NOT the same kind of thing, and this is the trap:
//         road:     (25 << greatest(cnt - 1, 0)) * coalesce(road_mult, 1)
//         communal: coalesce(dice_sum, 7) * coalesce(util_mult, <4 or 10>)
//     road_mult MULTIPLIES the count-based rate (50 / 100 / 200 / 400 for
//     1 / 2 / 3 / 4 railroads), while util_mult sits INSIDE the coalesce and
//     REPLACES the ordinary 4x-or-10x choice. A single-utility owner therefore
//     charges 10 x dice, not 4 x 10 x dice. Both tests below assert the plain
//     mono_rent for the same board alongside the rent the card actually
//     charged, so the two readings cannot be confused: the railroad case must
//     come out at exactly twice the plain rate, the utility case at exactly
//     2.5 times it (10x against 4x) rather than ten times it.
//   * The dice are NOT thrown again. mono_land passes its own dice_sum into
//     mono_apply_card (line 678) and the nearest branch passes the same value
//     straight back into mono_land (line 565), so the utility rent is ten
//     times the sum that carried you onto the Chance square. (Official
//     Monopoly has you re-throw; the migration header, line 48, records the
//     simplification on purpose. Flagged, not fixed -- migrations are not ours
//     to touch.)
//
// Method, deliberately the same as section 5: every landing here is a REAL
// forced roll. The one addition is that the CARD is forced too, by extending
// the seed search from two random() draws to three -- `roll` takes two for the
// dice and mono_draw takes the third, and nothing else consumes the session
// PRNG in between. Hand-building a state and calling mono_apply_card directly
// would test the branch in isolation and pass while the path a phone actually
// walks was broken, which is precisely the failure mode that produced Bug A.
// ---------------------------------------------------------------------------

section('nearest railroad / utility card');

/** The real Chance deck, so the card ids below are the server's, not ours. */
const CHANCE = (await db.query(
  `select public.mono_deck('chance', $1::jsonb) as d`, [JSON.stringify(SEED_BOARD)],
)).rows[0].d;

const NEAREST_CARD = { road: 'c5', communal: 'c4' };
const CHANCE_CELLS = [8, 23, 37];

/**
 * Where each Chance cell is reached from, and with what dice. Chosen so that
 * the ROLL never crosses Start -- otherwise the 200$ of a wrap on the roll and
 * the 200$ of a wrap on the card would be indistinguishable in the money.
 * The cell rolled FROM is never resolved (only the destination is), so it does
 * not matter what kind of square it is.
 */
const APPROACH = {
  8:  { from: 1,  dice: [3, 4] }, // Start + 7
  23: { from: 14, dice: [4, 5] }, // 14 + 9
  37: { from: 30, dice: [3, 4] }, // 30 + 7
};

// ---------------------------------------------------------------------------
// Forced dice AND a forced card, from one seed.
//
// seedFor() above finds a seed whose first two random() draws are the dice we
// want. A landing on Chance takes a third draw, in mono_draw, to pick the card:
// floor(random() * 15). So the seed we need has to satisfy all three at once.
//
// Searching each (d1, d2, card) triple separately would mean rescanning the
// same seeds over and over, so the scan is incremental and shared: it walks
// i/200000 upwards, remembers the FIRST seed it sees for every triple it
// passes, and stops as soon as the triple being asked for is in the map. Every
// later request is either already cached or resumes from where the last one
// stopped. All 540 triples exist inside this range; the ones these tests want
// all turn up below i = 600, so the whole section costs a few hundred probes.
//
// Nothing here is trusted: rollForCard asserts both the dice and the drawn card
// id, so if the PRNG, the deck order or the number of draws ever changes, these
// tests say so instead of quietly testing some other card.
// ---------------------------------------------------------------------------

const CARD_GRAIN = 200000;
const cardSeeds = new Map();
let cardScan = 0;

/** A seed that rolls (d1, d2) and then draws Chance card index `idx`. */
async function seedForRollAndCard(d1, d2, idx) {
  const key = `${d1},${d2},${idx}`;
  while (!cardSeeds.has(key) && cardScan < CARD_GRAIN) {
    cardScan += 1;
    const s = cardScan / CARD_GRAIN;
    await db.query('select setseed($1)', [s]);
    const r = (await db.query(
      `select floor(random() * 6)::int + 1 as a,
              floor(random() * 6)::int + 1 as b,
              floor(random() * ${CHANCE.length})::int as c`,
    )).rows[0];
    const seen = `${r.a},${r.b},${r.c}`;
    if (!cardSeeds.has(seen)) cardSeeds.set(seen, s);
  }
  if (!cardSeeds.has(key)) {
    throw new Error(`no seed rolls ${d1},${d2} and then draws chance card ${idx}`);
  }
  return cardSeeds.get(key);
}

/** Roll exactly (d1, d2) and have the landing draw exactly `cardId`. */
async function rollForCard(room, pid, d1, d2, cardId) {
  const idx = CHANCE.findIndex((c) => c.id === cardId);
  assert(idx >= 0, `the chance deck no longer has a card ${cardId}`);
  await db.query('select setseed($1)', [await seedForRollAndCard(d1, d2, idx)]);
  const r = await call(room, 'roll', { playerId: pid });
  eq(r.game.dice, [d1, d2], `forced dice ${d1},${d2}`);
  eq((ev(r, 'card') || {}).id, cardId, `forced chance card ${cardId}`);
  return r;
}

/** Every event of a type, in order -- the branch emits `move` and `land` twice. */
const allEv = (r, type) => (r.game.events || []).filter((e) => e.type === type);
const lands = (r) => allEv(r, 'land');

/**
 * fig0 stands on the approach cell with `cash`, rolls onto Chance `chance`, and
 * the card for `kind` ('road' | 'communal') comes out of the deck. fig1..fig3
 * are pinned at 2000$ so any rent that moves is unambiguous. Returns the row
 * that the single `roll` action produced -- one action, one seq, every event of
 * the card included.
 */
async function nearestRoll(room, { chance, kind, owners = {}, cash = 2000, from, dice }) {
  const a = APPROACH[chance];
  await arrange(room, {
    owners,
    players: {
      fig0: { position: from ?? a.from, money: cash, inJail: false, jailTurns: 0 },
      fig1: { money: 2000 }, fig2: { money: 2000 }, fig3: { money: 2000 },
    },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const d = dice ?? a.dice;
  const r = await rollForCard(room, 'p0', d[0], d[1], NEAREST_CARD[kind]);
  eq(lands(r)[0], { type: 'land', figure: 'fig0', cell: chance, kind: 'chance' },
    `the roll itself had to land on Chance ${chance}`);
  return r;
}

await test('the Chance deck carries exactly the two nearest cards these tests force', async () => {
  const near = CHANCE.filter((c) => c.kind === 'nearest');
  eq(near.map((c) => [c.id, c.what]), [['c4', 'communal'], ['c5', 'road']],
    'two nearest cards, one per kind, in deck order');
  // The numbers the tests below assert are the numbers the cards promise the
  // player, so tie the two together here rather than leaving them as folklore.
  assert(/10 times your dice/.test(near[0].text), `utility card text: ${near[0].text}`);
  assert(/double rent/.test(near[1].text), `railroad card text: ${near[1].text}`);
  // Both `what` values have to be kinds mono_cell_kind can actually produce,
  // or the search would silently find nothing and the card would do nothing.
  for (const c of near) {
    const hits = Object.keys(SEED_BOARD).filter((k) => {
      const cell = SEED_BOARD[k];
      return c.what === 'road' ? cell.road === true : cell.communal === true;
    });
    assert(hits.length > 0, `no cell on the board is of kind ${c.what}`);
  }
});

await test('nearest railroad: 8 -> 16, 23 -> 26, and 37 wraps round to 6', async () => {
  for (const [chance, target] of [[8, 16], [23, 26], [37, 6]]) {
    const room = await newRoom();
    const r = await nearestRoll(room, { chance, kind: 'road' });
    eq(player(r, 'fig0').position, target, `from Chance ${chance} the nearest railroad is ${target}`);
    eq(lands(r)[1], { type: 'land', figure: 'fig0', cell: target, kind: 'road' },
      'the card resolved a second landing, on the railroad');
    eq(owner(r, target), null, 'nobody owned it, so nothing was charged');
    eq(r.position[String(target)].fig0, true, 'the token really is on the railroad');
    eq(r.position[String(chance)].fig0, false, 'and no longer on the Chance square');
  }
});

await test('nearest utility: 8 -> 13, 23 -> 28, and 37 wraps round to 13', async () => {
  for (const [chance, target] of [[8, 13], [23, 28], [37, 13]]) {
    const room = await newRoom();
    const r = await nearestRoll(room, { chance, kind: 'communal' });
    eq(player(r, 'fig0').position, target, `from Chance ${chance} the nearest utility is ${target}`);
    eq(lands(r)[1], { type: 'land', figure: 'fig0', cell: target, kind: 'communal' },
      'the card resolved a second landing, on the utility');
    eq(owner(r, target), null, 'nobody owned it, so nothing was charged');
    eq(r.position[String(target)].fig0, true, 'the token really is on the utility');
    eq(r.position[String(chance)].fig0, false, 'and no longer on the Chance square');
  }
});

await test('only the wrap from 37 collects the 200$; the forward moves collect nothing', async () => {
  for (const kind of ['road', 'communal']) {
    for (const chance of CHANCE_CELLS) {
      const room = await newRoom();
      const r = await nearestRoll(room, { chance, kind });
      if (chance === 37) {
        eq(money(r, 'fig0'), 2200, `${kind} from 37: the card walked backwards past Start`);
        eq(ev(r, 'collect'),
          { type: 'collect', figure: 'fig0', amount: 200, reason: 'passGo' },
          'and mono_move_to paid the bonus, with the reason the UI keys on');
        eq(types(r), ['roll', 'move', 'land', 'card', 'move', 'collect', 'land'],
          'the collect sits between the second move and the second landing');
      } else {
        eq(money(r, 'fig0'), 2000, `${kind} from ${chance}: a forward move, nothing collected`);
        assert(!types(r).includes('collect'),
          `${kind} from ${chance}: there must be no collect event at all`);
        eq(types(r), ['roll', 'move', 'land', 'card', 'move', 'land']);
      }
    }
  }
});

await test('nearest railroad DOUBLES the count-based rate: 50 / 100 / 200 / 400', async () => {
  // From Chance 23 the card always picks 26, whatever else the owner holds, so
  // the only thing changing between the four rounds is the count.
  const order = [26, 6, 16, 36];
  const expect = [50, 100, 200, 400];
  for (let cnt = 1; cnt <= 4; cnt += 1) {
    const room = await newRoom();
    const owners = {};
    for (const c of order.slice(0, cnt)) owners[c] = 'fig1';
    const r = await nearestRoll(room, { chance: 23, kind: 'road', owners });
    eq(player(r, 'fig0').position, 26, 'the target does not depend on who owns what');
    eq(ev(r, 'pay'), {
      type: 'pay', figure: 'fig0', to: 'fig1', amount: expect[cnt - 1], reason: 'rent', cell: 26,
    }, `${cnt} railroad(s) owned`);
    eq(money(r, 'fig0'), 2000 - expect[cnt - 1]);
    eq(money(r, 'fig1'), 2000 + expect[cnt - 1], 'and it reached the owner');
    // The discriminating assertion: road_mult multiplies, so the card's rent is
    // exactly twice what standing on the same cell after a normal roll costs.
    eq(await rentOf(room, 26), expect[cnt - 1] / 2,
      `the plain ${cnt}-railroad rate is half the doubled one`);
  }
});

await test('nearest utility is 10x the dice already rolled -- not 4 x 10, and not re-thrown', async () => {
  // Three different rolled sums, three different rents. The rent tracking the
  // sum is what proves the dice are reused rather than thrown a second time:
  // a re-throw would have no reason to agree with game.dice three times over.
  const cases = [
    { chance: 8,  target: 13, dice: [3, 4], sum: 7 },
    { chance: 8,  target: 13, dice: [1, 4], sum: 5, from: 3 }, // 3 + 5 = 8 as well
    { chance: 23, target: 28, dice: [4, 5], sum: 9 },
  ];
  for (const c of cases) {
    const room = await newRoom();
    const r = await nearestRoll(room, {
      chance: c.chance, kind: 'communal', owners: { [c.target]: 'fig1' },
      from: c.from, dice: c.dice,
    });
    eq(r.game.dice, c.dice, 'the row still records the dice that were rolled');
    eq(ev(r, 'pay'), {
      type: 'pay', figure: 'fig0', to: 'fig1', amount: c.sum * 10, reason: 'rent', cell: c.target,
    }, `dice ${c.dice.join('+')} = ${c.sum}, so the rent is ${c.sum * 10}`);
    eq(money(r, 'fig0'), 2000 - c.sum * 10);
    eq(money(r, 'fig1'), 2000 + c.sum * 10);
    // util_mult sits inside a coalesce, so it REPLACES the 4x a single-utility
    // owner would otherwise get. If it multiplied instead, this rent would be
    // c.sum * 40 and the assertion above would already have failed -- this line
    // is here to say out loud what the plain rate for the same board is.
    eq(await rentOf(room, c.target, c.sum), c.sum * 4,
      'one utility rents at 4x normally, so the card charged 10x, not 40x');
  }

  // The owner holding BOTH utilities is the case that cannot tell the two
  // readings apart -- the ordinary rate is already 10x -- so it is here as the
  // control rather than as the evidence.
  const room = await newRoom();
  const r = await nearestRoll(room, {
    chance: 8, kind: 'communal', owners: { 13: 'fig1', 28: 'fig1' },
  });
  eq(ev(r, 'pay').amount, 70, 'both utilities: 10 x 7, the same as the card forces');
  eq(await rentOf(room, 13, 7), 70, 'and the plain rate agrees, so nothing is doubled twice');
});

await test('the nearest cell being your own charges nothing', async () => {
  for (const [kind, chance, target] of [['road', 23, 26], ['communal', 8, 13]]) {
    const room = await newRoom();
    const r = await nearestRoll(room, { chance, kind, owners: { [target]: 'fig0' } });
    eq(player(r, 'fig0').position, target, `the card still moved them to ${target}`);
    eq(money(r, 'fig0'), 2000, 'you do not pay yourself, doubled or otherwise');
    eq(types(r), ['roll', 'move', 'land', 'card', 'move', 'land'],
      'and there is no pay event at all');
    eq(owner(r, target), 'fig0', 'still theirs afterwards');
  }
});

await test('an unowned nearest cell is left buyable at its ordinary price', async () => {
  // The card is the only way onto a property without a roll that reaches it, so
  // this is the one place where "can I still buy what I was put on?" is a real
  // question rather than a restatement of section 5.
  for (const [kind, chance, target, price] of [['road', 23, 26, 200], ['communal', 8, 13, 150]]) {
    const room = await newRoom();
    const r = await nearestRoll(room, { chance, kind });
    eq(owner(r, target), null, 'the landing left it unowned');
    eq(r.game.phase, 'act', 'and did not end the turn');
    eq(r.game.auction, null, 'no auction was started for them');
    const b = await call(room, 'buy', { playerId: 'p0', cell: String(target) });
    eq(owner(b, target), 'fig0', `bought ${target} from where the card put them`);
    eq(money(b, 'fig0'), 2000 - price, `paid the ordinary ${price}$`);
    eq(ev(b, 'buy'), { type: 'buy', figure: 'fig0', cell: target, amount: price });
    eq(b.game.seq, r.game.seq + 1, 'the buy is its own action with its own seq');
    eq(b.position[String(target)].fig0, true, 'and they are still standing on it');
  }
});

await test('a nearest rent you cannot cover bankrupts you to the owner, with no partial payment', async () => {
  const ALL_RAILS = { 6: 'fig1', 16: 'fig1', 26: 'fig1', 36: 'fig1' };

  // 400$ owed with 399$ in hand. mono_charge (line 368) compares `money <
  // amount` and hands the whole thing to mono_bankrupt: no debt is recorded, no
  // part of the 400 is paid, and the creditor gets the cash that WAS there.
  let room = await newRoom();
  let r = await nearestRoll(room, { chance: 23, kind: 'road', owners: ALL_RAILS, cash: 399 });
  eq(ev(r, 'bankrupt'), {
    type: 'bankrupt', figure: 'fig0', to: 'fig1', reason: 'rent', amount: 400,
  }, 'the amount on the event is what was OWED, not what was taken');
  assert(!types(r).includes('pay'), 'there is no pay event: nothing was part-paid');
  eq(types(r), ['roll', 'move', 'land', 'card', 'move', 'land', 'bankrupt']);
  eq(player(r, 'fig0').bankrupt, true);
  eq(player(r, 'fig0').money, 0);
  eq(money(r, 'fig1'), 2000 + 399, 'the creditor got the 399 that existed, not the 400 owed');
  eq(player(r, 'fig0').position, 26, 'the recorded position is still where the card left them');
  eq(r.position['26'].fig0, false, 'but the token is off the board');
  eq(r.current_order, 1, 'a bankrupt player cannot finish their turn');
  eq(r.game.phase, 'roll', 'and the next player is asked to roll');
  eq(r.game.winner, null, 'three players are still in, so nobody won');

  // Exactly 400$ pays, because the test is `<` and not `<=`: you are allowed to
  // be left with nothing.
  room = await newRoom();
  r = await nearestRoll(room, { chance: 23, kind: 'road', owners: ALL_RAILS, cash: 400 });
  eq(ev(r, 'pay'), {
    type: 'pay', figure: 'fig0', to: 'fig1', amount: 400, reason: 'rent', cell: 26,
  });
  eq(player(r, 'fig0').bankrupt, false, 'broke is not bankrupt');
  eq(money(r, 'fig0'), 0);
  eq(money(r, 'fig1'), 2400);
  eq(r.current_order, 0, 'and they still hold the turn');

  // The utility side of the same path, so it is not only the doubled railroad
  // rent that is known to reach mono_bankrupt.
  room = await newRoom();
  r = await nearestRoll(room, { chance: 8, kind: 'communal', owners: { 13: 'fig1' }, cash: 69 });
  eq(ev(r, 'bankrupt'), {
    type: 'bankrupt', figure: 'fig0', to: 'fig1', reason: 'rent', amount: 70,
  }, '10 x 7 with 69$ in hand');
  eq(money(r, 'fig1'), 2069);
  eq(player(r, 'fig0').bankrupt, true);
});

await test('one seq for the whole card: card is followed by a second move and a second land', async () => {
  // The fullest shape the branch can emit -- wrap AND rent -- in one action.
  // fig1 holds 6 and 16, so the railroad the card picks rents at 2 x 50.
  const room = await newRoom();
  const before = await row(room);
  const r = await nearestRoll(room, {
    chance: 37, kind: 'road', owners: { 6: 'fig1', 16: 'fig1' },
  });

  eq(r.game.seq, before.game.seq + 1, 'one game_action, one seq, however much happened');
  eq(types(r), ['roll', 'move', 'land', 'card', 'move', 'collect', 'land', 'pay'],
    'roll -> move -> land(Chance) -> card -> move -> collect(passGo) -> land -> pay(rent)');
  eq(allEv(r, 'move'), [
    { type: 'move', figure: 'fig0', from: 30, to: 37 },
    { type: 'move', figure: 'fig0', from: 37, to: 6 },
  ], 'two moves, and the second starts where the first ended');
  eq(lands(r).map((e) => [e.cell, e.kind]), [[37, 'chance'], [6, 'road']],
    'two landings, and the second names the kind the card asked for');
  eq(ev(r, 'card'), {
    type: 'card', figure: 'fig0', deck: 'chance', id: 'c5',
    text: CHANCE.find((c) => c.id === 'c5').text,
  }, 'the card event carries the deck, the id and the text the phones show');
  eq(r.game.lastCard, {
    deck: 'chance', figure: 'fig0', text: CHANCE.find((c) => c.id === 'c5').text,
  }, 'and lastCard is set for a phone that missed the live event');
  eq(money(r, 'fig0'), 2000 + 200 - 100, '200 for the wrap, then 100 for two railroads doubled');
  eq(money(r, 'fig1'), 2100);

  // The running history has to agree, because that is what a reloaded phone
  // reads instead of game.events: every one of this action's events, in the
  // same order, all tagged with this seq and this player, and nothing claiming
  // a seq of its own for the card's half of the work.
  const log = r.game.log || [];
  const mine = log.filter((e) => e.seq === r.game.seq);
  eq(mine.map((e) => e.type), types(r), 'the log holds the same events in the same order');
  assert(mine.every((e) => e.by === 'p0'), 'all eight tagged with the acting phone');
  eq(log.filter((e) => e.seq > r.game.seq), [], 'nothing in the log runs ahead of the row');
  eq(mine.length, 8, 'eight events under one seq, not two actions worth');
});

// ---------------------------------------------------------------------------
// 7. Regression smoke: a few hundred random legal-ish actions
// ---------------------------------------------------------------------------

section('smoke');

const OK_MESSAGES = [
  'Not your turn', 'You already rolled', 'Roll first', 'Not enough money',
  'Already owned', 'This cell is not for sale', 'You are not standing on that cell',
  'Houses can only be built on streets', 'You do not own this street',
  'You need the whole colour set first', 'There is already a hotel here',
  'Build on the other streets of this colour first', 'You are not in jail',
  'You have no Get Out Of Jail Free card', 'The game is over', 'You are bankrupt',
  'An auction is running', 'No auction is running', 'It is not your turn to bid',
  'Bid at least', 'Bids must be a multiple of 10', 'Nobody can bid',
  'You can only offer a trade on your turn', 'You cannot trade right now',
  'There is already a pending offer', 'There is no offer to answer',
  'There is no offer to cancel', 'This offer is not yours to answer',
  'This offer is not yours to cancel', 'You cannot trade with yourself',
  'That player is not in this room', 'That player is bankrupt',
  'An offer cannot be empty', 'Cash must be a whole number of 10$',
  'You do not have that much cash', 'They do not have that much cash',
  'You do not own ', 'They do not own ', 'has buildings in its colour set',
  'does not exist', 'This offer is incomplete', 'Player is not in this room',
];

function known(message) {
  return OK_MESSAGES.some((m) => message.includes(m));
}

/** Re-play this action's events over the money we had before it. */
function ledger(before, events) {
  const m = {};
  for (const p of before.players) m[p.figure] = p.money;
  for (const e of events) {
    switch (e.type) {
      case 'collect':
        m[e.figure] += e.amount; break;
      case 'pay':
        m[e.figure] -= e.amount;
        if (e.to) m[e.to] += e.amount;
        break;
      case 'buy':
      case 'build':
        m[e.figure] -= e.amount; break;
      case 'bankrupt':
        if (e.to) m[e.to] += m[e.figure];
        m[e.figure] = 0;
        break;
      case 'trade':
        if (e.status === 'accepted') {
          const g = e.give.cash || 0;
          const w = e.get.cash || 0;
          m[e.figure] += w - g;
          m[e.to] += g - w;
        }
        break;
      default:
        break;
    }
  }
  return m;
}

// SEED=<n> npm run test:sql replays the random walk with another seed.
let rngState = Number(process.env.SEED || 20260919);
function rnd() {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

await test('a few hundred random actions keep the invariants (six players)', async () => {
  await db.query('select setseed(0.4242)');
  const room = await newRoom(SIX);
  const OWNABLE = Object.keys(SEED_BOARD).filter(
    (k) => SEED_BOARD[k].price && !SEED_BOARD[k].tax,
  ).map(Number);

  let applied = 0;
  let rejected = 0;
  const seen = new Set();

  for (let step = 0; step < 600; step += 1) {
    const before = await row(room);
    const g = before.game || {};
    const phase = g.phase || 'roll';
    if (phase === 'over') break;

    const cur = before.players.find((p) => p.order === before.current_order);
    const alive = before.players.filter((p) => !p.bankrupt);
    let action;
    let payload;

    if (phase === 'auction' && g.auction) {
      const mover = before.players.find((p) => p.figure === g.auction.turn);
      const next = Math.max((g.auction.bid || 0) + 10, 10);
      if (!mover) {
        action = 'skip_turn'; payload = {};
      } else if (rnd() < 0.45 && mover.money >= next) {
        action = 'auction_bid';
        payload = { playerId: mover.playerId, amount: next + 10 * Math.floor(rnd() * 3) };
      } else if (rnd() < 0.85) {
        action = 'auction_drop'; payload = { playerId: mover.playerId };
      } else {
        action = 'skip_turn'; payload = {};
      }
    } else if (g.trade && rnd() < 0.7) {
      const to = before.players.find((p) => p.figure === g.trade.to);
      const from = before.players.find((p) => p.figure === g.trade.from);
      const r = rnd();
      if (!to || !from) {
        action = 'skip_turn'; payload = {};
      } else if (r < 0.45) {
        action = 'trade_accept'; payload = { playerId: to.playerId };
      } else if (r < 0.65) {
        action = 'trade_decline'; payload = { playerId: to.playerId };
      } else if (r < 0.8) {
        action = 'trade_cancel'; payload = { playerId: from.playerId };
      } else {
        const mine = OWNABLE.filter((c) => (before.position[c].bought || {})[to.figure] === true);
        action = 'trade_counter';
        payload = {
          playerId: to.playerId,
          give: { cells: mine.slice(0, 1), cash: 0 },
          get: { cells: [], cash: 10 * Math.floor(rnd() * 5) },
        };
      }
    } else if (!cur || cur.bankrupt || alive.length < 2) {
      action = 'skip_turn'; payload = {};
    } else if (phase === 'roll') {
      const r = rnd();
      if (r < 0.1 && !cur.inJail) {
        // propose a trade before rolling
        const mine = OWNABLE.filter((c) => (before.position[c].bought || {})[cur.figure] === true);
        const other = pick(alive.filter((p) => p.figure !== cur.figure));
        const theirs = other
          ? OWNABLE.filter((c) => (before.position[c].bought || {})[other.figure] === true)
          : [];
        action = 'trade_offer';
        payload = {
          playerId: cur.playerId,
          to: other ? other.figure : 'fig9',
          give: { cells: mine.slice(0, 1), cash: 0 },
          get: { cells: theirs.slice(0, 1), cash: 10 * Math.floor(rnd() * 4) },
        };
      } else if (cur.inJail && r < 0.3) {
        action = pick(['pay_jail', 'use_jail_card']); payload = { playerId: cur.playerId };
      } else {
        action = 'roll'; payload = { playerId: cur.playerId };
      }
    } else {
      // phase 'act'
      const pos = cur.position;
      const cell = before.position[String(pos)];
      const ownable = cell && cell.price && !cell.tax;
      const unowned = ownable && !Object.values(cell.bought || {}).includes(true);
      const r = rnd();
      if (unowned && r < 0.35 && cur.money >= cell.price) {
        action = 'buy'; payload = { playerId: cur.playerId, cell: String(pos) };
      } else if (unowned && r < 0.7) {
        action = 'auction_start'; payload = { playerId: cur.playerId, cell: pos };
      } else if (r < 0.78) {
        action = 'build'; payload = { playerId: cur.playerId, cell: String(pick(OWNABLE)) };
      } else if (r < 0.86) {
        const mine = OWNABLE.filter((c) => (before.position[c].bought || {})[cur.figure] === true);
        const other = pick(alive.filter((p) => p.figure !== cur.figure));
        const theirs = other
          ? OWNABLE.filter((c) => (before.position[c].bought || {})[other.figure] === true)
          : [];
        action = 'trade_offer';
        payload = {
          playerId: cur.playerId,
          to: other ? other.figure : 'fig9',
          give: { cells: mine.slice(0, 1), cash: 10 * Math.floor(rnd() * 3) },
          get: { cells: theirs.slice(0, 1), cash: 0 },
        };
      } else {
        action = 'end_turn'; payload = { playerId: cur.playerId };
      }
    }

    let after;
    try {
      after = await call(room, action, payload);
      applied += 1;
    } catch (err) {
      if (!known(err.message)) {
        throw new Error(`step ${step}: ${action} raised an unexpected error: ${err.message}`);
      }
      rejected += 1;
      const now = await row(room);
      eq(now, before, `step ${step}: rejected ${action} still changed the row`);
      continue;
    }

    for (const e of after.game.events || []) seen.add(e.type);

    // money: exactly what the events say, nothing else
    const want = ledger(before, after.game.events || []);
    for (const p of after.players) {
      if (!(p.figure in want)) continue;
      assert(
        p.money === want[p.figure],
        `step ${step} (${action}): ${p.figure} has ${p.money}, events say ${want[p.figure]}`
          + `\n  ${JSON.stringify(after.game.events)}`,
      );
    }

    // one owner per cell, at most
    for (const c of OWNABLE) owner(after, c);

    // the phase and its state agree
    const ph = after.game.phase;
    assert(
      (ph === 'auction') === (after.game.auction !== null),
      `step ${step}: phase ${ph} with auction ${JSON.stringify(after.game.auction)}`,
    );
    assert('auction' in after.game && 'trade' in after.game, 'keys always present');
    if (after.game.auction) {
      const a = after.game.auction;
      assert(a.in.every((f) => a.order.includes(f)), '`in` is a subset of `order`');
      assert(a.turn === null || a.in.includes(a.turn), '`turn` is in `in`');
      assert(a.turn !== a.leader, 'the leader is never asked to bid');
    }
    assert((after.game.log || []).length <= 40, 'log capped');
  }

  assert(applied > 200, `only ${applied} actions went through`);
  for (const t of ['auction_start', 'bid', 'drop', 'trade']) {
    assert(seen.has(t), `the random walk never produced a ${t} event`);
  }
  // eslint-disable-next-line no-console
  console.log(`      ${applied} actions applied, ${rejected} rejected, `
    + `${seen.size} event types seen`);
});

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

await db.close();

let failed = 0;
let last = null;
for (const r of results) {
  if (r.group !== last) {
    console.log(`\n  ${r.group}`);
    last = r.group;
  }
  if (r.ok) {
    console.log(`    PASS  ${r.name}`);
  } else {
    failed += 1;
    console.log(`    FAIL  ${r.name}`);
    console.log(`          ${String(r.err && r.err.message).split('\n').join('\n          ')}`);
  }
}
console.log(
  `\n  ${results.length - failed}/${results.length} passed`
  + (failed ? `, ${failed} FAILED\n` : ', all green\n'),
);
process.exit(failed ? 1 : 0);
