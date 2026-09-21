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
  const rent = Math.floor(160 / 8);
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
    traitor: false, traitorUntil: 0, backstabUsed: false,
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

  // fig0 lands on 12: full set, no houses -> double the base rent
  // (floor(140/8) = 17, doubled = 34 since the rebalance)
  const cash5 = money(await row(room), 'fig5');
  r = await call(room, 'move', { playerId: 'p0', to: 12 });
  eq(money(r, 'fig0'), 500 - 34, 'fig0 paid the doubled base rent');
  eq(money(r, 'fig5'), cash5 + 34, 'fig5 collected it');
  eq(ev(r, 'pay'), {
    type: 'pay', figure: 'fig0', to: 'fig5', amount: 34, reason: 'rent', cell: 12, mods: [],
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
      17: 0, 19: 0, 40: 5, // a hotel on 40: base floor(400/8)=50, x90 = 4500 rent
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
    type: 'bankrupt', figure: 'fig6', to: 'fig0', reason: 'rent', amount: 4500,
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
  eq(money(r, 'fig7'), 2500 - 140 + 17, 'rent reached the fig7 owner');
  eq(money(r, 'fig0'), 500 - 17, 'and left the fig0 payer');

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

await test('a jailed player collects NO rent, but still bids and answers a trade', async () => {
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
  // §3: a landlord behind bars cannot send a bill. The visitor pays nobody --
  // not the owner, not the bank, not the parking pot.
  eq(money(r, 'fig3'), 1000, 'a jailed owner collects nothing');
  eq(money(r, 'fig0'), 900, 'and the visitor is charged nothing at all');
  eq(r.game.pot, 0, 'the skipped rent did not fall into the pot either');
  assert(!types(r).includes('pay'), 'there is no pay event');
  eq(ev(r, 'rentFree'), {
    type: 'rentFree', figure: 'fig0', owner: 'fig3', cell: 12, reason: 'ownerInJail',
  }, 'and the log says why nothing moved');
  eq(player(r, 'fig3').inJail, true, 'and does not let them out');

  // the moment they are out, the same landing charges again
  await arrange(room, {
    players: { fig3: { inJail: false, jailTurns: 0 }, fig0: { position: 1, money: 900 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  r = await call(room, 'move', { playerId: 'p0', to: 12 });
  eq(money(r, 'fig3'), 1034, 'out of jail: the doubled base rent flows again');
  eq(money(r, 'fig0'), 900 - 34);
  await arrange(room, { players: { fig3: { inJail: true, jailTurns: 1, money: 1000 } } });

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
// 5. Railroads, and the two cells that used to be utilities
//
// The utilities are gone: 13 is the Casino (nobody can own it) and 28 is the
// Weed Farm (ownable, but it never charges a visitor). The railroad half of
// this section is unchanged apart from the rebalanced numbers, and the utility
// half now pins down that the rent branch really was REMOVED rather than left
// reachable with different inputs.
//
// From a bug report after real play: "I cannot buy the second Railroad."
// Railroads are cells 6/16/26/36 and utilities were 13/28; all six carry colour
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

section('railroads, casino & farm cells');

const RAILS = [6, 16, 26, 36];
/** Cell 13 is the Casino now, cell 28 the Weed Farm. */
const CASINO = 13;
const FARM = 28;

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

await test('the farm can never be bought — it auctions itself; nor can the casino', async () => {
  // 23 + (2,3) = 28, the Weed Farm. Since 20260921160000_farm_auction.sql the
  // landing itself puts the whole table in an auction, so there is no moment
  // at which `buy` could be legal: not during it (the room is locked), and not
  // after it (the refusal below is the cell's own, not the phase's).
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 23, money: 2000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  let r = await rollDice(room, 'p0', 2, 3);
  eq(player(r, 'fig0').position, FARM, 'landed on the farm');
  eq(money(r, 'fig0'), 2000, 'a visitor pays nothing to stand on it');
  eq(types(r), ['roll', 'move', 'land', 'farm', 'auction_start'],
    'the landing waters the crop AND opens the auction');
  eq(r.game.phase, 'auction');
  await rejects(room, 'buy', { playerId: 'p0', cell: String(FARM) }, 'An auction is running');

  // let it die unsold, then ask again with the room wide open
  for (const pid of ['p1', 'p2', 'p3', 'p0']) await call(room, 'auction_drop', { playerId: pid });
  r = await row(room);
  eq(r.game.phase, 'act', 'the lander is back on their own turn');
  eq(owner(r, FARM), null, 'and nobody bought it');
  await rejects(room, 'buy', { playerId: 'p0', cell: String(FARM) },
    'The farm is only ever sold at auction');

  // 8 + (2,3) = 13, the Casino. It has no price, so `buy` and `auction_start`
  // both bounce off the same "not for sale" guard every non-ownable cell uses.
  const other = await newRoom();
  await arrange(other, {
    players: { fig0: { position: 8, money: 2000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const landed = await rollDice(other, 'p0', 2, 3);
  eq(player(landed, 'fig0').position, CASINO, 'landed on the casino');
  eq(landed.game.phase, 'casino', 'and owes the house a bet');
  await call(other, 'casino_play', { playerId: 'p0', game: 'wheel', bet: landed.game.casino.min });
  await rejects(other, 'buy', { playerId: 'p0', cell: String(CASINO) }, 'This cell is not for sale');
  await rejects(other, 'auction_start', { playerId: 'p0', cell: CASINO }, 'This cell is not for sale');
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

await test('railroad rent is 35/70/140/280 by CELLS owned, and follows a trade', async () => {
  const room = await newRoom();
  const expect = [35, 70, 140, 280];
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
  eq(await rentOf(room, 6), 140, 'the seller is down to three');
  eq(await rentOf(room, 36), 35, 'the buyer has one');
});

await test('the utility rent branch is gone: casino and farm rent 0 whatever the dice', async () => {
  const room = await newRoom();
  // The old branch was `dice_sum * (4 or 10)`. If any trace of it survived, an
  // owned farm (and a "somehow owned" casino) would charge something here.
  await arrange(room, { owners: { [FARM]: 'fig0' } });
  for (const dice of [2, 7, 9, 12]) {
    eq(await rentOf(room, FARM, dice), 0, `an owned farm charges 0 on dice ${dice}`);
    eq(await rentOf(room, CASINO, dice), 0, `the casino charges 0 on dice ${dice}`);
  }
  await arrange(room, { owners: { [FARM]: 'fig1' } });
  eq(await rentOf(room, FARM, 9), 0, 'and it makes no difference who holds the deed');

  // mono_rent also lost its fifth argument, so the old five-argument call that
  // forced the utility multiplier no longer resolves at all.
  let failed = null;
  try {
    await db.query(
      `select public.mono_rent(position, '28', 9, 2, 10) from public.test where uuid = $1`,
      [room],
    );
  } catch (err) {
    failed = err.message;
  }
  assert(failed !== null, 'mono_rent(.., util_mult) must no longer exist');
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
  eq(money(r, 'fig0'), 1930, 'paid 70, the two-railroad rate');
  eq(money(r, 'fig1'), 2070);
  eq(ev(r, 'pay'), {
    type: 'pay', figure: 'fig0', to: 'fig1', amount: 70, reason: 'rent', cell: 26, mods: [],
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
  eq(await rentOf(room, 6), 70, 'the starter still has exactly two');
  eq(await rentOf(room, 36), 35, 'the winner has one');
});

await test('the farm goes through the same auction as any other space — it just starts itself', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 23, money: 2000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  await rollDice(room, 'p0', 2, 3); // 23 -> 28, which opens the auction
  await call(room, 'auction_bid', { playerId: 'p1', amount: 120 });
  await call(room, 'auction_drop', { playerId: 'p2' });
  await call(room, 'auction_drop', { playerId: 'p3' });
  const r = await call(room, 'auction_drop', { playerId: 'p0' });
  eq(owner(r, FARM), 'fig1', 'the bidder won the farm');
  eq(r.position[String(FARM)].income, 200,
    'and the counter came with it — including the 150 the opening landing added');
});

await test('bankruptcy hands every railroad and the farm over as individual cells', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { 6: 'fig0', 16: 'fig0', 26: 'fig0', [FARM]: 'fig0', 36: 'fig1' },
    // 26 + (4,6) = 36, which fig1 owns: the rent is what bankrupts fig0.
    players: { fig0: { position: 26, money: 10 }, fig1: { position: 20, money: 2000 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await rollDice(room, 'p0', 4, 6);
  eq(player(r, 'fig0').bankrupt, true, 'could not pay the rent');
  for (const c of [...RAILS, FARM]) {
    eq(owner(r, c), 'fig1', `cell ${c} went to the creditor`);
  }
  eq(await rentOf(room, 6), 280, 'the creditor now holds all four railroads');
  eq(owner(r, CASINO), null, 'and the casino is still nobody’s');
});

// ---------------------------------------------------------------------------
// 6. "Advance to the nearest railroad" -- Chance c5
//
// c4 used to be its utility twin. There are no utilities any more, so the
// rebalance migration RETARGETED it: it is a plain `moveTo` onto the Casino
// now, and the tests for it live in the casino section below. c5 is therefore
// the only surviving user of the `nearest` kind, and the only remaining caller
// that passes a road_mult.
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
//   * mono_deck -- c5 is {kind:'nearest', what:'road'}, 0-based index 4 of the
//     15-card Chance deck. c4 sits beside it at index 3 and is now a moveTo.
//   * mono_apply_card lines 553-566 -- the target is the LOWEST cell of that
//     kind strictly above the player's current cell:
//         where mono_cell_kind(cell) = card->>'what' and key::integer > pos
//         order by key::integer limit 1
//     and when nothing is above `pos` it falls back to mono_cell_of_kind
//     (line 146: the lowest cell of that kind on the whole board), which is
//     what makes the move wrap. Chance is 8 / 23 / 37; railroads 6 / 16 / 26 /
//     36. So 37 is the only Chance cell that wraps, to railroad 6.
//   * mono_move_to is called with collect_go = true, and pays the Start bonus
//     when `new_pos <= old_pos`. The wrap therefore collects -- 150$ since the
//     rebalance, down from 200$ -- and the two forward moves do not.
//   * mono_land is called with road_mult = 2, and road_mult MULTIPLIES the
//     count-based rate:
//         road:  (35 << greatest(cnt - 1, 0)) * coalesce(road_mult, 1)
//     so the card charges 70 / 140 / 280 / 560 for 1 / 2 / 3 / 4 railroads.
//     Each case below asserts the plain mono_rent for the same board next to
//     the rent the card actually charged, so the doubling cannot hide: the
//     card's figure has to come out at exactly twice the plain rate.
//   * There used to be a util_mult beside it, which did NOT multiply -- it sat
//     inside a coalesce and REPLACED the 4x-or-10x utility choice. Both the
//     argument and the branch it fed went with the utilities; section 5
//     asserts that the five-argument mono_rent no longer resolves at all.
//   * The dice are NOT thrown again. mono_land passes its own dice_sum into
//     mono_apply_card and the nearest branch passes the same value straight
//     back into mono_land. Nothing reads it for a railroad any more, but it
//     still has to survive the round trip intact.
//
// Method, deliberately the same as section 5: every landing here is a REAL
// forced roll. The one addition is that the CARD is forced too, by extending
// the seed search from two random() draws to three -- `roll` takes two for the
// dice and mono_draw takes the third, and nothing else consumes the session
// PRNG in between. Hand-building a state and calling mono_apply_card directly
// would test the branch in isolation and pass while the path a phone actually
// walks was broken, which is precisely the failure mode that produced Bug A.
// ---------------------------------------------------------------------------

section('nearest railroad card');

/** The real Chance deck, so the card ids below are the server's, not ours. */
const CHANCE = (await db.query(
  `select public.mono_deck('chance', $1::jsonb) as d`, [JSON.stringify(SEED_BOARD)],
)).rows[0].d;

const NEAREST_CARD = { road: 'c5' };
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

await test('the Chance deck carries exactly one nearest card, and c4 now points at the Casino', async () => {
  const near = CHANCE.filter((c) => c.kind === 'nearest');
  eq(near.map((c) => [c.id, c.what]), [['c5', 'road']],
    'one nearest card, the railroad one; the utility twin is gone');
  // The numbers the tests below assert are the numbers the card promises the
  // player, so tie the two together here rather than leaving them as folklore.
  assert(/double rent/.test(near[0].text), `railroad card text: ${near[0].text}`);
  // `what` has to be a kind mono_cell_kind can actually produce, or the search
  // would silently find nothing and the card would do nothing.
  const hits = Object.keys(SEED_BOARD).filter((k) => SEED_BOARD[k].road === true);
  assert(hits.length > 0, 'no cell on the board is of kind road');

  // c4 kept its slot in the deck -- fifteen Chance cards, unchanged odds --
  // but it is a moveTo onto the casino cell now.
  const c4 = CHANCE.find((c) => c.id === 'c4');
  eq(CHANCE.length, 15, 'the deck is still fifteen cards');
  eq(c4.kind, 'moveTo', 'c4 is a plain move now');
  eq(c4.cell, CASINO, 'and it targets the casino cell');
  assert(/Casino/.test(c4.text), `casino card text: ${c4.text}`);
  // No card that can carry you past Start still promises the old 200$ bonus:
  // the phones print these strings verbatim, so a stale one is a lie the
  // player can catch.
  for (const deck of ['chance', 'community']) {
    const cards = (await db.query(
      `select public.mono_deck($1, $2::jsonb) as d`, [deck, JSON.stringify(SEED_BOARD)],
    )).rows[0].d;
    for (const c of cards.filter((x) => /Start/.test(x.text))) {
      assert(!/\$200/.test(c.text),
        `${deck} ${c.id} still promises the old Start bonus: ${c.text}`);
    }
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

await test('only the wrap from 37 collects the Start bonus, and it is 150 now', async () => {
  for (const chance of CHANCE_CELLS) {
    const room = await newRoom();
    const r = await nearestRoll(room, { chance, kind: 'road' });
    if (chance === 37) {
      eq(money(r, 'fig0'), 2150, 'from 37 the card walked backwards past Start');
      eq(ev(r, 'collect'),
        { type: 'collect', figure: 'fig0', amount: 150, reason: 'passGo' },
        'and mono_move_to paid the rebalanced bonus, with the reason the UI keys on');
      eq(types(r), ['roll', 'move', 'land', 'card', 'move', 'collect', 'land'],
        'the collect sits between the second move and the second landing');
    } else {
      eq(money(r, 'fig0'), 2000, `from ${chance}: a forward move, nothing collected`);
      assert(!types(r).includes('collect'),
        `from ${chance}: there must be no collect event at all`);
      eq(types(r), ['roll', 'move', 'land', 'card', 'move', 'land']);
    }
  }
});

await test('nearest railroad DOUBLES the count-based rate: 70 / 140 / 280 / 560', async () => {
  // From Chance 23 the card always picks 26, whatever else the owner holds, so
  // the only thing changing between the four rounds is the count.
  const order = [26, 6, 16, 36];
  const expect = [70, 140, 280, 560];
  for (let cnt = 1; cnt <= 4; cnt += 1) {
    const room = await newRoom();
    const owners = {};
    for (const c of order.slice(0, cnt)) owners[c] = 'fig1';
    const r = await nearestRoll(room, { chance: 23, kind: 'road', owners });
    eq(player(r, 'fig0').position, 26, 'the target does not depend on who owns what');
    eq(ev(r, 'pay'), {
      type: 'pay', figure: 'fig0', to: 'fig1', amount: expect[cnt - 1], reason: 'rent', cell: 26, mods: [],
    }, `${cnt} railroad(s) owned`);
    eq(money(r, 'fig0'), 2000 - expect[cnt - 1]);
    eq(money(r, 'fig1'), 2000 + expect[cnt - 1], 'and it reached the owner');
    // The discriminating assertion: road_mult multiplies, so the card's rent is
    // exactly twice what standing on the same cell after a normal roll costs.
    eq(await rentOf(room, 26), expect[cnt - 1] / 2,
      `the plain ${cnt}-railroad rate is half the doubled one`);
  }
});

await test('the nearest railroad being your own charges nothing', async () => {
  for (const [chance, target] of [[23, 26], [8, 16]]) {
    const room = await newRoom();
    const r = await nearestRoll(room, { chance, kind: 'road', owners: { [target]: 'fig0' } });
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
  for (const [chance, target, price] of [[23, 26, 200], [8, 16, 200]]) {
    const room = await newRoom();
    const r = await nearestRoll(room, { chance, kind: 'road' });
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

  // 560$ owed with 559$ in hand. mono_charge compares `money < amount` and
  // hands the whole thing to mono_bankrupt: no debt is recorded, no part of the
  // 560 is paid, and the creditor gets the cash that WAS there.
  let room = await newRoom();
  let r = await nearestRoll(room, { chance: 23, kind: 'road', owners: ALL_RAILS, cash: 559 });
  eq(ev(r, 'bankrupt'), {
    type: 'bankrupt', figure: 'fig0', to: 'fig1', reason: 'rent', amount: 560,
  }, 'the amount on the event is what was OWED, not what was taken');
  assert(!types(r).includes('pay'), 'there is no pay event: nothing was part-paid');
  eq(types(r), ['roll', 'move', 'land', 'card', 'move', 'land', 'bankrupt']);
  eq(player(r, 'fig0').bankrupt, true);
  eq(player(r, 'fig0').money, 0);
  eq(money(r, 'fig1'), 2000 + 559, 'the creditor got the 559 that existed, not the 560 owed');
  eq(player(r, 'fig0').position, 26, 'the recorded position is still where the card left them');
  eq(r.position['26'].fig0, false, 'but the token is off the board');
  eq(r.current_order, 1, 'a bankrupt player cannot finish their turn');
  eq(r.game.phase, 'roll', 'and the next player is asked to roll');
  eq(r.game.winner, null, 'three players are still in, so nobody won');

  // Exactly 560$ pays, because the test is `<` and not `<=`: you are allowed to
  // be left with nothing.
  room = await newRoom();
  r = await nearestRoll(room, { chance: 23, kind: 'road', owners: ALL_RAILS, cash: 560 });
  eq(ev(r, 'pay'), {
    type: 'pay', figure: 'fig0', to: 'fig1', amount: 560, reason: 'rent', cell: 26, mods: [],
  });
  eq(player(r, 'fig0').bankrupt, false, 'broke is not bankrupt');
  eq(money(r, 'fig0'), 0);
  eq(money(r, 'fig1'), 2560);
  eq(r.current_order, 0, 'and they still hold the turn');

  // A rent that goes to a PLAYER never touches the parking pot, however big it
  // is and whether or not it bankrupts the payer.
  eq(r.game.pot, 0, 'rent is income, not a fine');
});

await test('one seq for the whole card: card is followed by a second move and a second land', async () => {
  // The fullest shape the branch can emit -- wrap AND rent -- in one action.
  // fig1 holds 6 and 16, so the railroad the card picks rents at 2 x 70.
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
  eq(money(r, 'fig0'), 2000 + 150 - 140, '150 for the wrap, then 140 for two railroads doubled');
  eq(money(r, 'fig1'), 2140);

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
// 7. The rebalance
//
// Every number the playtest changed, asserted against mono_rent and against a
// real landing rather than against the migration's own comment header. The
// point of pinning all six of them in one place is that the client mirrors
// them in src/Hooks/rules.js: when one side moves, this section is where the
// other side is told what it now has to say.
// ---------------------------------------------------------------------------

section('rebalance');

await test('street rent is price/8, doubled for the full set, x1/6/18/50/70/90 by houses', async () => {
  const room = await newRoom();
  // 12 / 14 / 15 are the salmon set; 12 costs 140, so the base is floor(140/8).
  const base = Math.floor(140 / 8);
  eq(base, 17, 'floor(140/8)');

  await arrange(room, { owners: { 12: 'fig0' }, houses: { 12: 0 } });
  eq(await rentOf(room, 12), base, 'one street of the set, bare: the plain base');

  await arrange(room, { owners: { 12: 'fig0', 14: 'fig0', 15: 'fig0' } });
  eq(await rentOf(room, 12), base * 2, 'the whole colour set doubles the bare rent');

  // With buildings the set bonus stops applying and the multiplier takes over.
  const mult = [1, 6, 18, 50, 70, 90];
  for (let h = 1; h <= 5; h += 1) {
    await arrange(room, { houses: { 12: h } });
    eq(await rentOf(room, 12), base * mult[h],
      `${h === 5 ? 'a hotel' : `${h} house(s)`} rents at base x ${mult[h]}`);
  }

  // and the multipliers are not secretly the old 1/5/15/45/60/75
  await arrange(room, { houses: { 12: 1 } });
  assert(await rentOf(room, 12) !== base * 5, 'one house is not the old x5');
});

await test('passing Start pays 150, not 200', async () => {
  const room = await newRoom();
  // 39 + (1,2) wraps to cell 2, an unowned street, so the only money that can
  // move on this roll is the Start bonus.
  await arrange(room, {
    players: { fig0: { position: 39, money: 1000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await rollDice(room, 'p0', 1, 2);
  eq(player(r, 'fig0').position, 2, 'wrapped past Start');
  eq(money(r, 'fig0'), 1150, 'and collected 150');
  eq(ev(r, 'collect'), { type: 'collect', figure: 'fig0', amount: 150, reason: 'passGo' });
});

await test('start money is 2500 and house prices are unchanged', async () => {
  const room = await newRoom();
  eq(money(await row(room), 'fig0'), 2500, 'a fresh seat holds 2500');
  const h = (await db.query(
    `select public.mono_house_price(5)  as a, public.mono_house_price(15) as b,
            public.mono_house_price(25) as c, public.mono_house_price(35) as d`,
  )).rows[0];
  eq([h.a, h.b, h.c, h.d], [50, 100, 150, 200], '50/100/150/200 by decade');
});

// ---------------------------------------------------------------------------
// 8. The Free Parking pot
//
// The rule is "fines pile up, prices do not", and the whole of it lives in one
// `reason in (...)` list inside mono_charge. These tests come at it from both
// sides: every reason that IS a fine has to raise the pot, and every reason
// that merely moves money to the bank has to leave it alone.
// ---------------------------------------------------------------------------

section('free parking pot');

/** The pot as a phone reads it. */
const potOf = (r) => r.game.pot;

await test('both tax cells feed the pot and Free Parking hands the whole thing over', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: {
      fig0: { position: 1, money: 1000 }, fig1: { position: 1, money: 1000 },
      fig2: { position: 1, money: 1000 },
    },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null },
  });

  let r = await call(room, 'move', { playerId: 'p0', to: 5 });   // Tax, 200
  eq(money(r, 'fig0'), 800, 'the tax was charged');
  eq(potOf(r), 200, 'and landed on Free Parking');
  eq(ev(r, 'pay'), {
    type: 'pay', figure: 'fig0', to: null, amount: 200, reason: 'tax', cell: 5,
  });

  r = await call(room, 'move', { playerId: 'p1', to: 39 });      // Luxury Tax, 400
  eq(money(r, 'fig1'), 600);
  eq(potOf(r), 600, 'the pot accumulates across players and actions');

  const before = money(await row(room), 'fig2');
  r = await call(room, 'move', { playerId: 'p2', to: 21 });      // Free Park
  eq(money(r, 'fig2'), before + 600, 'the whole pot went to whoever landed');
  eq(potOf(r), 0, 'and it is empty again');
  eq(ev(r, 'collect'), { type: 'collect', figure: 'fig2', amount: 600, reason: 'pot' });
  eq(ev(r, 'pot'), { type: 'pot', figure: 'fig2', cell: 21, amount: 600 },
    'plus the event the TV celebrates on');
});

await test('an empty pot is silent: no event, no money, nothing', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 1, money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null, pot: 0 },
  });
  const r = await call(room, 'move', { playerId: 'p0', to: 21 });
  eq(money(r, 'fig0'), 1000, 'nothing was paid out');
  eq(potOf(r), 0);
  eq(types(r), ['move', 'land'], 'and no pot or collect event was emitted');
});

await test('a card fine feeds the pot, and so does a repairs assessment', async () => {
  // c11 is the 15$ speeding fine. 1 + (3,4) = 8, a Chance cell.
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 1, money: 1000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  let r = await rollForCard(room, 'p0', 3, 4, 'c11');
  eq(money(r, 'fig0'), 985, 'the fine was charged');
  eq(potOf(r), 15, 'and it is a fine to the bank, so the pot took it');

  // c10 is "general repairs": 25 per house, 100 per hotel, also to the bank.
  await arrange(room, {
    owners: { 12: 'fig0', 14: 'fig0', 15: 'fig0' },
    houses: { 12: 5, 14: 2, 15: 0 },
    players: { fig0: { position: 1, money: 1000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  r = await rollForCard(room, 'p0', 3, 4, 'c10');
  eq(money(r, 'fig0'), 1000 - 150, 'one hotel (100) and two houses (50)');
  eq(potOf(r), 15 + 150, 'the assessment joined the pot the fine started');
});

await test('a card that pays ANOTHER player leaves the pot alone', async () => {
  // c14: "pay each player $50" -- that is income for them, not a fine.
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 1, money: 1000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  const r = await rollForCard(room, 'p0', 3, 4, 'c14');
  eq(money(r, 'fig0'), 1000 - 150, 'three other players at 50 each');
  eq(potOf(r), 0, 'and not one dollar of it reached the pot');
});

await test('jail fines, purchases, houses and auction hammer prices never reach the pot', async () => {
  const room = await newRoom();

  // pay_jail
  await arrange(room, {
    players: { fig0: { position: 11, money: 1000, inJail: true, jailTurns: 1 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null, pot: 0 },
  });
  let r = await call(room, 'pay_jail', { playerId: 'p0' });
  eq(money(r, 'fig0'), 950, 'the fine was taken');
  eq(potOf(r), 0, 'the jail fine goes to the bank, not to Free Parking');

  // the third failed roll takes the same 50 through mono_charge('jailFee')
  await arrange(room, {
    players: { fig0: { position: 11, money: 1000, inJail: true, jailTurns: 2 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null, pot: 0 },
  });
  r = await rollDice(room, 'p0', 1, 2);
  eq(ev(r, 'jailLeave').how, 'fee', 'the forced fine was paid');
  eq(potOf(r), 0, 'and it is still not a fine the table shares');

  // buy and build
  await arrange(room, {
    owners: { 12: null, 14: 'fig0', 15: 'fig0' },
    houses: { 12: 0, 14: 0, 15: 0 },
    players: { fig0: { position: 12, money: 1000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null, pot: 0 },
  });
  r = await call(room, 'buy', { playerId: 'p0', cell: '12' });
  eq(potOf(r), 0, 'a purchase is a price, not a penalty');
  r = await call(room, 'build', { playerId: 'p0', cell: '12' });
  eq(potOf(r), 0, 'and so is a house');

  // the auction hammer price
  await standOn(room, 'fig0', 27, { game: { pot: 0 } });
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  await call(room, 'auction_bid', { playerId: 'p1', amount: 100 });
  await call(room, 'auction_drop', { playerId: 'p2' });
  await call(room, 'auction_drop', { playerId: 'p3' });
  r = await call(room, 'auction_drop', { playerId: 'p0' });
  eq(owner(r, 27), 'fig1', 'the auction settled');
  eq(potOf(r), 0, 'and the bank kept the hammer price');
});

await test('new_game empties the pot', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 1, money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null },
  });
  let r = await call(room, 'move', { playerId: 'p0', to: 5 });
  eq(potOf(r), 200, 'there is something in it');
  r = await call(room, 'new_game', { position: SEED_BOARD });
  eq(potOf(r), 0, 'and the new game starts from nothing');
});

// ---------------------------------------------------------------------------
// 9. The Casino (cell 13)
//
// The two things worth being paranoid about here are that the bet is really
// MANDATORY -- the turn cannot move around it -- and that the randomness is
// really SERVER-side and really VOLATILE. The second one has a specific
// failure mode: an immutable or stable function may legally be folded to one
// evaluation per statement, which would deal every row of a set the same hand
// and, worse, would let a phone replay the RPC until it liked the answer.
//
// Outcomes are forced the same way the dice are: mono_casino_spin reads its
// random() draws in a fixed order (three of 6 for slots, one of 37 for
// roulette, one of 12 for wheel) and setseed() governs the session PRNG, so a
// seed search pins an exact reel/slot/segment. Nothing about the result is
// ever sent by the client.
// ---------------------------------------------------------------------------

section('casino');

const spinSeeds = new Map();

/**
 * A seed whose next draws, read the way mono_casino_spin reads them, come out
 * as `want`. `mod` is the die the game rolls: 6 (three times) for slots, 37
 * for roulette, 12 for wheel.
 */
async function seedForSpin(mod, want) {
  const key = `${mod}:${want.join(',')}`;
  if (spinSeeds.has(key)) return spinSeeds.get(key);
  const cols = want.map((_, i) => `floor(random()*${mod})::int as d${i}`).join(', ');
  for (let i = 1; i <= 200000; i += 1) {
    const s = i / 200000;
    await db.query('select setseed($1)', [s]);
    const got = (await db.query(`select ${cols}`)).rows[0];
    if (want.every((w, j) => got[`d${j}`] === w)) {
      spinSeeds.set(key, s);
      return s;
    }
  }
  throw new Error(`no seed produces the spin ${key}`);
}

const SPIN = {
  slots: (reels) => ({ mod: 6, want: reels }),
  roulette: (slot) => ({ mod: 37, want: [slot] }),
  wheel: (segment) => ({ mod: 12, want: [segment - 1] }),
};

/** fig0 rolls 8 -> 13 and is left owing the house a bet. */
async function atCasino(room, cash) {
  await arrange(room, {
    players: { fig0: { position: 8, money: cash, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: {
      phase: 'roll', doubles: 0, dice: null, auction: null, trade: null,
      winner: null, casino: null,
    },
  });
  return rollDice(room, 'p0', 2, 3);
}

/** Force the outcome, then play it. */
async function playCasino(room, pid, game, bet, spin, colour = null) {
  await db.query('select setseed($1)', [await seedForSpin(spin.mod, spin.want)]);
  return call(room, 'casino_play', { playerId: pid, game, bet, colour });
}

await test('landing on the casino is mandatory: nothing else may happen until the bet', async () => {
  const room = await newRoom();
  const r = await atCasino(room, 1000);
  eq(player(r, 'fig0').position, CASINO, 'landed on 13');
  eq(r.game.phase, 'casino', 'and the room is waiting on a bet');
  eq(r.game.casino, { cell: CASINO, figure: 'fig0', min: 150, max: 1000 },
    'the pending block tells the slider its floor and its ceiling');
  eq(ev(r, 'casino'), {
    type: 'casino', stage: 'enter', figure: 'fig0', cell: CASINO, min: 150, max: 1000,
  });

  for (const [action, payload] of [
    ['end_turn', { playerId: 'p0' }],
    ['roll', { playerId: 'p0' }],
    ['buy', { playerId: 'p0', cell: '12' }],
    ['build', { playerId: 'p0', cell: '12' }],
    ['auction_start', { playerId: 'p0', cell: 27 }],
    ['trade_offer', { playerId: 'p0', to: 'fig1', give: { cells: [], cash: 10 }, get: { cells: [], cash: 0 } }],
    ['move', { playerId: 'p0', to: 20 }],
  ]) {
    await rejects(room, action, payload, 'The casino is waiting');
  }
  // and nobody else can act around them either
  await rejects(room, 'roll', { playerId: 'p1' }, 'The casino is waiting');
  await rejects(room, 'casino_play', { playerId: 'p1', game: 'wheel', bet: 150 },
    'The casino is not waiting for you');

  const after = await playCasino(room, 'p0', 'wheel', 150, SPIN.wheel(1));
  eq(after.game.phase, 'act', 'one resolved play and the turn is ordinary again');
  eq(after.game.casino, null, 'the pending block is cleared');
  const done = await call(room, 'end_turn', { playerId: 'p0' });
  eq(done.game.phase, 'roll', 'and end_turn works again');
});

await test('the minimum bet is 15% rounded up to 10$, and never more than the cash', async () => {
  const cases = [[2500, 380], [1000, 150], [660, 100], [100, 20], [60, 10], [5, 5], [1, 1], [0, 0]];
  for (const [cash, want] of cases) {
    const got = (await db.query('select public.mono_casino_min_bet($1) as m', [cash])).rows[0].m;
    eq(got, want, `15% of ${cash}, rounded up to 10$ and capped`);
  }
  // and the pending block quotes the same helper, so the slider cannot offer a
  // bet the server will then refuse
  const room = await newRoom();
  const r = await atCasino(room, 660);
  eq(r.game.casino.min, 100);
  eq(r.game.casino.max, 660);
  await rejects(room, 'casino_play', { playerId: 'p0', game: 'wheel', bet: 90 }, 'Bet at least 100$');
  await rejects(room, 'casino_play', { playerId: 'p0', game: 'wheel', bet: 661 }, 'Not enough money');
  await rejects(room, 'casino_play', { playerId: 'p0', game: 'wheel', bet: 100.5 },
    'The bet must be a whole number');
  await rejects(room, 'casino_play', { playerId: 'p0', game: 'wheel' }, 'casino_play needs a bet');
  await rejects(room, 'casino_play', { playerId: 'p0', game: 'blackjack', bet: 100 },
    'Pick slots, roulette or wheel');
  await rejects(room, 'casino_play', { playerId: 'p0', game: 'roulette', bet: 100 },
    'Pick red, black or green');
  await rejects(room, 'casino_play', { playerId: 'p0', game: 'roulette', bet: 100, colour: 'puce' },
    'Pick red, black or green');
  // all-in is allowed: the ceiling is exactly their cash
  const allIn = await playCasino(room, 'p0', 'wheel', 660, SPIN.wheel(12));
  eq(money(allIn, 'fig0'), 6600, 'all-in on the x10 segment');
});

await test('slots: three of a kind x10, exactly two x2, no match loses the bet', async () => {
  const cases = [
    { reels: [3, 3, 3], mult: 10 },
    { reels: [0, 0, 0], mult: 10 },
    { reels: [3, 3, 1], mult: 2 },
    { reels: [3, 1, 3], mult: 2 },
    { reels: [1, 3, 3], mult: 2 },
    { reels: [0, 1, 2], mult: 0 },
    { reels: [5, 4, 3], mult: 0 },
  ];
  for (const c of cases) {
    const room = await newRoom();
    await atCasino(room, 1000);
    const r = await playCasino(room, 'p0', 'slots', 200, SPIN.slots(c.reels));
    const e = ev(r, 'casino');
    eq(e.stage, 'result');
    eq(e.result.reels, c.reels, `reels ${c.reels}`);
    eq(e.mult, c.mult, `reels ${c.reels} pay x${c.mult}`);
    eq(e.payout, 200 * c.mult, 'payout is bet x mult');
    // x2 means they END HOLDING 2x the bet: 1000 - 200 + 400
    eq(money(r, 'fig0'), 1000 - 200 + 200 * c.mult, 'the bet left and the payout came back');
  }
});

await test('roulette: every one of the 37 slots is the colour and the multiplier it should be', async () => {
  // 0 green, 1..18 red, 19..36 black -- 18 / 18 / 1, exactly the spec's odds.
  for (let slot = 0; slot <= 36; slot += 1) {
    const want = slot === 0 ? 'green' : (slot <= 18 ? 'red' : 'black');
    const room = await newRoom();
    await atCasino(room, 1000);   // 15% of 1000 rounds to a 150$ floor
    const r = await playCasino(room, 'p0', 'roulette', 200, SPIN.roulette(slot), want);
    const e = ev(r, 'casino');
    eq(e.result.slot, slot, `slot ${slot}`);
    eq(e.result.colour, want, `slot ${slot} is ${want}`);
    eq(e.mult, want === 'green' ? 14 : 2, `${want} pays`);
    eq(money(r, 'fig0'), 1000 - 200 + 200 * (want === 'green' ? 14 : 2));
  }
});

await test('roulette: the wrong colour loses the bet', async () => {
  const cases = [
    { slot: 0, pick: 'red' }, { slot: 0, pick: 'black' },
    { slot: 7, pick: 'black' }, { slot: 7, pick: 'green' },
    { slot: 30, pick: 'red' }, { slot: 30, pick: 'green' },
  ];
  for (const c of cases) {
    const room = await newRoom();
    await atCasino(room, 1000);
    const r = await playCasino(room, 'p0', 'roulette', 200, SPIN.roulette(c.slot), c.pick);
    const e = ev(r, 'casino');
    eq(e.mult, 0, `slot ${c.slot} with ${c.pick} on the table`);
    eq(e.payout, 0);
    eq(money(r, 'fig0'), 800, 'the bet is simply gone');
    assert(!types(r).includes('collect'), 'and nothing was credited back');
  }
});

await test('wheel: 5 segments lose, 4 pay x1.5, 2 pay x3, 1 pays x10', async () => {
  const want = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 1.5, 7: 1.5, 8: 1.5, 9: 1.5, 10: 3, 11: 3, 12: 10 };
  const tally = { 0: 0, 1.5: 0, 3: 0, 10: 0 };
  for (let seg = 1; seg <= 12; seg += 1) {
    const room = await newRoom();
    await atCasino(room, 1000);
    const r = await playCasino(room, 'p0', 'wheel', 200, SPIN.wheel(seg));
    const e = ev(r, 'casino');
    eq(e.result.segment, seg, `segment ${seg}`);
    eq(e.mult, want[seg], `segment ${seg} pays x${want[seg]}`);
    eq(money(r, 'fig0'), 1000 - 200 + 200 * want[seg]);
    tally[want[seg]] += 1;
  }
  eq(tally, { 0: 5, 1.5: 4, 3: 2, 10: 1 }, 'the twelve segments split exactly 5 / 4 / 2 / 1');

  // x1.5 on an odd bet rounds the house's way, in whole dollars
  const room = await newRoom();
  await atCasino(room, 1000);
  const r = await playCasino(room, 'p0', 'wheel', 333, SPIN.wheel(6));
  eq(ev(r, 'casino').payout, 499, 'floor(333 * 1.5)');
  eq(money(r, 'fig0'), 1000 - 333 + 499);
});

await test('the randomness is server-side and VOLATILE, not folded per statement', async () => {
  // If mono_casino_spin were immutable or stable, the planner would be free to
  // evaluate it once for the whole statement and hand all fifty rows the same
  // segment -- which is also exactly the shape of "the player can reroll".
  await db.query('select setseed(0.4242)');
  const segs = (await db.query(
    `select (public.mono_casino_spin('wheel', 100, null)->>'segment')::int as s
       from generate_series(1, 50)`,
  )).rows.map((x) => x.s);
  assert(new Set(segs).size > 1,
    `one statement produced a single segment ${segs[0]} fifty times: the function is being folded`);

  // And over a large sample the three games land on the spec's odds.
  await db.query('select setseed(0.1234)');
  const n = 6000;
  const slots = (await db.query(
    `select (public.mono_casino_spin('slots', 100, null)->>'mult')::numeric as m
       from generate_series(1, ${n})`,
  )).rows.map((x) => Number(x.m));
  const triples = slots.filter((m) => m === 10).length / n;
  const pairs = slots.filter((m) => m === 2).length / n;
  assert(triples > 0.015 && triples < 0.045, `3 of a kind came out at ${triples}, want ~0.028`);
  assert(pairs > 0.37 && pairs < 0.46, `2 of a kind came out at ${pairs}, want ~0.417`);

  const wheel = (await db.query(
    `select (public.mono_casino_spin('wheel', 100, null)->>'mult')::numeric as m
       from generate_series(1, ${n})`,
  )).rows.map((x) => Number(x.m));
  const lose = wheel.filter((m) => m === 0).length / n;
  assert(lose > 0.38 && lose < 0.45, `the wheel lost ${lose} of the time, want ~0.417 (5/12)`);

  const greens = (await db.query(
    `select count(*) filter (where public.mono_casino_spin('roulette', 100, 'green')->>'colour' = 'green') as g
       from generate_series(1, ${n})`,
  )).rows[0].g / n;
  assert(greens > 0.012 && greens < 0.045, `green came up ${greens} of the time, want ~0.027 (1/37)`);
});

await test('casino money never touches the parking pot, in either direction', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 8, money: 1000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: {
      phase: 'roll', doubles: 0, dice: null, auction: null, trade: null,
      winner: null, casino: null, pot: 500,
    },
  });
  await rollDice(room, 'p0', 2, 3);
  const lost = await playCasino(room, 'p0', 'wheel', 200, SPIN.wheel(1));
  eq(money(lost, 'fig0'), 800, 'the bet was lost');
  eq(potOf(lost), 500, 'and the pot is untouched: a wager is not a fine');

  await arrange(room, {
    players: { fig0: { position: 8, money: 1000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: {
      phase: 'roll', doubles: 0, dice: null, auction: null, trade: null,
      winner: null, casino: null, pot: 500,
    },
  });
  await rollDice(room, 'p0', 2, 3);
  const won = await playCasino(room, 'p0', 'wheel', 200, SPIN.wheel(12));
  eq(money(won, 'fig0'), 1000 - 200 + 2000, 'the bank printed the payout');
  eq(potOf(won), 500, 'and did not raid the pot to do it');
});

await test('a player with no cash walks straight through the casino', async () => {
  const room = await newRoom();
  const r = await atCasino(room, 0);
  eq(player(r, 'fig0').position, CASINO, 'they still land on it');
  eq(r.game.phase, 'act', 'but there is nothing they could bet, so nothing is pending');
  eq(r.game.casino, null);
  const done = await call(room, 'end_turn', { playerId: 'p0' });
  eq(done.game.phase, 'roll', 'and the turn moves on normally');
});

await test('skip_turn releases a casino nobody is playing', async () => {
  const room = await newRoom();
  const r = await atCasino(room, 1000);
  eq(r.game.phase, 'casino');
  const s = await call(room, 'skip_turn', {});
  eq(s.game.phase, 'roll', 'the table moved on');
  eq(s.game.casino, null, 'and the unplayed bet was released');
  eq(s.current_order, 1, 'to the next player');
  eq(money(s, 'fig0'), 1000, 'the house took nothing for the walk-out');
  eq(ev(s, 'casino'), {
    type: 'casino', stage: 'skipped', figure: 'fig0', cell: CASINO,
  });
});

await test('a player leaving mid-bet releases the casino; another player leaving does not', async () => {
  // somebody else walking out must not hand the better a free pass
  let room = await newRoom();
  let r = await atCasino(room, 1000);
  r = await call(room, 'leave', { playerId: 'p2' });
  eq(r.game.phase, 'casino', 'the bet is still owed');
  eq(r.game.casino.figure, 'fig0');

  // the better walking out has to release it, or the room freezes
  room = await newRoom();
  await atCasino(room, 1000);
  r = await call(room, 'leave', { playerId: 'p0' });
  eq(r.game.casino, null, 'nobody is left to place the bet');
  eq(r.game.phase, 'roll', 'and the next player is asked to roll');
});

await test('the c4 Chance card sends you to the casino, where the bet is mandatory too', async () => {
  // 1 + (3,4) = 8, a Chance cell; c4 is the retargeted "nearest utility" card.
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 1, money: 1000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: {
      phase: 'roll', doubles: 0, dice: null, auction: null, trade: null,
      winner: null, casino: null,
    },
  });
  const r = await rollForCard(room, 'p0', 3, 4, 'c4');
  eq(player(r, 'fig0').position, CASINO, 'the card carried them to the casino');
  eq(r.game.phase, 'casino', 'and a bet is owed from there too');
  eq(r.game.casino.figure, 'fig0');
  eq(lands(r).map((e) => [e.cell, e.kind]), [[8, 'chance'], [CASINO, 'casino']],
    'two landings: the Chance square, then the casino');
  await rejects(room, 'end_turn', { playerId: 'p0' }, 'The casino is waiting');
  const after = await playCasino(room, 'p0', 'slots', r.game.casino.min, SPIN.slots([1, 2, 3]));
  eq(after.game.phase, 'act');
});

// ---------------------------------------------------------------------------
// 10. The Weed Farm (cell 28)
//
// A deed like any other -- bought, auctioned, traded, lost to a bankruptcy --
// that charges nobody anything. Its entire economy is one integer on the cell,
// which is where it lives precisely so that it follows the deed rather than
// having to be kept in step with it.
// ---------------------------------------------------------------------------

section('weed farm');

const incomeOf = (r) => r.position[String(FARM)].income;

await test('a non-owner pays nothing and leaves the counter 150$ bigger', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { [FARM]: 'fig1' },
    players: { fig0: { position: 1, money: 1000 }, fig1: { money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null, pot: 0 },
  });
  eq(incomeOf(await row(room)), 50, 'the counter starts at 50');

  let r = await call(room, 'move', { playerId: 'p0', to: FARM });
  eq(money(r, 'fig0'), 1000, 'the visitor paid nothing at all');
  eq(money(r, 'fig1'), 1000, 'and the owner collected nothing for the visit');
  eq(potOf(r), 0, 'nothing reached the pot either');
  eq(incomeOf(r), 200, 'the crop grew by 150');
  eq(ev(r, 'farm'), {
    type: 'farm', stage: 'grow', figure: 'fig0', cell: FARM, amount: 0, income: 200,
  });
  assert(!types(r).includes('pay'), 'no pay event');

  // no cap, and every non-owner counts
  r = await call(room, 'move', { playerId: 'p2', to: FARM });
  eq(incomeOf(r), 350);
  r = await call(room, 'move', { playerId: 'p3', to: FARM });
  eq(incomeOf(r), 500);
  r = await call(room, 'move', { playerId: 'p0', to: FARM });
  eq(incomeOf(r), 650, 'the same player landing again grows it again');
});

await test('an unowned farm grows too: everybody is a non-owner', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 1, money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null },
  });
  const r = await call(room, 'move', { playerId: 'p0', to: FARM });
  eq(owner(r, FARM), null, 'still nobody’s');
  eq(incomeOf(r), 200, 'and the crop grew anyway');
  eq(money(r, 'fig0'), 1000, 'standing on it is free');
  // ...and, since 20260921160000_farm_auction.sql, that same landing put the
  // deed itself up for sale. The crop grew FIRST: what the bidders are about
  // to fight over is already 200$, not the 50$ it was a moment ago.
  eq(r.game.phase, 'auction', 'the landing auctioned it');
  eq(r.game.auction.cell, FARM);
});

// ---------------------------------------------------------------------------
// The farm auctions itself (20260921160000_farm_auction.sql)
// ---------------------------------------------------------------------------

/**
 * fig0 at 23 with 2000$, phase roll: a (2,3) puts them on the farm.
 * `over.players.fig0` is merged INTO that default rather than replacing it, so
 * a caller can change the money without silently losing the position.
 */
async function approachFarm(room, over = {}) {
  const { fig0: lander = {}, ...others } = over.players || {};
  await arrange(room, {
    players: {
      fig0: { position: 23, money: 2000, inJail: false, jailTurns: 0, ...lander },
      ...others,
    },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
    ...(over.owners ? { owners: over.owners } : {}),
  });
}

await test('landing on the unowned farm opens an auction for the WHOLE table', async () => {
  const room = await newRoom();
  await approachFarm(room);
  const r = await rollDice(room, 'p0', 2, 3);

  eq(types(r), ['roll', 'move', 'land', 'farm', 'auction_start'],
    'one action: the roll, the move, the landing, the watering and the auction');
  eq(r.game.phase, 'auction');
  eq(money(r, 'fig0'), 2000, 'the lander was charged nothing for opening it');
  eq(incomeOf(r), 200, 'and the crop still grew by 150 on that very landing');
  eq(owner(r, FARM), null, 'nobody owns it yet — that is what is being decided');

  // The rotation is the ordinary one: the lander started it, so the lander
  // bids LAST and everybody else gets a turn first. Identical in every field
  // to what `auction_start` builds by hand on any other cell.
  eq(r.game.auction.cell, FARM, 'cell');
  eq(r.game.auction.startedBy, 'fig0', 'startedBy');
  eq(r.game.auction.order, ['fig1', 'fig2', 'fig3', 'fig0'], 'order');
  eq(r.game.auction.in, ['fig1', 'fig2', 'fig3', 'fig0'], 'everyone is in, the lander included');
  eq(r.game.auction.turn, 'fig1', 'turn');
  eq(r.game.auction.bid, 0, 'no opening bid: the 150$ price buys nobody anything');
  eq(r.game.auction.leader, null, 'leader');
  eq(r.game.auction.last, {}, 'last');
  eq(ev(r, 'auction_start'), { type: 'auction_start', figure: 'fig0', cell: FARM });
});

await test('the winner takes the farm and the lander carries on with their turn', async () => {
  const room = await newRoom();
  await approachFarm(room);
  await rollDice(room, 'p0', 2, 3);

  const before = money(await row(room), 'fig2');
  await call(room, 'auction_bid', { playerId: 'p1', amount: 100 });
  await call(room, 'auction_bid', { playerId: 'p2', amount: 200 });
  await call(room, 'auction_drop', { playerId: 'p3' });
  await call(room, 'auction_drop', { playerId: 'p0' });
  const r = await call(room, 'auction_drop', { playerId: 'p1' });

  eq(r.game.auction, null, 'auction cleared');
  eq(owner(r, FARM), 'fig2', 'the high bidder owns it');
  eq(money(r, 'fig2'), before - 200, 'and paid exactly the high bid — not the 150$ price');
  eq(incomeOf(r), 200, 'the standing crop went with the deed');
  eq(r.game.phase, 'act', 'the lander is back on their own turn, exactly as after a declined buy');
  eq(r.current_order, 0, 'and it is still their turn');
  const ended = await call(room, 'end_turn', { playerId: 'p0' });
  eq(ended.current_order, 1, 'which they can now end normally');
});

await test('a doubles roll onto the farm still gets its extra turn after the auction', async () => {
  // 22 + (3,3) = 28. The auction takes the room over in the middle of a turn
  // that has an extra roll owed to it; `game.doubles` has to survive that.
  const room = await newRoom();
  await approachFarm(room, { players: { fig0: { position: 22 } } });
  const landed = await rollDice(room, 'p0', 3, 3);
  eq(player(landed, 'fig0').position, FARM);
  eq(landed.game.phase, 'auction');
  eq(landed.game.doubles, 1, 'the doubles counter went into the auction');

  for (const pid of ['p1', 'p2', 'p3', 'p0']) await call(room, 'auction_drop', { playerId: pid });
  const back = await row(room);
  eq(back.game.doubles, 1, 'and came out of it unchanged');
  const again = await call(room, 'end_turn', { playerId: 'p0' });
  eq(again.current_order, 0, 'so the doubles roll is still theirs');
  assert(types(again).includes('again'), 'and the room was told so');
});

await test('nobody bids: the farm stays with the bank and the NEXT landing re-auctions it', async () => {
  const room = await newRoom();
  await approachFarm(room);
  const cash = (await row(room)).players.map((p) => p.money);
  await rollDice(room, 'p0', 2, 3);
  for (const pid of ['p1', 'p2', 'p3', 'p0']) await call(room, 'auction_drop', { playerId: pid });

  let r = await row(room);
  eq(r.game.auction, null);
  eq(r.game.phase, 'act');
  eq(owner(r, FARM), null, 'the bank keeps it');
  eq(r.players.map((p) => p.money), cash, 'and not a dollar moved');

  // the lander cannot buy it now either, and cannot re-run the auction they
  // have just walked away from
  await rejects(room, 'buy', { playerId: 'p0', cell: String(FARM) },
    'The farm is only ever sold at auction');
  await rejects(room, 'auction_start', { playerId: 'p0', cell: FARM },
    'The farm auctions itself when somebody lands on it');

  // somebody else lands on it: a brand new auction, and a crop 150$ bigger
  await call(room, 'end_turn', { playerId: 'p0' });
  await arrange(room, {
    players: { fig1: { position: 23, money: 2000, inJail: false, jailTurns: 0 } },
    current_order: 1,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  r = await rollDice(room, 'p1', 2, 3);
  eq(r.game.phase, 'auction', 'the next landing opens a fresh one');
  eq(r.game.auction.startedBy, 'fig1', 'started by whoever landed this time');
  eq(r.game.auction.order, ['fig2', 'fig3', 'fig0', 'fig1'], 'and rotated from their seat');
  eq(incomeOf(r), 350, 'each landing waters it whether or not anybody bids');
});

await test('a Chance card that drops a player on a farm auctions it just the same', async () => {
  // No Chance card in the deck reaches cell 28, so the farm is moved to one
  // that a card does reach: c2 is `moveTo 25`, and 14 + (4,5) = 23, a Chance
  // cell. The rule under test is about the KIND of space, not about the
  // number 28 — and a card landing is the one route to a cell that does not
  // go through the roll branch of game_action at all.
  const room = await newRoom();
  const board = JSON.parse(JSON.stringify((await row(room)).position));
  board['25'] = { ...board['25'], farm: true, price: 150, income: 50 };
  delete board['28'].farm; // exactly one farm on this board
  await db.query('update public.test set position = $2::jsonb where uuid = $1',
    [room, JSON.stringify(board)]);
  await arrange(room, {
    players: { fig0: { position: 14, money: 2000, inJail: false, jailTurns: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });

  const r = await rollForCard(room, 'p0', 4, 5, 'c2');
  eq(player(r, 'fig0').position, 25, 'the card carried them onto the farm');
  eq(r.position['25'].income, 200, 'the card landing waters it like any other');
  eq(r.game.phase, 'auction', 'and auctions it like any other');
  eq(r.game.auction.cell, 25);
  eq(r.game.auction.startedBy, 'fig0');

  await call(room, 'auction_bid', { playerId: 'p1', amount: 10 });
  await call(room, 'auction_drop', { playerId: 'p2' });
  await call(room, 'auction_drop', { playerId: 'p3' });
  const won = await call(room, 'auction_drop', { playerId: 'p0' });
  eq(owner(won, 25), 'fig1');
  eq(won.game.phase, 'act', 'and hands the turn back to the player the card moved');
});

await test('a table with nothing in its pockets still holds the auction', async () => {
  // The lander is the one with 0$ — which is exactly why the farm is auctioned
  // rather than sold: the player who rolled it cannot afford anything, and
  // under the old rule that simply meant nobody got it.
  const room = await newRoom();
  await approachFarm(room, {
    players: {
      fig0: { money: 0 },
      fig1: { money: 0 }, fig2: { money: 0 }, fig3: { money: 40 },
    },
  });
  const r = await rollDice(room, 'p0', 2, 3);
  eq(r.game.phase, 'auction', 'a broke lander still puts it up for everybody');

  await rejects(room, 'auction_bid', { playerId: 'p1', amount: 10 }, 'Not enough money');
  await call(room, 'auction_drop', { playerId: 'p1' });
  await call(room, 'auction_drop', { playerId: 'p2' });
  await call(room, 'auction_bid', { playerId: 'p3', amount: 40 });
  const won = await call(room, 'auction_drop', { playerId: 'p0' });
  eq(owner(won, FARM), 'fig3', 'the only player with any money at all took it');
  eq(money(won, 'fig3'), 0, 'for everything they had');
  eq(won.game.phase, 'act');
});

await test('the automatic auction sweeps a pending trade off the table', async () => {
  // `auction_start` has always cancelled whatever offer was open — "an auction
  // replaces whatever was on the table". An auction nobody asked for has to do
  // the same, or a landing would leave an offer live in a room where nobody
  // can answer it.
  const room = await newRoom();
  await approachFarm(room);
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [], cash: 100 }, get: { cells: [], cash: 0 },
  });
  eq((await row(room)).game.trade.from, 'fig0', 'an offer is on the table');

  const r = await rollDice(room, 'p0', 2, 3);
  eq(r.game.phase, 'auction');
  eq(r.game.trade, null, 'and the landing swept it away');
  eq((ev(r, 'trade') || {}).status, 'cancelled', 'saying so');
  eq(money(r, 'fig0'), 2000, 'no cash moved with it');
});

await test('an owned farm is never auctioned again — the landing just waters it', async () => {
  const room = await newRoom();
  await approachFarm(room, { owners: { [FARM]: 'fig1' } });
  const r = await rollDice(room, 'p0', 2, 3);
  eq(types(r), ['roll', 'move', 'land', 'farm'], 'no auction_start in sight');
  eq(r.game.phase, 'act');
  eq(r.game.auction, null);
  eq(incomeOf(r), 200);
});

await test('the debug jump auctions the farm only for the player whose turn it is', async () => {
  // `move` has no turn check on purpose (TESTING.md 0.4). An auction ends by
  // handing the move back to whoever started it, so teleporting a player whose
  // turn it is NOT must not start one — it waters the crop and stops there.
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 1, money: 1000 }, fig2: { position: 1, money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null },
  });
  let r = await call(room, 'move', { playerId: 'p2', to: FARM });
  eq(r.game.phase, 'act', 'not their turn: no auction');
  eq(r.game.auction, null);
  eq(incomeOf(r), 200, 'but the crop grew, because they did land on it');

  r = await call(room, 'move', { playerId: 'p0', to: FARM });
  eq(r.game.phase, 'auction', 'the player whose turn it is opens one');
  eq(r.game.auction.startedBy, 'fig0');
  eq(incomeOf(r), 350);
});

await test('the owner landing on it collects the whole counter and resets it to 50', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { [FARM]: 'fig0' },
    players: { fig0: { position: 1, money: 1000 }, fig1: { position: 1, money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null, pot: 0 },
  });
  // three visitors water it: 50 + 3 x 150
  for (const pid of ['p1', 'p2', 'p3']) await call(room, 'move', { playerId: pid, to: FARM });
  eq(incomeOf(await row(room)), 500, 'the crop is worth 500');

  const r = await call(room, 'move', { playerId: 'p0', to: FARM });
  eq(money(r, 'fig0'), 1500, 'the owner harvested the whole counter');
  eq(incomeOf(r), 50, 'and the field starts again at 50');
  eq(ev(r, 'collect'), { type: 'collect', figure: 'fig0', amount: 500, reason: 'farm' },
    'the bank printed it: it is generated income, not taken from anybody');
  eq(ev(r, 'farm'), {
    type: 'farm', stage: 'harvest', figure: 'fig0', cell: FARM, amount: 500, income: 50,
  });
  eq(potOf(r), 0, 'and the pot was not involved');

  // landing again immediately harvests only the fresh 50 -- there is no
  // per-turn or per-lap payout, the owner has to keep coming back
  const again = await call(room, 'move', { playerId: 'p0', to: FARM });
  eq(money(again, 'fig0'), 1550);
  eq(incomeOf(again), 50);
});

await test('the counter follows the deed through a trade', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { [FARM]: 'fig0' },
    players: { fig0: { position: 20, money: 1000 }, fig1: { position: 1, money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null },
  });
  await call(room, 'move', { playerId: 'p2', to: FARM });
  await call(room, 'move', { playerId: 'p3', to: FARM });
  eq(incomeOf(await row(room)), 350, 'fig0 has 350 growing');

  await arrange(room, {
    players: { fig0: { position: 20 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, winner: null },
  });
  await call(room, 'trade_offer', {
    playerId: 'p0', to: 'fig1', give: { cells: [FARM], cash: 0 }, get: { cells: [], cash: 100 },
  });
  let r = await call(room, 'trade_accept', { playerId: 'p1' });
  eq(owner(r, FARM), 'fig1', 'the deed changed hands');
  eq(incomeOf(r), 350, 'and the standing crop went with it, unharvested');

  // the old owner is now a visitor: they water it instead of harvesting it
  r = await call(room, 'move', { playerId: 'p0', to: FARM });
  eq(incomeOf(r), 500, 'the seller grew it for the buyer');
  const cash0 = money(r, 'fig0');
  // and the new owner collects the lot
  r = await call(room, 'move', { playerId: 'p1', to: FARM });
  eq(money(r, 'fig1'), money(await row(room), 'fig1'), 'read-back sanity');
  eq(incomeOf(r), 50, 'harvested and reset');
  eq(ev(r, 'collect').amount, 500, 'the buyer took everything that had grown');
  eq(money(r, 'fig0'), cash0, 'and the seller got none of it');
});

await test('the farm never charges rent, whoever owns it and whatever the dice', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { [FARM]: 'fig1' },
    players: { fig0: { position: 23, money: 1000, inJail: false, jailTurns: 0 }, fig1: { money: 1000 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, dice: null, auction: null, trade: null, winner: null },
  });
  // a real roll, 23 + (2,3) = 28
  const r = await rollDice(room, 'p0', 2, 3);
  eq(player(r, 'fig0').position, FARM);
  eq(money(r, 'fig0'), 1000, 'no rent on a real landing either');
  eq(money(r, 'fig1'), 1000);
  eq(types(r), ['roll', 'move', 'land', 'farm'], 'land then farm, and no pay in between');
  eq(r.game.phase, 'act', 'and the turn carries on normally');
});

await test('mono_upgrade_cells migrates a legacy in-flight board', async () => {
  // Exactly what a room opened before this migration holds: cell 13 and cell 28
  // are `communal` with info Light / Water, 13 has been BOUGHT by somebody, and
  // neither cell has ever heard of a casino, a farm or an income counter.
  const board = JSON.parse(JSON.stringify(SEED_BOARD));
  board['13'] = {
    ...board['13'], communal: true, info: 'Light', price: 150,
    bought: { ...board['13'].bought, fig1: true },
  };
  delete board['13'].casino;
  board['28'] = { ...board['28'], communal: true, info: 'Water', price: 150 };
  delete board['28'].farm;
  delete board['28'].income;

  const roomId = 'legacy03';
  await db.query(
    `insert into public.test (uuid, position, "Players", current_order)
     values ($1, $2::jsonb, '[]'::jsonb, 0)`,
    [roomId, JSON.stringify(board)],
  );
  await db.query(
    `update public.test set position = public.mono_upgrade_cells(position) where uuid = $1`,
    [roomId],
  );
  let after = (await row(roomId)).position;

  eq(after['13'].casino, true, 'the old Light cell is the casino');
  assert(!('communal' in after['13']), 'and the dead communal flag is gone');
  assert(!('price' in after['13']), 'the casino has no price: nobody can buy it');
  eq(Object.values(after['13'].bought).filter((v) => v === true), [],
    'and the deed somebody held on it was cleared: the casino has no owner');
  eq(after['28'].farm, true, 'the old Water cell is the farm');
  assert(!('communal' in after['28']), 'and it too lost the dead flag');
  eq(after['28'].price, 150, 'the farm keeps the price it inherited');
  eq(after['28'].income, 50, 'and starts its counter at 50');

  // mono_cell_kind has to read BOTH vintages, because a phone that has not
  // reloaded still seeds the legacy shape.
  const kinds = (await db.query(
    `select public.mono_cell_kind($1::jsonb) as legacy_light,
            public.mono_cell_kind($2::jsonb) as legacy_water,
            public.mono_cell_kind($3::jsonb) as new_casino,
            public.mono_cell_kind($4::jsonb) as new_farm,
            public.mono_cell_kind($5::jsonb) as stray_communal`,
    [
      JSON.stringify({ communal: true, info: 'Light', id: 13 }),
      JSON.stringify({ communal: true, info: 'Water', id: 28 }),
      JSON.stringify({ casino: true }),
      JSON.stringify({ farm: true, income: 50 }),
      JSON.stringify({ communal: true, info: 'Something else', id: 99 }),
    ],
  )).rows[0];
  eq(kinds.legacy_light, 'casino');
  eq(kinds.legacy_water, 'farm');
  eq(kinds.new_casino, 'casino');
  eq(kinds.new_farm, 'farm');
  eq(kinds.stray_communal, 'farm',
    'a leftover communal reads as the OWNABLE kind, so no deed is confiscated by accident');

  // idempotent, and an accumulated counter is never clamped back down
  await db.query(
    `update public.test set position = jsonb_set(position, '{28,income}', '800')
      where uuid = $1`, [roomId],
  );
  await db.query(
    `update public.test set position = public.mono_upgrade_cells(position) where uuid = $1`,
    [roomId],
  );
  after = (await row(roomId)).position;
  eq(after['28'].income, 800, 'a standing crop survives a re-run of the upgrade');
});

await test('new_game normalises a board seeded by a phone that has not reloaded', async () => {
  const room = await newRoom();
  const stale = JSON.parse(JSON.stringify(SEED_BOARD));
  stale['13'] = { ...stale['13'], communal: true, info: 'Light', price: 150 };
  delete stale['13'].casino;
  stale['28'] = { ...stale['28'], communal: true, info: 'Water', price: 150, income: 900 };
  delete stale['28'].farm;

  const r = await call(room, 'new_game', { position: stale });
  eq(r.position['13'].casino, true, 'the stale payload was normalised on the way in');
  assert(!('price' in r.position['13']), 'and the casino cannot be bought in the new game');
  eq(r.position['28'].farm, true);
  eq(r.position['28'].income, 50, 'the farm counter starts the new game at 50');
  eq(potOf(r), 0);
});

// ---------------------------------------------------------------------------
// 11. Diplomacy: alliances, wars, the Backstab gambit
//
// Every rule in these four sections is a rule about money that moves between
// players, so almost every test is written the same way: arrange an exact
// state, take exactly one action, and check both the balances AND the events
// that are supposed to explain them.
//
// The board cells used here:
//   26  a railroad. One owned rents 35, four rent 280. No colour set, no
//       houses, no dice: the cleanest base rent on the board.
//   5   Tax, 200 to the pot. Used wherever a forced charge is needed that is
//       not rent.
// ---------------------------------------------------------------------------

/** Every pay event of one reason, and the first of them. */
const pays = (r, reason) => (r.game.events || []).filter((e) => e.type === 'pay' && e.reason === reason);
const payOf = (r, reason) => pays(r, reason)[0];
const evs = (r, type) => (r.game.events || []).filter((e) => e.type === type);

/** mono_rent_due as the server computes it, without moving any money. */
async function rentDue(room, cell, payer, diceSum = 7, roadMult = 1) {
  const res = await db.query(
    `select public.mono_rent_due(
       jsonb_build_object('players', "Players", 'board', position, 'game', game),
       $2, $3, $4, $5) as due
       from public.test where uuid = $1`,
    [room, String(cell), payer, diceSum, roadMult],
  );
  return res.rows[0].due;
}

/**
 * Hand the turn on with skip_turn until game.round ticks over, and return the
 * row of the action that ticked it. skip_turn is used rather than end_turn
 * because it needs no phase, no dice and no live player, so a table with a
 * bankrupt seat or an arranged state still walks forward.
 */
async function toNextRound(room) {
  const start = (await row(room)).game.round;
  let r = null;
  for (let i = 0; i < 12; i += 1) {
    r = await call(room, 'skip_turn', {});
    if (r.game.round !== start) return r;
  }
  throw new Error('the round never ticked over');
}

/** fig0 and fig1 allied for real, through the two verbs. */
async function allyUp(room, a = 'fig0', b = 'fig1', order = 0) {
  await arrange(room, {
    current_order: order,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, casino: null },
  });
  await call(room, 'ally_propose', { playerId: `p${a.slice(3)}`, to: b });
  return call(room, 'ally_accept', { playerId: `p${b.slice(3)}`, from: a });
}

// ---------------------------------------------------------------------------

section('alliance');

await test('propose + accept forms the pair and clears every offer either had', async () => {
  const room = await newRoom();
  await arrange(room, {
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  let r = await call(room, 'ally_propose', { playerId: 'p0', to: 'fig1' });
  eq(r.game.allyOffers, [{ from: 'fig0', to: 'fig1' }], 'the proposal is pending');
  eq(r.game.alliances, [], 'and nothing is formed yet');
  eq(ev(r, 'ally'), { type: 'ally', stage: 'propose', from: 'fig0', to: 'fig1' });

  // a second, unrelated proposal from somebody else to fig1
  await arrange(room, { current_order: 2, game: { phase: 'act' } });
  r = await call(room, 'ally_propose', { playerId: 'p2', to: 'fig1' });
  eq(r.game.allyOffers.length, 2, 'two suitors');

  r = await call(room, 'ally_accept', { playerId: 'p1', from: 'fig0' });
  eq(r.game.alliances, [{ a: 'fig0', b: 'fig1', since: 1 }], 'formed, stamped with the round');
  eq(r.game.allyOffers, [], 'and fig2 is left holding a dead proposal');
  eq(ev(r, 'ally'), { type: 'ally', stage: 'form', a: 'fig0', b: 'fig1' });
});

await test('a proposal can be declined by the target or cancelled by the sender', async () => {
  const room = await newRoom();
  await arrange(room, { current_order: 0, game: { phase: 'act', doubles: 0, auction: null, trade: null } });
  await call(room, 'ally_propose', { playerId: 'p0', to: 'fig1' });
  let r = await call(room, 'ally_decline', { playerId: 'p1', from: 'fig0' });
  eq(r.game.allyOffers, [], 'declined');
  eq(r.game.alliances, []);
  eq(ev(r, 'ally'), { type: 'ally', stage: 'decline', from: 'fig0', to: 'fig1' });
  await rejects(room, 'ally_decline', { playerId: 'p1', from: 'fig0' }, 'There is no offer to answer');

  await call(room, 'ally_propose', { playerId: 'p0', to: 'fig1' });
  r = await call(room, 'ally_cancel', { playerId: 'p0', to: 'fig1' });
  eq(r.game.allyOffers, [], 'cancelled');
  eq(ev(r, 'ally'), { type: 'ally', stage: 'cancel', from: 'fig0', to: 'fig1' });
  await rejects(room, 'ally_cancel', { playerId: 'p0', to: 'fig1' }, 'There is no offer to cancel');
});

await test('answering a proposal is legal off your turn; proposing is not', async () => {
  const room = await newRoom();
  await arrange(room, { current_order: 0, game: { phase: 'act', doubles: 0, auction: null, trade: null } });
  await rejects(room, 'ally_propose', { playerId: 'p1', to: 'fig2' },
    'You can only propose an alliance on your turn');
  await call(room, 'ally_propose', { playerId: 'p0', to: 'fig1' });
  // it is still fig0's turn, and fig1 answers anyway
  const r = await call(room, 'ally_accept', { playerId: 'p1', from: 'fig0' });
  eq(r.game.alliances.length, 1, 'accepted out of turn');
  eq(r.current_order, 0, 'and the turn did not move');
});

await test('one alliance per player, no self-alliance, no ghosts, no duplicates', async () => {
  const room = await newRoom();
  await arrange(room, { current_order: 0, game: { phase: 'act', doubles: 0, auction: null, trade: null } });
  await rejects(room, 'ally_propose', { playerId: 'p0', to: 'fig0' }, 'You cannot ally with yourself');
  await rejects(room, 'ally_propose', { playerId: 'p0', to: 'fig9' }, 'That player is not in this room');
  await call(room, 'ally_propose', { playerId: 'p0', to: 'fig1' });
  await rejects(room, 'ally_propose', { playerId: 'p0', to: 'fig1' }, 'There is already an offer between you');
  await call(room, 'ally_accept', { playerId: 'p1', from: 'fig0' });

  await rejects(room, 'ally_propose', { playerId: 'p0', to: 'fig2' }, 'You are already in an alliance');
  await arrange(room, { current_order: 2, game: { phase: 'act' } });
  await rejects(room, 'ally_propose', { playerId: 'p2', to: 'fig1' }, 'They are already in an alliance');
  await rejects(room, 'ally_propose', { playerId: 'p2', to: 'fig4' }, 'That player is not in this room');
});

await test('a bankrupt player is nobody to ally with', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig1: { bankrupt: true, money: 0 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  await rejects(room, 'ally_propose', { playerId: 'p0', to: 'fig1' }, 'That player is bankrupt');
});

await test('ally_break is free, on your turn, and only when there is one', async () => {
  const room = await newRoom();
  await allyUp(room);
  // allied, but not their turn: the turn is checked first, deliberately
  await rejects(room, 'ally_break', { playerId: 'p1' }, 'You can only break an alliance on your turn');
  await arrange(room, { current_order: 2, game: { phase: 'act' } });
  await rejects(room, 'ally_break', { playerId: 'p2' }, 'You are not in an alliance');
  await arrange(room, { current_order: 0, game: { phase: 'act' } });
  const before = (await row(room)).players.map((p) => p.money);
  const r = await call(room, 'ally_break', { playerId: 'p0' });
  eq(r.game.alliances, [], 'gone');
  eq(r.players.map((p) => p.money), before, 'and it cost nothing');
  eq(ev(r, 'ally'), { type: 'ally', stage: 'break', figure: 'fig0', other: 'fig1' });
});

await test('rent between allies is 0, and says why', async () => {
  const room = await newRoom();
  await allyUp(room);
  await arrange(room, {
    owners: { 26: 'fig1' },
    players: { fig0: { position: 1, money: 1000 }, fig1: { money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  eq(await rentOf(room, 26), 35, 'the deed still charges 35 to the world');
  eq(await rentDue(room, 26, 'fig0'), { amount: 0, zero: true, mods: [] }, 'but not to an ally');

  const r = await call(room, 'move', { playerId: 'p0', to: 26 });
  eq(money(r, 'fig0'), 1000, 'nothing left the visitor');
  eq(money(r, 'fig1'), 1000, 'and nothing reached the landlord');
  eq(pays(r, 'rent').length, 0, 'no rent event at all');
  eq(ev(r, 'rentFree'), {
    type: 'rentFree', figure: 'fig0', owner: 'fig1', cell: 26, reason: 'ally',
  });
});

await test('a non-ally pays the landlord in full and the BANK tips the other ally 10%', async () => {
  const room = await newRoom();
  await allyUp(room, 'fig1', 'fig2', 1);
  await arrange(room, {
    owners: { 26: 'fig1' },
    players: {
      fig0: { position: 1, money: 1000 }, fig1: { money: 1000 },
      fig2: { money: 1000 }, fig3: { money: 1000 },
    },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, pot: 0 },
  });
  const r = await call(room, 'move', { playerId: 'p0', to: 26 });
  eq(money(r, 'fig0'), 965, 'the visitor paid 35');
  eq(money(r, 'fig1'), 1035, 'the landlord kept every dollar of it');
  eq(money(r, 'fig2'), 1003, 'and the ally was tipped floor(35 * 10%) = 3');
  eq(potOf(r), 0, 'the commission is printed by the bank, not taken from the pot');
  eq(ev(r, 'commission'), {
    type: 'commission', figure: 'fig2', payer: 'fig0', owner: 'fig1', amount: 3, cell: 26,
  });
  eq(ev(r, 'collect'), { type: 'collect', figure: 'fig2', amount: 3, reason: 'commission' });
});

await test('no commission when the landlord has no ally, and none on a 0 rent', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { 26: 'fig1' },
    players: { fig0: { position: 1, money: 1000 }, fig1: { money: 1000, inJail: true } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  let r = await call(room, 'move', { playerId: 'p0', to: 26 });
  eq(evs(r, 'commission').length, 0, 'unallied landlord, no tip');

  // a jailed landlord collects nothing, so there is nothing to take 10% of
  await allyUp(room, 'fig1', 'fig2', 1);
  await arrange(room, {
    players: { fig0: { position: 1 }, fig1: { inJail: true } },
    current_order: 0,
    game: { phase: 'act' },
  });
  r = await call(room, 'move', { playerId: 'p0', to: 26 });
  eq(ev(r, 'rentFree').reason, 'ownerInJail');
  eq(evs(r, 'commission').length, 0, 'no rent arrived, so no tip');
});

await test('an allied player pays +25% rent to everybody who is not their ally', async () => {
  const room = await newRoom();
  await allyUp(room, 'fig0', 'fig3', 0);
  await arrange(room, {
    owners: { 26: 'fig1' },
    players: { fig0: { position: 1, money: 1000 }, fig1: { money: 1000 }, fig3: { money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  eq(await rentDue(room, 26, 'fig0'),
    { amount: 43, zero: false, mods: ['allyTax'] }, 'floor(35 * 1.25)');
  const r = await call(room, 'move', { playerId: 'p0', to: 26 });
  eq(money(r, 'fig0'), 957);
  eq(money(r, 'fig1'), 1043, 'the surcharge goes to the landlord, not the bank');
  eq(payOf(r, 'rent'), {
    type: 'pay', figure: 'fig0', to: 'fig1', amount: 43, reason: 'rent', cell: 26,
    mods: ['allyTax'],
  });
  eq(money(r, 'fig3'), 1000, 'and the ally of the payer is not billed for anything');
});

await test('upkeep: 50$ per allied player into the pot at the start of every round', async () => {
  const room = await newRoom();
  await allyUp(room);
  await arrange(room, {
    players: {
      fig0: { money: 1000 }, fig1: { money: 1000 },
      fig2: { money: 1000 }, fig3: { money: 1000 },
    },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, pot: 0, round: 1 },
  });
  const r = await toNextRound(room);
  eq(r.game.round, 2, 'the round ticked when the turn came back to seat 0');
  eq(money(r, 'fig0'), 950);
  eq(money(r, 'fig1'), 950);
  eq(money(r, 'fig2'), 1000, 'the unallied pay nothing');
  eq(money(r, 'fig3'), 1000);
  eq(potOf(r), 100, 'both bills landed on Free Parking');
  eq(evs(r, 'allyUpkeep'), [
    { type: 'allyUpkeep', figure: 'fig0', amount: 50 },
    { type: 'allyUpkeep', figure: 'fig1', amount: 50 },
  ], 'billed in seat order');
  eq(r.game.alliances.length, 1, 'and the alliance survives a bill it can pay');
});

await test('upkeep a player cannot pay dissolves the alliance instead of bankrupting them', async () => {
  const room = await newRoom();
  await allyUp(room);
  await arrange(room, {
    players: { fig0: { money: 20 }, fig1: { money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, pot: 0, round: 1 },
  });
  const r = await toNextRound(room);
  eq(r.game.alliances, [], 'dissolved');
  eq(money(r, 'fig0'), 20, 'the broke one paid nothing');
  eq(player(r, 'fig0').bankrupt, false, 'and is emphatically not bankrupt');
  eq(money(r, 'fig1'), 1000, 'the solvent one was never billed: seat 0 came up first');
  eq(potOf(r), 0);
  eq(ev(r, 'ally'), { type: 'ally', stage: 'dissolve', a: 'fig0', b: 'fig1', reason: 'upkeep' });
});

await test('upkeep already paid by the first member is not refunded when the second cannot pay', async () => {
  const room = await newRoom();
  await allyUp(room);
  await arrange(room, {
    players: { fig0: { money: 1000 }, fig1: { money: 20 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, pot: 0, round: 1 },
  });
  const r = await toNextRound(room);
  eq(r.game.alliances, [], 'dissolved');
  eq(money(r, 'fig0'), 950, 'seat 0 had already paid when seat 1 came up short');
  eq(money(r, 'fig1'), 20);
  eq(potOf(r), 50);
  eq(evs(r, 'allyUpkeep'), [{ type: 'allyUpkeep', figure: 'fig0', amount: 50 }]);
});

await test('shared debt: the ally covers the shortfall when the two of them can cover the charge', async () => {
  const room = await newRoom();
  await allyUp(room, 'fig0', 'fig2', 0);
  await arrange(room, {
    owners: { 6: 'fig1', 16: 'fig1', 26: 'fig1', 36: 'fig1' },
    players: {
      fig0: { position: 1, money: 100 }, fig1: { money: 1000 }, fig2: { money: 300 },
    },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  // four railroads rent 280, and fig0 is allied so they pay floor(280 * 1.25)
  eq((await rentDue(room, 26, 'fig0')).amount, 350);
  const r = await call(room, 'move', { playerId: 'p0', to: 26 });
  eq(player(r, 'fig0').bankrupt, false, 'nobody went under');
  eq(money(r, 'fig0'), 0, 'the payer is cleaned out');
  eq(money(r, 'fig2'), 50, 'the ally handed over exactly the 250 shortfall');
  eq(money(r, 'fig1'), 1350, 'and the landlord was paid in full');
  eq(ev(r, 'debtShare'), {
    type: 'debtShare', figure: 'fig0', ally: 'fig2', amount: 250, reason: 'rent',
  });
  eq(payOf(r, 'debtShare'), {
    type: 'pay', figure: 'fig2', to: 'fig0', amount: 250, reason: 'debtShare', cell: 26,
  });
  eq(r.game.alliances.length, 1, 'the alliance survives a bill it could cover');
});

await test('shared debt: when the two of them cannot cover it, the ally is untouched', async () => {
  const room = await newRoom();
  await allyUp(room, 'fig0', 'fig2', 0);
  await arrange(room, {
    owners: { 6: 'fig1', 16: 'fig1', 26: 'fig1', 36: 'fig1' },
    players: {
      fig0: { position: 1, money: 100 }, fig1: { money: 1000 }, fig2: { money: 100 },
    },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  const r = await call(room, 'move', { playerId: 'p0', to: 26 });
  eq(player(r, 'fig0').bankrupt, true, 'the payer went bankrupt exactly as before');
  eq(money(r, 'fig0'), 0);
  eq(money(r, 'fig2'), 100, 'and the ally lost nothing at all');
  eq(money(r, 'fig1'), 1100, 'the landlord got what there was');
  eq(evs(r, 'debtShare').length, 0, 'no shortfall was taken');
  eq(ev(r, 'bankrupt'), {
    type: 'bankrupt', figure: 'fig0', to: 'fig1', reason: 'rent', amount: 350,
  });
  eq(r.game.alliances, [], 'and the bankruptcy dissolves the pair');
  eq(evs(r, 'ally').map((e) => e.stage), ['dissolve']);
  eq(evs(r, 'ally')[0].reason, 'bankrupt');
});

await test('voluntary spending is never shared: a purchase and a bid stay personal', async () => {
  const room = await newRoom();
  await allyUp(room, 'fig0', 'fig2', 0);
  await arrange(room, {
    players: { fig0: { position: 27, money: 100 }, fig2: { money: 5000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, casino: null },
  });
  // cell 27 costs 260: the ally's 5000 must not make it buyable
  assert(SEED_BOARD['27'].price > 100, 'cell 27 is dearer than 100');
  await rejects(room, 'buy', { playerId: 'p0', cell: '27' }, 'Not enough money');
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  await call(room, 'auction_drop', { playerId: 'p1' });
  await call(room, 'auction_drop', { playerId: 'p2' });
  await call(room, 'auction_drop', { playerId: 'p3' });
  // fig0 is the last bidder standing and is allied to 5000$ they cannot touch
  await rejects(room, 'auction_bid', { playerId: 'p0', amount: 200 }, 'Not enough money');
});

await test('a forced charge that is not rent is shared too', async () => {
  const room = await newRoom();
  await allyUp(room, 'fig0', 'fig2', 0);
  await arrange(room, {
    players: { fig0: { position: 1, money: 50 }, fig2: { money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, pot: 0 },
  });
  const r = await call(room, 'move', { playerId: 'p0', to: 5 });   // Tax, 200
  eq(money(r, 'fig0'), 0);
  eq(money(r, 'fig2'), 850, 'the ally covered the 150 shortfall');
  eq(potOf(r), 200, 'and the whole fine still reached the pot');
  eq(ev(r, 'debtShare').reason, 'tax');
});

await test('allies win together: the game is over when the survivors are one allied pair', async () => {
  const room = await newRoom();
  await allyUp(room);
  await arrange(room, {
    players: { fig2: { bankrupt: true, money: 0 }, fig3: { bankrupt: true, money: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, auction: null, trade: null, winner: null },
  });
  const r = await call(room, 'skip_turn', {});
  eq(r.game.phase, 'over');
  eq(r.game.winners, ['fig0', 'fig1'], 'both of them');
  eq(r.game.winner, 'fig0', 'and the legacy field keeps the first');
  eq(ev(r, 'win'), { type: 'win', figure: 'fig0', figures: ['fig0', 'fig1'] });
});

await test('two survivors who are NOT allies still have a game to play', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig2: { bankrupt: true, money: 0 }, fig3: { bankrupt: true, money: 0 } },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, auction: null, trade: null, winner: null },
  });
  const r = await call(room, 'skip_turn', {});
  eq(r.game.phase, 'roll', 'still running');
  eq(r.game.winners, []);
  eq(r.game.winner, null);
});

await test('one survivor still wins alone, and winners carries just them', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: {
      fig1: { bankrupt: true, money: 0 }, fig2: { bankrupt: true, money: 0 },
      fig3: { bankrupt: true, money: 0 },
    },
    current_order: 0,
    game: { phase: 'roll', doubles: 0, auction: null, trade: null, winner: null },
  });
  const r = await call(room, 'skip_turn', {});
  eq(r.game.phase, 'over');
  eq(r.game.winners, ['fig0']);
  eq(r.game.winner, 'fig0');
});

await test('a player who leaves takes the alliance with them', async () => {
  const room = await newRoom();
  await allyUp(room);
  const r = await call(room, 'leave', { playerId: 'p1' });
  eq(r.game.alliances, [], 'dissolved');
  eq(ev(r, 'ally'), { type: 'ally', stage: 'dissolve', a: 'fig0', b: 'fig1', reason: 'left' });
});

// ---------------------------------------------------------------------------

section('war');

await test('war_declare costs 500 to the BANK and writes the two sides and the end round', async () => {
  const room = await newRoom();
  await allyUp(room, 'fig1', 'fig2', 1);
  await arrange(room, {
    players: { fig0: { money: 1000 }, fig3: { money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, pot: 0, round: 1 },
  });
  const r = await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  eq(money(r, 'fig0'), 500, 'the fee left the declarer');
  eq(potOf(r), 0, 'and went to the bank, NOT to Free Parking');
  eq(r.game.wars.length, 1);
  const w = r.game.wars[0];
  eq(w.declarer, 'fig0');
  eq(w.target, 'fig1');
  eq(w.startRound, 1);
  eq(w.endsRound, 6, 'startRound + 5');
  eq(w.peace, null);
  eq(ev(r, 'war'), {
    type: 'war', stage: 'declare', declarer: 'fig0', target: 'fig1',
    sideA: ['fig0'], sideB: ['fig1', 'fig2'], endsRound: 6,
  });
  eq(payOf(r, 'warFee'), {
    type: 'pay', figure: 'fig0', to: null, amount: 500, reason: 'warFee', cell: null,
  });
});

await test('war guards: your own ally, yourself, a ghost, a broke wallet, somebody else’s turn', async () => {
  const room = await newRoom();
  await allyUp(room);
  await arrange(room, {
    players: { fig0: { money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  await rejects(room, 'war_declare', { playerId: 'p0', target: 'fig1' },
    'You cannot declare war on your ally');
  await rejects(room, 'war_declare', { playerId: 'p0', target: 'fig0' },
    'You cannot declare war on yourself');
  await rejects(room, 'war_declare', { playerId: 'p0', target: 'fig9' },
    'That player is not in this room');
  await rejects(room, 'war_declare', { playerId: 'p1', target: 'fig2' },
    'You can only declare war on your turn');
  await arrange(room, { players: { fig0: { money: 499 } } });
  await rejects(room, 'war_declare', { playerId: 'p0', target: 'fig2' }, 'Not enough money');
});

await test('nobody on either prospective side may already be at war', async () => {
  const room = await newRoom(SIX);
  await allyUp(room, 'fig1', 'fig2', 1);
  await arrange(room, {
    players: {
      fig0: { money: 2000 }, fig3: { money: 2000 },
      fig4: { money: 2000 }, fig5: { money: 2000 },
    },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });

  await arrange(room, { current_order: 3, game: { phase: 'act' } });
  await rejects(room, 'war_declare', { playerId: 'p3', target: 'fig0' },
    'Somebody here is already at war');
  // fig2 is nobody's principal - they are only fig1's ally - and that is
  // exactly the case this guard has to catch
  await rejects(room, 'war_declare', { playerId: 'p3', target: 'fig2' },
    'Somebody here is already at war');
  // fig4 and fig5 are clear of it, so their war is fine
  await arrange(room, { current_order: 4, game: { phase: 'act' } });
  const r = await call(room, 'war_declare', { playerId: 'p4', target: 'fig5' });
  eq(r.game.wars.length, 2, 'two separate wars can run at once');
});

await test('rent doubles across the lines, for principals and for a dragged-in ally', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { 26: 'fig0' },
    players: { fig0: { money: 2000 }, fig1: { money: 2000 }, fig2: { money: 2000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  eq((await rentDue(room, 26, 'fig1')), { amount: 70, zero: false, mods: ['war'] },
    'the target pays double');
  eq((await rentDue(room, 26, 'fig2')), { amount: 35, zero: false, mods: [] },
    'a bystander pays the plain rate');

  // fig1 pulls fig2 onto their side
  await arrange(room, { current_order: 1, game: { phase: 'act' } });
  await call(room, 'ally_propose', { playerId: 'p1', to: 'fig2' });
  await call(room, 'ally_accept', { playerId: 'p2', from: 'fig1' });
  eq(await rentDue(room, 26, 'fig2'),
    { amount: 87, zero: false, mods: ['war', 'allyTax'] },
    'dragged in: floor(35 x 2 x 1.25), floored once');

  // and drops them again
  await arrange(room, { current_order: 2, game: { phase: 'act' } });
  await call(room, 'ally_break', { playerId: 'p2' });
  eq(await rentDue(room, 26, 'fig2'), { amount: 35, zero: false, mods: [] },
    'out of the alliance is out of the war');
});

await test('a real landing across the lines moves the doubled money and carries the mods', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { 26: 'fig0' },
    players: { fig0: { money: 2000 }, fig1: { position: 1, money: 2000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  const r = await call(room, 'move', { playerId: 'p1', to: 26 });
  eq(money(r, 'fig1'), 1930, 'paid 70');
  eq(payOf(r, 'rent'), {
    type: 'pay', figure: 'fig1', to: 'fig0', amount: 70, reason: 'rent', cell: 26,
    mods: ['war'],
  });
});

await test('the traitor brand stacks with a war, multiplicatively', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { 26: 'fig0' },
    players: {
      fig0: { money: 2000 },
      fig1: { money: 2000, traitor: true, traitorUntil: 9 },
    },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  eq(await rentDue(room, 26, 'fig1'),
    { amount: 43, zero: false, mods: ['traitor'] }, 'the brand alone is floor(35 x 1.25)');
  await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  eq(await rentDue(room, 26, 'fig1'),
    { amount: 87, zero: false, mods: ['war', 'traitor'] }, 'floor(35 x 2 x 1.25)');
});

await test('the modifiers multiply in the order the spec lists, floored exactly once', async () => {
  const room = await newRoom();
  // A state no legal game can reach - a traitor may never ally - arranged by
  // hand purely to pin the arithmetic: 35 x 2 x 1.25 x 1.25 = 109.375 -> 109.
  await arrange(room, {
    owners: { 26: 'fig0' },
    players: { fig1: { traitor: true, traitorUntil: 9 } },
    current_order: 0,
    game: {
      phase: 'act', doubles: 0, auction: null, trade: null, round: 1,
      alliances: [{ a: 'fig1', b: 'fig2', since: 1 }],
      wars: [{
        id: 1, declarer: 'fig0', target: 'fig1', startRound: 1, endsRound: 6, peace: null,
      }],
    },
  });
  eq(await rentDue(room, 26, 'fig1'),
    { amount: 109, zero: false, mods: ['war', 'allyTax', 'traitor'] });
  // and an ally of the owner still pays nothing, whatever else is true
  await arrange(room, {
    game: { alliances: [{ a: 'fig0', b: 'fig1', since: 1 }] },
  });
  eq(await rentDue(room, 26, 'fig1'), { amount: 0, zero: true, mods: [] },
    'free between allies beats everything');
});

await test('opposite sides of a war cannot ally, and nobody may end up in two wars', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: {
      fig0: { money: 2000 }, fig1: { money: 2000 },
      fig2: { money: 2000 }, fig3: { money: 2000 },
    },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  await rejects(room, 'ally_propose', { playerId: 'p0', to: 'fig1' },
    'You are on opposite sides of a war');

  await arrange(room, { current_order: 2, game: { phase: 'act' } });
  await call(room, 'war_declare', { playerId: 'p2', target: 'fig3' });
  await arrange(room, { current_order: 0, game: { phase: 'act' } });
  await rejects(room, 'ally_propose', { playerId: 'p0', to: 'fig2' },
    'That would put you in two wars at once');
  // joining ONE war by allying with somebody already in it stays legal: the
  // second war is what makes the pairing impossible, not the first
  await arrange(room, { current_order: 1, game: { phase: 'act' } });
  await call(room, 'ally_propose', { playerId: 'p1', to: 'fig9' })
    .then(() => { throw new Error('fig9 is not in the room'); }, () => {});
});

await test('a war expires at the start of its endsRound, not before', async () => {
  const room = await newRoom();
  await arrange(room, {
    current_order: 0,
    game: {
      phase: 'roll', doubles: 0, auction: null, trade: null, round: 1,
      wars: [{
        id: 7, declarer: 'fig0', target: 'fig1', startRound: 1, endsRound: 3, peace: null,
      }],
    },
  });
  let r = await toNextRound(room);
  eq(r.game.round, 2);
  eq(r.game.wars.length, 1, 'round 2 is still wartime');
  r = await toNextRound(room);
  eq(r.game.round, 3);
  eq(r.game.wars, [], 'and round 3 is not');
  eq(ev(r, 'war'), { type: 'war', stage: 'expire', warId: 7 });
});

await test('peace: either principal offers, the other accepts, and the payment changes hands', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { money: 2000 }, fig1: { money: 2000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  let r = await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  const id = r.game.wars[0].id;

  await arrange(room, { current_order: 2, game: { phase: 'act' } });
  await rejects(room, 'peace_propose', { playerId: 'p2', warId: id, amount: 0 },
    'Only the two sides can make peace');
  await arrange(room, { current_order: 0, game: { phase: 'act' } });
  await rejects(room, 'peace_propose', { playerId: 'p0', warId: 999, amount: 0 },
    'There is no such war');
  await rejects(room, 'peace_propose', { playerId: 'p0', warId: id, amount: 5000 },
    'You do not have that much cash');
  await rejects(room, 'peace_propose', { playerId: 'p0', warId: id, amount: -5 },
    'A peace payment cannot be negative');

  r = await call(room, 'peace_propose', { playerId: 'p0', warId: id, amount: 200 });
  eq(r.game.wars[0].peace, { from: 'fig0', amount: 200 });
  eq(ev(r, 'war'), { type: 'war', stage: 'peaceOffer', warId: id, from: 'fig0', amount: 200 });

  await rejects(room, 'peace_accept', { playerId: 'p0', warId: id }, 'not yours to answer');
  await rejects(room, 'peace_accept', { playerId: 'p2', warId: id }, 'not yours to answer');

  const before = money(await row(room), 'fig0');
  r = await call(room, 'peace_accept', { playerId: 'p1', warId: id });
  eq(r.game.wars, [], 'the war is over');
  eq(money(r, 'fig0'), before - 200);
  eq(money(r, 'fig1'), 2200);
  eq(payOf(r, 'peace'), {
    type: 'pay', figure: 'fig0', to: 'fig1', amount: 200, reason: 'peace', cell: null,
  });
  eq(evs(r, 'war').map((e) => e.stage), ['peace']);
  eq(evs(r, 'war')[0], { type: 'war', stage: 'peace', warId: id, amount: 200 });
});

await test('peace can be declined, and a declined offer leaves the war running', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { money: 2000 }, fig1: { money: 2000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  let r = await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  const id = r.game.wars[0].id;
  await rejects(room, 'peace_accept', { playerId: 'p1', warId: id },
    'There is no peace offer to answer');
  await call(room, 'peace_propose', { playerId: 'p0', warId: id, amount: 0 });
  r = await call(room, 'peace_decline', { playerId: 'p1', warId: id });
  eq(r.game.wars.length, 1, 'still at war');
  eq(r.game.wars[0].peace, null, 'but the offer is gone');
  eq(ev(r, 'war'), { type: 'war', stage: 'peaceDecline', warId: id, from: 'fig0', amount: 0 });
  eq(money(r, 'fig0'), 1500, 'no payment moved');
});

await test('a peace offer the proposer can no longer afford is refused, not quietly shrunk', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { money: 2000 }, fig1: { money: 2000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  let r = await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  const id = r.game.wars[0].id;
  await call(room, 'peace_propose', { playerId: 'p0', warId: id, amount: 1000 });
  await arrange(room, { players: { fig0: { money: 10 } } });
  await rejects(room, 'peace_accept', { playerId: 'p1', warId: id },
    'They can no longer pay what they promised');
  eq((await row(room)).game.wars.length, 1, 'the war and the offer both stand');
});

await test('a principal going bankrupt ends the war', async () => {
  const room = await newRoom();
  await arrange(room, {
    owners: { 6: 'fig2', 16: 'fig2', 26: 'fig2', 36: 'fig2' },
    players: {
      fig0: { money: 2000 }, fig1: { position: 1, money: 100 }, fig2: { money: 1000 },
    },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  let r = await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  const id = r.game.wars[0].id;
  r = await call(room, 'move', { playerId: 'p1', to: 26 });
  eq(player(r, 'fig1').bankrupt, true);
  eq(r.game.wars, [], 'the war died with them');
  eq(evs(r, 'war'), [{ type: 'war', stage: 'end', warId: id, reason: 'bankrupt' }]);
});

await test('a principal leaving the room ends the war', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { money: 2000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  let r = await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  const id = r.game.wars[0].id;
  r = await call(room, 'leave', { playerId: 'p1' });
  eq(r.game.wars, []);
  eq(evs(r, 'war'), [{ type: 'war', stage: 'end', warId: id, reason: 'left' }]);
});

// ---------------------------------------------------------------------------

section('backstab');

await test('backstab takes floor(15%) of the ally’s cash, breaks the pair and brands the taker', async () => {
  const room = await newRoom();
  await allyUp(room);
  await arrange(room, {
    players: { fig0: { money: 1000 }, fig1: { money: 777 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 2 },
  });
  const r = await call(room, 'backstab', { playerId: 'p0' });
  eq(money(r, 'fig0'), 1116, 'floor(777 x 15%) = 116');
  eq(money(r, 'fig1'), 661);
  eq(r.game.alliances, [], 'the alliance is gone');
  eq(player(r, 'fig0').traitor, true, 'branded');
  eq(player(r, 'fig0').traitorUntil, 7, 'round 2 + 5');
  eq(player(r, 'fig0').backstabUsed, true);
  eq(player(r, 'fig1').traitor, false, 'the victim is not the traitor');
  eq(ev(r, 'backstab'), {
    type: 'backstab', figure: 'fig0', victim: 'fig1', amount: 116,
  });
  eq(payOf(r, 'backstab'), {
    type: 'pay', figure: 'fig1', to: 'fig0', amount: 116, reason: 'backstab', cell: null,
  });
  eq(evs(r, 'ally').length, 0, 'the story is told once, by the backstab event');
});

await test('backstab needs an alliance, your own turn, and is available exactly once', async () => {
  const room = await newRoom();
  await rejects(room, 'backstab', { playerId: 'p0' }, 'You are not in an alliance');
  await allyUp(room);
  await rejects(room, 'backstab', { playerId: 'p1' }, 'You can only backstab on your turn');
  await arrange(room, {
    players: { fig1: { money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  await call(room, 'backstab', { playerId: 'p0' });

  // a traitor may never ally again, from either end
  await arrange(room, { current_order: 0, game: { phase: 'act' } });
  await rejects(room, 'ally_propose', { playerId: 'p0', to: 'fig2' },
    'You are a traitor, nobody will ally with you');
  await arrange(room, { current_order: 2, game: { phase: 'act' } });
  await rejects(room, 'ally_propose', { playerId: 'p2', to: 'fig0' },
    'They are a traitor, nobody will ally with them');

  // and the gambit itself is spent, even if a pair somehow reappeared
  await arrange(room, {
    current_order: 0,
    game: { phase: 'act', alliances: [{ a: 'fig0', b: 'fig3', since: 1 }] },
  });
  await rejects(room, 'backstab', { playerId: 'p0' }, 'You only have one backstab in you');
});

await test('the brand costs +25% rent to everybody, and burns out after five rounds', async () => {
  const room = await newRoom();
  await allyUp(room);
  await arrange(room, {
    owners: { 26: 'fig2' },
    players: { fig0: { position: 1, money: 2000 }, fig1: { money: 1000 }, fig2: { money: 1000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  let r = await call(room, 'backstab', { playerId: 'p0' });
  eq(player(r, 'fig0').traitorUntil, 6);
  eq(await rentDue(room, 26, 'fig0'),
    { amount: 43, zero: false, mods: ['traitor'] }, 'floor(35 x 1.25) to everybody');

  // rounds 2, 3, 4 and 5 still burn
  for (let want = 2; want <= 5; want += 1) {
    r = await toNextRound(room);
    eq(r.game.round, want);
    eq((await rentDue(room, 26, 'fig0')).mods, ['traitor'], `still branded in round ${want}`);
  }
  r = await toNextRound(room);
  eq(r.game.round, 6);
  eq(player(r, 'fig0').traitorUntil, 0, 'the clock ran out');
  eq(player(r, 'fig0').traitor, true, 'but the ban on allying is for good');
  eq(await rentDue(room, 26, 'fig0'), { amount: 35, zero: false, mods: [] });
  eq(ev(r, 'traitor'), { type: 'traitor', stage: 'expire', figure: 'fig0' });
});

// ---------------------------------------------------------------------------

section('diplomacy guards & state');

const OWN_TURN_VERBS = [
  ['ally_propose', { to: 'fig1' }],
  ['ally_break', {}],
  ['war_declare', { target: 'fig1' }],
  ['peace_propose', { warId: 1, amount: 0 }],
  ['backstab', {}],
];

await test('every own-turn verb bounces off a running auction', async () => {
  const room = await newRoom();
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  eq((await row(room)).game.phase, 'auction');
  for (const [action, extra] of OWN_TURN_VERBS) {
    await rejects(room, action, { playerId: 'p0', ...extra }, 'An auction is running');
  }
});

await test('every own-turn verb bounces off a pending casino bet', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { position: 13, money: 1000 } },
    current_order: 0,
    game: {
      phase: 'casino', doubles: 0, auction: null, trade: null,
      casino: { cell: 13, figure: 'fig0', min: 150, max: 1000 },
    },
  });
  eq((await row(room)).game.phase, 'casino');
  for (const [action, extra] of OWN_TURN_VERBS) {
    await rejects(room, action, { playerId: 'p0', ...extra }, 'The casino is waiting');
  }
});

await test('answering a proposal is still legal while the room is locked', async () => {
  const room = await newRoom();
  await arrange(room, { current_order: 0, game: { phase: 'act', doubles: 0, auction: null, trade: null } });
  await call(room, 'ally_propose', { playerId: 'p0', to: 'fig1' });
  await standOn(room, 'fig0', 27);
  await call(room, 'auction_start', { playerId: 'p0', cell: 27 });
  const r = await call(room, 'ally_accept', { playerId: 'p1', from: 'fig0' });
  eq(r.game.alliances.length, 1, 'the handshake went through');
  eq(r.game.phase, 'auction', 'and the auction is untouched');
});

await test('nothing diplomatic happens after the game is over', async () => {
  const room = await newRoom();
  await arrange(room, {
    current_order: 0,
    game: { phase: 'over', doubles: 0, auction: null, trade: null, winner: 'fig0' },
  });
  for (const [action, extra] of OWN_TURN_VERBS) {
    await rejects(room, action, { playerId: 'p0', ...extra }, 'The game is over');
  }
  await rejects(room, 'ally_accept', { playerId: 'p1', from: 'fig0' }, 'The game is over');
});

await test('a bankrupt player has no diplomacy left', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { bankrupt: true, money: 0 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null },
  });
  await rejects(room, 'ally_propose', { playerId: 'p0', to: 'fig1' }, 'You are bankrupt');
  await rejects(room, 'backstab', { playerId: 'p0' }, 'You are bankrupt');
});

await test('a fresh seat carries the three diplomacy flags', async () => {
  const room = await newRoom();
  const r = await row(room);
  for (const p of r.players) {
    eq([p.traitor, p.traitorUntil, p.backstabUsed], [false, 0, false], `${p.figure}`);
  }
  eq(r.game.round, 1, 'and the table starts on round 1');
  eq(r.game.alliances, []);
  eq(r.game.allyOffers, []);
  eq(r.game.wars, []);
  eq(r.game.winners, []);
});

await test('new_game clears the alliances, the offers, the wars, the round and the brands', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { traitor: true, traitorUntil: 9, backstabUsed: true } },
    current_order: 0,
    game: {
      phase: 'act', doubles: 0, auction: null, trade: null, round: 7,
      alliances: [{ a: 'fig0', b: 'fig1', since: 2 }],
      allyOffers: [{ from: 'fig2', to: 'fig3' }],
      wars: [{ id: 3, declarer: 'fig2', target: 'fig3', startRound: 4, endsRound: 9, peace: null }],
      winners: ['fig0'],
    },
  });
  const r = await call(room, 'new_game', { position: SEED_BOARD });
  eq(r.game.round, 1);
  eq(r.game.alliances, []);
  eq(r.game.allyOffers, []);
  eq(r.game.wars, []);
  eq(r.game.winners, []);
  eq(r.game.winner, null);
  for (const p of r.players) {
    eq([p.traitor, p.traitorUntil, p.backstabUsed], [false, 0, false], `${p.figure} reset`);
  }
});

await test('a row from before this migration keeps working and grows the new keys', async () => {
  const room = await newRoom();
  // strip every key this migration added, the way an in-flight room from
  // yesterday would have it
  const before = await row(room);
  const legacyGame = { ...before.game };
  for (const k of ['round', 'alliances', 'allyOffers', 'wars', 'winners']) delete legacyGame[k];
  const legacyPlayers = before.players.map((p) => {
    const q = { ...p };
    delete q.traitor;
    delete q.traitorUntil;
    delete q.backstabUsed;
    return q;
  });
  await db.query(
    `update public.test set game = $2::jsonb, "Players" = $3::jsonb where uuid = $1`,
    [room, JSON.stringify(legacyGame), JSON.stringify(legacyPlayers)],
  );
  const stale = await row(room);
  assert(!('alliances' in stale.game), 'the row really is missing the keys');
  assert(!('traitor' in stale.players[0]), 'and so are the players');

  // rent still works out of a state with no game.alliances at all
  eq(await rentDue(room, 26, 'fig0'), { amount: 0, zero: false, mods: [] }, 'unowned, so 0');

  const r = await call(room, 'skip_turn', {});
  eq(r.game.round, 1, 'the counter appeared, defaulted to 1');
  eq(r.game.alliances, []);
  eq(r.game.allyOffers, []);
  eq(r.game.wars, []);
  eq(r.game.winners, []);
  // the player flags are only written by join / new_game / backstab, so a
  // legacy seat stays bare until then - and every read of them coalesces
  await arrange(room, { current_order: 0, game: { phase: 'act' } });
  const r2 = await call(room, 'ally_propose', { playerId: 'p0', to: 'fig1' });
  eq(r2.game.allyOffers, [{ from: 'fig0', to: 'fig1' }], 'a bare seat can still ally');
});

await test('the round ticks on a real end_turn, and a doubles re-roll is not a new round', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig3: { inJail: false, jailTurns: 0 } },
    current_order: 3,
    game: { phase: 'act', doubles: 1, dice: [2, 2], auction: null, trade: null, round: 1 },
  });
  // the last seat rolled a double: the turn stays with them, so the lap is not
  // over and neither is the round
  let r = await call(room, 'end_turn', { playerId: 'p3' });
  eq(r.current_order, 3, 'still their turn');
  eq(r.game.round, 1, 'and still the same round');
  assert(types(r).includes('again'), 'the doubles event fired');

  await arrange(room, { current_order: 3, game: { phase: 'act', doubles: 0 } });
  r = await call(room, 'end_turn', { playerId: 'p3' });
  eq(r.current_order, 0, 'back to the top of the order');
  eq(r.game.round, 2, 'which is what ends a round');
});

await test('the round wraps to the first player who is still in the game, not to seat 0', async () => {
  const room = await newRoom();
  await arrange(room, {
    players: { fig0: { bankrupt: true, money: 0 } },
    current_order: 3,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1, winner: null },
  });
  const r = await call(room, 'end_turn', { playerId: 'p3' });
  eq(r.current_order, 1, 'seat 0 is out, so seat 1 opens the lap');
  eq(r.game.round, 2, 'and arriving there is what ends the round');
});

await test('a legacy row that already had a winner grows a matching winners array', async () => {
  const room = await newRoom();
  const before = await row(room);
  const legacy = { ...before.game, winner: 'fig2' };
  delete legacy.winners;
  await db.query(`update public.test set game = $2::jsonb where uuid = $1`,
    [room, JSON.stringify(legacy)]);
  const r = await call(room, 'skip_turn', {});
  eq(r.game.winner, 'fig2', 'the old field is left alone');
  eq(r.game.winners, ['fig2'], 'and the array is derived from it');
  eq(r.game.phase, 'over', 'a row with a winner is an over row');
});

await test('a war and an alliance survive an ordinary turn and ride along in game', async () => {
  const room = await newRoom();
  await allyUp(room, 'fig1', 'fig2', 1);
  await arrange(room, {
    players: { fig0: { money: 2000 } },
    current_order: 0,
    game: { phase: 'act', doubles: 0, auction: null, trade: null, round: 1 },
  });
  await call(room, 'war_declare', { playerId: 'p0', target: 'fig1' });
  const r = await call(room, 'skip_turn', {});
  eq(r.game.wars.length, 1, 'the war is still on the row');
  eq(r.game.alliances.length, 1);
  eq(r.game.round, 1, 'and one hand-off is not a round');
});

// ---------------------------------------------------------------------------
// 12. Regression smoke: a few hundred random legal-ish actions
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
  'The casino is waiting', 'The casino is not waiting for you',
  'Pick slots, roulette or wheel', 'Pick red, black or green',
  'The bet must be a whole number', 'casino_play needs a bet', 'Bet at least',
  // diplomacy
  'You can only propose an alliance on your turn', 'You cannot ally with yourself',
  'You are already in an alliance', 'They are already in an alliance',
  'There is already an offer between you', 'There is no offer to answer',
  'There is no offer to cancel', 'You are not in an alliance',
  'You can only break an alliance on your turn', 'You are a traitor',
  'They are a traitor', 'You are on opposite sides of a war',
  'That would put you in two wars at once', 'You can only declare war on your turn',
  'You cannot declare war on your ally', 'You cannot declare war on yourself',
  'Somebody here is already at war', 'You only have one backstab in you',
  'You can only backstab on your turn', 'You can only offer peace on your turn',
  'There is no such war', 'Only the two sides can make peace',
  'There is no peace offer to answer', 'A peace payment cannot be negative',
  'The payment must be a whole number', 'They can no longer pay what they promised',
  'You cannot do that right now',
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

    if (phase === 'casino' && g.casino) {
      // Landing on the casino is mandatory, so the walk has exactly two legal
      // replies: play, or (rarely) let the table skip a phone that went away.
      const better = before.players.find((p) => p.figure === g.casino.figure);
      if (!better || rnd() < 0.08) {
        action = 'skip_turn'; payload = {};
      } else {
        const game = pick(['slots', 'roulette', 'wheel']);
        const span = Math.max(g.casino.max - g.casino.min, 0);
        action = 'casino_play';
        payload = {
          playerId: better.playerId,
          game,
          bet: g.casino.min + Math.floor(rnd() * (span + 1)),
          colour: pick(['red', 'black', 'green']),
        };
      }
    } else if (phase === 'auction' && g.auction) {
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
    } else if (rnd() < 0.18) {
      // Diplomacy. Every verb here is either an own-turn verb (and `cur` is
      // whose turn it is) or an answer to something already on the table, so
      // the walk produces a stream of plausible-but-not-always-legal calls -
      // which is the point: the refusals are as much of the contract as the
      // acceptances, and `known()` has to recognise every one of them.
      const other = pick(alive.filter((p) => p.figure !== cur.figure));
      const mine = (g.allyOffers || []).find((o) => o.to === cur.figure);
      const myWar = (g.wars || []).find(
        (w) => w.declarer === cur.figure || w.target === cur.figure);
      const allied = (g.alliances || []).find(
        (a) => a.a === cur.figure || a.b === cur.figure);
      const r = rnd();
      if (mine && r < 0.45) {
        action = r < 0.3 ? 'ally_accept' : 'ally_decline';
        payload = { playerId: cur.playerId, from: mine.from };
      } else if (myWar && myWar.peace && myWar.peace.from !== cur.figure && r < 0.58) {
        action = r < 0.5 ? 'peace_accept' : 'peace_decline';
        payload = { playerId: cur.playerId, warId: myWar.id };
      } else if (myWar && r < 0.68) {
        action = 'peace_propose';
        payload = { playerId: cur.playerId, warId: myWar.id, amount: 10 * Math.floor(rnd() * 5) };
      } else if (allied && r < 0.74) {
        action = 'backstab'; payload = { playerId: cur.playerId };
      } else if (allied && r < 0.80) {
        action = 'ally_break'; payload = { playerId: cur.playerId };
      } else if (other && r < 0.92) {
        action = 'ally_propose'; payload = { playerId: cur.playerId, to: other.figure };
      } else if (other) {
        action = 'war_declare'; payload = { playerId: cur.playerId, target: other.figure };
      } else {
        action = 'skip_turn'; payload = {};
      }
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
    for (const k of ['round', 'alliances', 'allyOffers', 'wars', 'winners']) {
      assert(k in after.game, `game.${k} is always present`);
    }
    assert(after.game.round >= 1, 'the round counter never goes backwards past 1');
    // one alliance per player, and never with somebody who is not there
    const seats = new Set(after.players.map((p) => p.figure));
    const paired = new Set();
    for (const a of after.game.alliances) {
      for (const f of [a.a, a.b]) {
        assert(seats.has(f), `alliance names ${f}, who is not in the room`);
        assert(!paired.has(f), `${f} is in two alliances`);
        paired.add(f);
      }
      const pa = after.players.find((p) => p.figure === a.a);
      const pb = after.players.find((p) => p.figure === a.b);
      assert(!pa.bankrupt && !pb.bankrupt, 'a bankrupt player is still allied');
      assert(!pa.traitor && !pb.traitor, 'a traitor is still allied');
    }
    for (const w of after.game.wars) {
      assert(seats.has(w.declarer) && seats.has(w.target), 'a war names a ghost');
    }
    if (after.game.auction) {
      const a = after.game.auction;
      assert(a.in.every((f) => a.order.includes(f)), '`in` is a subset of `order`');
      assert(a.turn === null || a.in.includes(a.turn), '`turn` is in `in`');
      assert(a.turn !== a.leader, 'the leader is never asked to bid');
    }
    assert((after.game.log || []).length <= 40, 'log capped');
  }

  assert(applied > 200, `only ${applied} actions went through`);
  // Only events the walk STEERS towards are required here. Whether 600 random
  // steps ever land on cell 13 or cell 28 is luck, and sections 9 and 10 pin
  // those two down exactly; making them mandatory here would only buy a test
  // that fails on some seeds and passes on others.
  for (const t of ['auction_start', 'bid', 'drop', 'trade', 'ally']) {
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
