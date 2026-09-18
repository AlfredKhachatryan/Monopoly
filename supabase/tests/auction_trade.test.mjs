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

/** Fresh room with `names.length` players joined through the real `join` action. */
async function newRoom(names = ['Ero', 'Koli', 'Gaya', 'Afo']) {
  const room = 'rm' + String(++roomSeq).padStart(4, '0');
  await db.query(
    `insert into public.test (uuid, position, "Players", current_order)
     values ($1, $2::jsonb, '[]'::jsonb, 0)`,
    [room, JSON.stringify(SEED_BOARD)],
  );
  for (let i = 0; i < names.length; i += 1) {
    await call(room, 'join', { name: names[i], figure: `fig${i}`, playerId: `p${i}` });
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
    for (const f of ['fig0', 'fig1', 'fig2', 'fig3']) board[cell].bought[f] = false;
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
// 3. Regression smoke: a few hundred random legal-ish actions
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

await test('a few hundred random actions keep the invariants', async () => {
  await db.query('select setseed(0.4242)');
  const room = await newRoom();
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
