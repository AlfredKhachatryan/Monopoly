// The right-hand column: which room this is, who is playing, what they own and
// what just happened.
//
// PROPS (contract with the shell): roomId board players game current controls
// error silent
//
// ---------------------------------------------------------------------------
// Everything has to fit, always
// ---------------------------------------------------------------------------
// The column is 1048px tall and never scrolls — a board on a wall with a
// scrollbar is a broken board. SIX players, each with a stake in every colour
// group on the board, is the worst case the game can produce, and the latest
// list still has to be there underneath. So the column squeezes, in this order:
//
//   1. the latest list gives up rows, down to a floor of two
//   2. property slots go 26px tall -> 24
//   3. the player cards tighten their padding and gaps, and the player token
//      drops from the figure manual's 56px to 48, then 44
//
// The type never shrinks: a board is read from across a room.
//
// It is measured, not guessed: the latest list sits in a `minmax(0, 1fr)` track,
// so its height IS the space left over once the header and the players have
// taken theirs. Reading that one number says both how many rows fit and whether
// the cards above need to give something back. The loop terminates because
// `dens` only ever increases within one set of data, and the row count does not
// feed back into the track height.
//
// ---------------------------------------------------------------------------
// The density step (2026-09-20, six players)
// ---------------------------------------------------------------------------
// The measured squeeze above is a safety net, not a plan: it reacts after the
// first paint, and a board that visibly re-lays itself when the sixth player
// joins looks broken even though it ends up right. So the STARTING density is
// now a function of how many seats are taken, and the squeeze only ever goes
// further from there:
//
//   up to 4 players   d0 — untouched, exactly the layout of the four-player
//                     board that has been played on so far
//   5 players         d1
//   6 players         d2
//
// The numbers, for a 500px column 1048px tall with 16px grid gaps:
//   header 81 (room line 27 + 10 + a 44px row of buttons) + 2x16 gap = 113,
//   leaving 935 for the player cards and the feed together.
//   A d2 card is 20 padding + 48 token + 8 + 26 of property slots = 102, so six
//   of them with five 8px gaps come to 652 and the feed keeps 283 — seven rows'
//   worth, against a floor of two. A d1 card is 120, so five come to 640 and the
//   feed keeps 295. A d0 card is 120 and four come to 510.
//
// That budget only holds because a card's property row is exactly ONE line
// high, which is what the group slots below are for.
//
// ---------------------------------------------------------------------------
// Diplomacy (2026-09-21)
// ---------------------------------------------------------------------------
// Alliance/war/traitor chips (`.plDiplo`) and the standing strip at the top
// (`.diploStrip`) are the one piece of this file's layout that is NOT part of
// the fixed budget above — they cost real height, but only for a player (or a
// room) that actually has something to report, and the MEASURED squeeze
// already reacts to whatever the player cards end up costing: it reads
// `latestRef`'s real height after layout, not a number written down here. So
// a room with an alliance or a war simply gives up a Latest row or two to it,
// exactly as it already does for a player holding a stake in every colour
// group. Nothing above assumed a fixed player-card height to begin with — see
// "one line, always" on `.props` — this is the same deal for one more row.
//
// ---------------------------------------------------------------------------
// Neutral names
// ---------------------------------------------------------------------------
// Event rows are the shared EventRow with `meFig: null`, which is what makes
// describeEvent say "Koli" where the phone would say "You". One sentence still
// leaks: a `trade` event with status `expired` quotes the server's reason
// verbatim, and the server writes those in the second person ("You do not own
// Далма Молл"). The TV has no second person, so the reason is dropped here
// before the row ever sees it.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { animate } from "framer-motion";
import { Cannabis, Crown, KeyRound, Link2, Lock, Skull, Swords, TrainFront } from "lucide-react";
import {
  JAIL_MAX_TURNS,
  accentFor,
  cellKind,
  nameOfFig,
  ownedBy,
  playerByFig,
  readableOn,
} from "../Hooks/rules";
import { allyOf, isTraitorNow, warSides, warsOf } from "../Hooks/diplomacy";
import { Pips, hasCyrillic } from "../Client/boardDisplay";
import { describeEvent, foldCardMoney } from "../Client/EventView";
import EventRow from "../Client/EventRow";
import Tok from "../Client/Tok";
import { fmt, fmtSigned } from "../Client/format";
import { useCardBeat } from "../Client/useReveal";
import * as figures from "../Client/figures";
import { useTvFeed, useTvReduce } from "./TvFeed";
import s from "./tvSide.module.css";

// "Imp" / "Cyclops" / "Specter" / "Yeti", once the shared figure module
// publishes them. A namespace import rather than a named one on purpose: the
// key is being added by another agent, and a named import of an export that
// does not exist yet is a build error, not an undefined.
const FIGURE_NAME = figures.FIGURE_NAME ?? {};

// The numbers the squeeze reasons with. They mirror tvSide.module.css: a row is
// 40px, rows are 8px apart, and the "Latest" label plus its gap is 26px.
const ROW_H = 40;
const ROW_GAP = 8;
const LABEL_H = 26;
const MIN_ROWS = 2;
// Eight, not four: at two or three players the cards leave most of the column
// empty (the owner's note off a real TV), and "what just happened" is the one
// thing on this screen that can honestly use the room. What actually lands is
// always the MEASURED fit, so a full six-player room still gets only what is
// left over, and never less than MIN_ROWS.
const MAX_ROWS = 8;

// Players outrank the log once the room is crowded (the owner's note off a
// real six-player screenshot: the cards were squeezed to make room for a
// feed nobody needed that tall). Five and six seats cap how far the feed may
// grow even when the measured space would allow more; four or fewer keep the
// old ceiling (MAX_ROWS), because that is exactly when the column has spare
// height and "what just happened" is the one thing that can honestly use it.
const maxRowsFor = (n) => (n >= 6 ? 3 : n >= 5 ? 4 : MAX_ROWS);

// Property-slot height per density step, mirroring --slot-h in the CSS.
const SW = [26, 26, 26, 24];
// Token size per density step. 56px is the figure manual's size for a TV player
// card; the tighter steps trim it rather than touch the type.
const TOK = [56, 56, 48, 44];
// Where a room of this size starts before anything is measured. See the
// header. Capping the feed above (maxRowsFor) frees back the space the old
// d1/d2 floors gave away to a longer "Latest" list than a crowded room ever
// needed — six players now starts one step roomier (d1, not d2) and five
// starts at the four-player layout (d0), with the MEASURED squeeze below
// still free to compress further if a real board's holdings need it.
const baseDens = (n) => (n >= 6 ? 1 : 0);

// ---------------------------------------------------------------------------
// Property slots
// ---------------------------------------------------------------------------
// One slot per GROUP the player has a stake in, never one per deed. A late-game
// player holds ten or more deeds and six of those players do not fit a 500px
// column at any chip size; there are only ever TEN groups on this board (eight
// colour sets, the railroads, the Weed Farm), so a slot per group is both a
// smaller worst case and a better answer to the question the room is actually
// asking, which is "who is close to a set".
//
//   part of a set   the group's colour, one brick per cell, the owned ones lit
//   the whole set   the bricks collapse into a solid chip of the group's colour
//                   with a crown on it, and the buildings on the set as pips
//
// Railroads (x/4) and the Weed Farm (x/1) are groups too and carry the same
// train and cannabis glyphs the board does, because after the palette rework
// (spec §11) every special shares one neutral steel or a muted green — colour
// alone no longer tells a railroad from a tax cell, and it never told the farm
// from the Green street group.
//
// The group colours are taken straight from accentFor() rather than restated
// here. They used to be two literals that quietly went stale the moment the
// palette moved: RAIL_ACCENT was the old gold #de951f (railroads are polished steel
// #c3d0de now) and UTIL_ACCENT the old azure #1f8fff, for two utilities that no
// longer exist. One source, in rules.js, is the only way that stays true.

// The widths below mirror tvSide.module.css exactly. They are only ever used to
// decide WHERE TO STOP, so being a pixel or two pessimistic is free; being
// optimistic would let a slot fall off the end of the card.
const SLOT_PAD = 6;
const SLOT_GAP = 5;
const BRICK_W = 7;
const BRICK_GAP = 2;
const GLYPH_W = 14;
const GLYPH_GAP = 3;
// The building pips are lucide glyphs now (spec §9), one `Home` per house and a
// single `Hotel` for the hotel, so a hotel is one icon wide rather than the old
// 16px bar. --pip in tvSide.module.css is the same 11 and .pips's gap the same
// 2; these three only exist so fitSlots() can decide where to stop.
const PIP_W = 11;
const PIP_GAP = 2;
const HOTEL_W = 11;
const MORE_W = 34; // the "+N" chip
// A card is 500 wide less its padding; the layout effect below measures the
// real number, and this is only what the very first paint assumes.
const PROPS_W = 464;

// Which group a cell belongs to, or null for "not ownable, so not a group".
//
// The Weed Farm is a group of ONE: it is bought at auction and traded like any
// other deed, so a player holding it has a stake to show. The Casino is not
// here on purpose and must never be — the bank is the house, nobody can own it,
// and a "casino" chip on a player card would be a lie. It falls out through the
// null below, exactly like Chance, Tax or Free Parking.
const groupKeyOf = (cell) => {
  const kind = cellKind(cell);
  if (kind === "street") return cell.color;
  if (kind === "road") return "road";
  if (kind === "farm") return "farm";
  return null;
};

// Every group on the board, in board order, with the cells in it. One pass per
// board change, shared by all six cards.
function boardGroups(board) {
  const out = [];
  const byKey = new Map();
  const ids = Object.keys(board || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  for (const id of ids) {
    const cell = board[id];
    const key = groupKeyOf(cell);
    if (key == null) continue;
    let g = byKey.get(key);
    if (!g) {
      const kind = cellKind(cell);
      // accentFor() already answers "a street wears its own colour, everything
      // else wears its kind's accent", so there is nothing to branch on here.
      g = { key, kind, color: accentFor(cell), cells: [] };
      byKey.set(key, g);
      out.push(g);
    }
    g.cells.push(cell);
  }
  return out;
}

// What one player holds in each group they are in, in board order.
function stakesOf(groups, fig) {
  const out = [];
  for (const g of groups) {
    let own = 0;
    let houses = 0;
    for (const cell of g.cells) {
      if (!cell.bought?.[fig]) continue;
      own++;
      houses = Math.max(houses, Math.round(Number(cell.houses)) || 0);
    }
    if (own === 0) continue;
    out.push({ ...g, own, total: g.cells.length, houses, full: own === g.cells.length });
  }
  return out;
}

function pipsWidth(houses) {
  if (houses >= 5) return HOTEL_W;
  if (houses <= 0) return 0;
  return houses * PIP_W + (houses - 1) * PIP_GAP;
}

// Mirrors .slot in tvSide.module.css.
function slotWidth(st) {
  if (st.full) {
    const pips = pipsWidth(st.houses);
    return SLOT_PAD * 2 + GLYPH_W + (pips > 0 ? GLYPH_GAP + pips : 0);
  }
  const bricks = st.total * BRICK_W + (st.total - 1) * BRICK_GAP;
  const glyph = st.kind === "street" ? 0 : GLYPH_W + GLYPH_GAP;
  return SLOT_PAD * 2 + glyph + bricks;
}

// How many slots fit on ONE line. The whole budget at the top of this file rests
// on the property row being one line high, so it is decided here, in numbers,
// rather than left to `flex-wrap` to discover after the fact. The worst the
// board can produce — a stake in all ten groups, none of them complete — comes
// to 431px of slots and gaps, inside the 464 a d0 card has.
function fitSlots(stakes, width) {
  let used = 0;
  for (let i = 0; i < stakes.length; i++) {
    const next = used + (i > 0 ? SLOT_GAP : 0) + slotWidth(stakes[i]);
    // Anything but the last one has to leave room for the "+N" beside it.
    const room = i === stakes.length - 1 ? width : width - SLOT_GAP - MORE_W;
    if (next > room) return i;
    used = next;
  }
  return stakes.length;
}

// `delay` is the count-up's one addition: when money moved because of a
// TRANSFER, the coins crossing the column (TvPayFx) are the story, and the
// number is what they turn into when they land. So the count waits for them
// rather than being finished before they have left. Zero for everything else.
//
// The flash ring is the same beat: a red or green wash round the card for as
// long as the delta chip lingers, so a player glancing up a second later can
// still see who gained and who lost.
//
// `silent` is the resync case (see TvFeed.js / BoardScreen.jsx): the room's
// money may have moved by a lot while this screen was catching up, and none
// of it is news. The design's own words for that moment are "no coins" —
// this is the coins, so a silent change snaps the number the same way the
// pieces snap on the board, with no count-up, no delta chip and no wash.
function TvCash({ value, reduce, className, delay = 0, silent = false }) {
  const target = Math.round(Number(value) || 0);
  const [shown, setShown] = useState(target);
  const [delta, setDelta] = useState(null);
  const prev = useRef(target);
  const wait = useRef(null);
  const clear = useRef(null);

  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) {
      setShown(target);
      return undefined;
    }
    if (silent) {
      clearTimeout(wait.current);
      clearTimeout(clear.current);
      setShown(target);
      setDelta(null);
      return undefined;
    }

    let run = null;
    const go = () => {
      setDelta(target - from);
      clearTimeout(clear.current);
      clear.current = setTimeout(() => setDelta(null), 2000);
      if (reduce) {
        setShown(target);
        return;
      }
      // A count-up, not a slot machine: react-animated-numbers spins each digit
      // separately and reads as noise at 48px across a room.
      run = animate(from, target, {
        duration: Math.min(0.9, 0.25 + Math.abs(target - from) / 2500),
        ease: [0.22, 1, 0.36, 1],
        onUpdate: (v) => setShown(Math.round(v)),
        onComplete: () => setShown(target),
      });
    };

    clearTimeout(wait.current);
    if (delay > 0 && !reduce) wait.current = setTimeout(go, delay);
    else go();

    return () => {
      clearTimeout(wait.current);
      run?.stop();
    };
    // `delay` arrives in the same commit as the new value and must not restart
    // the count on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reduce, silent]);

  useEffect(
    () => () => {
      clearTimeout(wait.current);
      clearTimeout(clear.current);
    },
    [],
  );

  return (
    <span className={s.cashBox} data-move={delta ? (delta > 0 ? "pos" : "neg") : undefined}>
      <span className={className}>{fmt(shown)}</span>
      {delta ? (
        <span className={`${s.cashDelta} ${delta > 0 ? s.cashPos : s.cashNeg}`}>
          {fmtSigned(delta)}
        </span>
      ) : null}
    </span>
  );
}

// The sub-line for a player who is in jail. `jailTurns` is how many failed
// rolls they have already served (0, 1 or 2), so what is LEFT is the useful
// number — a board says "two turns to go", not "one turn done".
function jailLine(p) {
  const served = Math.min(Math.max(Math.round(Number(p.jailTurns)) || 0, 0), JAIL_MAX_TURNS);
  const left = JAIL_MAX_TURNS - served;
  if (left <= 1) return "in jail · last turn";
  return `in jail · ${left} turns left`;
}

// The server writes an expired trade's reason in the second person. Nothing on
// this screen is addressed to anybody, so it goes.
function neutral(ev) {
  if (!ev || typeof ev !== "object") return null;
  if (ev.type === "trade" && ev.status === "expired" && ev.reason) {
    const { reason, ...rest } = ev;
    return rest;
  }
  return ev;
}

// One group, one chip. `style` carries the group's colour and the ink that
// stays readable on it; everything else is in tvSide.module.css.
function Slot({ st }) {
  const Glyph = st.kind === "road" ? TrainFront : st.kind === "farm" ? Cannabis : Crown;
  const label = `${st.own} of ${st.total}${st.full ? ", complete set" : ""}`;

  if (st.full) {
    return (
      <span
        className={s.slot}
        data-full=""
        style={{ "--g": st.color, "--on-g": readableOn(st.color) }}
        title={label}
      >
        <Glyph size={GLYPH_W} aria-hidden="true" />
        {st.houses > 0 && <Pips houses={st.houses} className={s.slotPips} />}
      </span>
    );
  }

  return (
    <span className={s.slot} style={{ "--g": st.color }} title={label}>
      {st.kind !== "street" && <Glyph size={GLYPH_W} aria-hidden="true" />}
      <span className={s.bricks}>
        {st.cells.map((cell, i) => (
          <i key={cell.id} data-on={i < st.own ? "" : undefined} />
        ))}
      </span>
    </span>
  );
}

export default function TvSide({
  roomId,
  board,
  players,
  game,
  current,
  controls,
  // Renders nothing while the room is live — see ConnectionBadge.
  badge = null,
  error,
  // How long the cash numbers wait before they count — see TvCash above.
  cashDelay = 0,
  // From the shell (BoardScreen.jsx): true while `game` carries a resync's
  // seq, so a row that only just arrived because the TV caught up does not
  // play the "fresh" slide-in as if it had just happened. See TvFeed.js.
  silent = false,
}) {
  const feed = useTvFeed(game, silent);
  const reduce = useTvReduce();
  // The card read beat, off the same schedule the board centre deals its card
  // faces from (src/Client/useReveal.js). Only `cut` is wanted here: how far
  // into the newest batch this column is allowed to have read out loud.
  const beat = useCardBeat(feed);

  const list = useMemo(
    () => [...(players || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)),
    [players],
  );
  // Shared win (spec §1): `game.winners` may carry one figure or an allied
  // pair; `game.winner` is kept populated with the first for backward
  // compatibility, so it is only the fallback here. Mirrors the same small
  // helper in TvCenter.jsx — not shared, on purpose: it is three lines and
  // Hooks/** belongs to another agent, so there is nothing to import it from.
  const winners = Array.isArray(game?.winners) && game.winners.length > 0
    ? game.winners
    : game?.winner
      ? [game.winner]
      : [];
  const over = game?.phase === "over" || !!game?.winner || winners.length > 0;

  // ---- the standing diplomacy strip (spec §3) ----------------------------
  // Quiet, persistent, and costs nothing when there is nothing to say: no
  // alliance and no war means the strip renders nothing at all, not even
  // "Round 1" — a round counter nobody is spending on diplomacy is not
  // information this screen owes the room. `round` itself only matters
  // alongside a war's countdown, so it lives in the same gate.
  const round = Number(game?.round) || 1;
  const allyRows = (Array.isArray(game?.alliances) ? game.alliances : []).map((al) => ({
    key: `${al.a}-${al.b}`,
    text: `${nameOfFig(list, al.a)} + ${nameOfFig(list, al.b)}`,
  }));
  const warRows = (Array.isArray(game?.wars) ? game.wars : []).map((w) => {
    const sides = warSides(game, w);
    const left = Math.max(0, (Number(w.endsRound) || 0) - round);
    return {
      key: w.id ?? `${w.declarer}-${w.target}`,
      text: `${sides.a.map((f) => nameOfFig(list, f)).join(" + ")} ⚔ ${sides.b
        .map((f) => nameOfFig(list, f))
        .join(" + ")} · ${left} round${left === 1 ? "" : "s"} left`,
    };
  });
  const showDiplo = allyRows.length > 0 || warRows.length > 0;

  // One pass over the board per render, shared by the cards and the squeeze.
  const groups = useMemo(() => boardGroups(board), [board]);
  const cards = useMemo(
    () =>
      list.map((p) => ({
        p,
        deeds: ownedBy(board, p.figure).length,
        stakes: stakesOf(groups, p.figure),
      })),
    [list, board, groups],
  );

  const ctx = useMemo(
    () => ({ players: list, board, meFig: null }),
    [list, board],
  );

  // Newest first, only what can actually be drawn. Keys are `<seq>#<n within
  // that seq>` so a log that shifts (it is capped at 40) does not remount every
  // row and replay every animation.
  //
  // A drawn card is TWO events in the log, not one: `land` draws the card and
  // logs `{type:'card', ...}`, then mono_apply_card's own collect/pay/repairs
  // charge lands right behind it with the SAME seq (see the migration's
  // mono_land / mono_apply_card, mirrored by the mock's land()/applyCard()).
  // Both describe fine on their own, which used to mean two rows for one
  // thing that happened once — "Card · 10$" over "You have won second prize…"
  // — which is what the owner saw as a second notification. So the card's own
  // consequence is folded into ITS row instead, exactly the sum TvCenter's
  // cardAmount() already reads for the centre overlay, and the underlying
  // event is skipped here rather than drawn a second time.
  //
  // The fold is handed on to the row as `cardAmount` on a COPY of the card
  // event, which is describeEvent's agreed way in (see its `card` case): the
  // badge is then the shared EventRow's own badge, drawn by the same code as
  // every other money row on this screen, and this file no longer keeps a
  // hand-built card row of its own. Only a copy, never the log's object —
  // `game.log` is the shell's state, not ours to write on.
  //
  // The scan itself used to live here, hand-written, and a second copy of it
  // lived in TvCenter.jsx. It is `foldCardMoney` in src/Client/EventView.jsx
  // now — beside the `card` case that documents the rule — so the centre, this
  // column and the phone's own "latest" line cannot drift about what one card
  // was worth, and the phone stopped drawing two rows for one draw.
  //
  // …and the newest batch is drawn only as far as the card read beat has got.
  // The log arrives whole — draw, move, jail, money, all of it — so this
  // column used to print "Afo went to jail on a card" a beat BEFORE the card
  // face that says so was even dealt, which is the story told backwards on the
  // one screen that is also telling it forwards. `beat.cut` (useCardBeat, the
  // same schedule the centre deals its cards off) is the last event of the
  // current batch that may be spoken for yet; it moves on its own as each
  // card's beat runs out, so there is no second clock in here.
  const beatCut = beat.cut;
  const beatSeq = beat.seq;
  const rowsData = useMemo(() => {
    const log = Array.isArray(game?.log) ? game.log : null;
    const src = log && log.length > 0 ? log : Array.isArray(game?.events) ? game.events : [];
    const list = src.map(neutral);

    const { skip: consumed, amount: cardAmounts } = foldCardMoney(list);

    // Where the batch being held back begins, so an index in the log can be
    // compared with an index in the batch. -1 = nothing to hold back.
    let base = -1;
    if (Number.isFinite(beatCut) && beatSeq != null) {
      for (let i = 0; i < list.length; i++) {
        if (list[i]?.seq === beatSeq) {
          base = i;
          break;
        }
      }
      // A source with no `seq` at all is the raw `game.events` fallback: it IS
      // the batch, so its indices are the batch's own.
      if (base < 0 && !log) base = 0;
    }

    const counts = new Map();
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (consumed.has(i)) continue;
      if (base >= 0 && i >= base && i - base > beatCut) continue;
      const raw = list[i];
      if (!raw) continue;
      const folded = cardAmounts.get(i) ?? 0;
      const ev = folded ? { ...raw, cardAmount: folded } : raw;
      const seq = ev.seq ?? "e";
      const n = counts.get(seq) ?? 0;
      counts.set(seq, n + 1);
      let ok = false;
      try {
        ok = !!describeEvent(ev, ctx);
      } catch {
        ok = false;
      }
      if (!ok) continue;
      out.push({ ev, key: `${seq}#${n}`, seq: ev.seq ?? null });
    }
    return out.reverse().slice(0, MAX_ROWS);
  }, [game?.log, game?.events, ctx, beatCut, beatSeq]);

  // ---- the squeeze -------------------------------------------------------
  const latestRef = useRef(null);
  const propsRef = useRef(null);
  const n = list.length;
  const floor = baseDens(n);
  const cap = maxRowsFor(n);
  const [dens, setDens] = useState(floor);
  const [rows, setRows] = useState(MAX_ROWS);
  // How wide a card's property row really is. All six are the same width, so
  // one measurement serves them all; PROPS_W only ever covers the first paint.
  const [propsW, setPropsW] = useState(PROPS_W);

  const shape = `${cards.length}:${cards.map((c) => c.stakes.length).join(",")}`;
  const shapeRef = useRef(shape);
  useLayoutEffect(() => {
    if (shapeRef.current === shape) return;
    shapeRef.current = shape;
    setDens(floor); // a new hand of properties gets the full layout offered again
  }, [shape, floor]);

  // A seat filling or emptying changes where the squeeze starts, and it must
  // never START below the floor for the room's size.
  useLayoutEffect(() => {
    setDens((d) => (d < floor ? floor : d));
  }, [floor]);

  useLayoutEffect(() => {
    const box = propsRef.current;
    if (box && box.clientWidth > 0 && box.clientWidth !== propsW) setPropsW(box.clientWidth);

    const el = latestRef.current;
    if (!el) return;
    const h = el.clientHeight;
    const need = LABEL_H + ROW_H * MIN_ROWS + ROW_GAP;
    if (h < need && dens < SW.length - 1) {
      setDens(dens + 1);
      return;
    }
    // Players outrank the log (maxRowsFor, above): a crowded room's feed never
    // grows past its cap even when the measured space would allow more, so
    // the player cards keep first claim on whatever the column has spare.
    const fit = Math.max(
      MIN_ROWS,
      Math.min(cap, Math.floor((h - LABEL_H + ROW_GAP) / (ROW_H + ROW_GAP))),
    );
    if (fit !== rows) setRows(fit);
  });

  const sw = SW[Math.min(dens, SW.length - 1)];
  const tokSize = TOK[Math.min(dens, TOK.length - 1)];
  const shown = rowsData.slice(0, rows);
  const code = roomId || "—";

  return (
    <aside
      className={`${s.side} ${dens > 0 ? s[`d${dens}`] : ""}`}
      aria-label="Players and latest events"
    >
      <div className={s.top}>
        {/* The bank's end of a coin flight: money leaving or entering the game
            comes from (or goes to) the top of the column, where the room is
            named. Nothing is drawn here — TvPayFx only measures it. */}
        <div className={s.topRow} data-pay-anchor="bank">
          <span className={s.brand}>Room {code}</span>
          <span className={s.label}>
            {n} {n === 1 ? "player" : "players"}
          </span>
        </div>
        {/* The standing diplomacy strip (spec §3): quiet, persistent, and gone
            entirely — no row, no height — the moment there is nothing to
            report. The loud version of the same news is TvCenter's banner,
            which only holds the centre for a few seconds; this is where the
            room checks back afterwards. */}
        {showDiplo && (
          <div className={s.diploStrip} aria-label="Diplomacy">
            <span className={s.diploRound}>Round {round}</span>
            {warRows.map((w) => (
              <span key={w.key} className={s.diploWar}>
                <Swords size={12} aria-hidden="true" />
                {w.text}
              </span>
            ))}
            {allyRows.map((a) => (
              <span key={a.key} className={s.diploAlly}>
                <Link2 size={12} aria-hidden="true" />
                {a.text}
              </span>
            ))}
          </div>
        )}
        {/* A row of its own. The TV variant of the badge is deliberately big —
            it has to be read from a sofa — and in the room line it simply ate
            the room code. It draws nothing at all while the room is live, so
            this row costs no height until something is actually wrong, and the
            squeeze below absorbs it when it appears. */}
        {badge && <div className={s.badge}>{badge}</div>}
        {controls && <div className={s.controls}>{controls}</div>}
        {error && (
          <p className={s.err} role="status">
            {error}
          </p>
        )}
        {n === 0 && <p className={s.hint}>Open /Login on your phone and enter {code}</p>}
      </div>

      <div className={s.players} style={{ "--slot-h": `${sw}px` }}>
        {cards.map(({ p, deeds, stakes }, ci) => {
          const isNow =
            !over &&
            !!current &&
            (current.playerId != null
              ? current.playerId === p.playerId
              : current.figure === p.figure);
          const isWin = winners.includes(p.figure);
          const fit = fitSlots(stakes, propsW);
          const more = stakes.length - fit;
          const sub = p.bankrupt
            ? "Out of the game"
            : [
                FIGURE_NAME[p.figure] || null,
                deeds > 0 ? `${deeds} deed${deeds === 1 ? "" : "s"}` : null,
                p.inJail ? jailLine(p) : `on ${board?.[p.position]?.header ?? "the board"}`,
              ]
                .filter(Boolean)
                .join(" · ");

          // ---- alliance / war / traitor, per player (spec §1) -------------
          // A traitor can never ally again (the spec's own rule), so the ally
          // and traitor chips never compete for the same player. War is the
          // one that can sit beside either — a war rides along on an alliance
          // via the dragged-in-ally rule, and a former traitor can be a war
          // principal same as anyone.
          const allyFig = p.bankrupt ? null : allyOf(game, p.figure);
          const allyPl = allyFig ? playerByFig(list, allyFig) : null;
          const myWar = p.bankrupt ? null : warsOf(game, p.figure)[0] ?? null;
          const warLeft = myWar ? Math.max(0, (Number(myWar.endsRound) || 0) - round) : 0;
          const traitorOn = !p.bankrupt && isTraitorNow(game, p);
          const traitorLeft = traitorOn
            ? Math.max(0, (Number(p.traitorUntil) || 0) - round)
            : 0;

          return (
            <article
              key={p.playerId ?? p.figure}
              className={`${s.pl} ${isNow ? s.isNow : ""} ${p.bankrupt ? s.isDim : ""}`}
              /* Where the flying coins start and end. Measured off the
                 offsetLeft/offsetTop chain by TvPayFx, like TvTokens does, so
                 it is in the unscaled 1920x1080 space whatever the window. */
              data-pay-anchor={p.figure}
            >
              <div className={s.plTop}>
                <span className={s.plFig}>
                  <Tok player={p} size={tokSize} />
                </span>
                <div className={s.plField}>
                  <strong className={s.plLine}>
                    <span lang={hasCyrillic(p.name) ? "ru" : undefined}>{p.name}</span>
                    {isNow && <span className={s.now}>Now</span>}
                    {/* Jail is a STATE, not a footnote: it decides what that
                        player may do for up to three turns, so on the TV it is
                        painted, not mentioned. `jailTurns` is how many failed
                        rolls they have already served. */}
                    {p.inJail && !p.bankrupt && (
                      <span className={`${s.tag} ${s.tagJail}`}>
                        <Lock size={13} aria-hidden="true" />
                        Jail
                      </span>
                    )}
                    {!p.bankrupt && Number(p.jailCards) > 0 && (
                      <span className={`${s.tag} ${s.tagKey}`} title="Get out of jail free">
                        <KeyRound size={13} aria-hidden="true" />
                        {Number(p.jailCards) > 1 ? `x${Number(p.jailCards)}` : "Free"}
                      </span>
                    )}
                    {p.bankrupt && <span className={s.tag}>Out</span>}
                    {isWin && <span className={`${s.tag} ${s.tagWin}`}>Winner</span>}
                  </strong>
                  <span className={s.plSub}>{sub}</span>
                  {/* Alliance / war / traitor (spec §1's "player list
                      relationships"). A row of its own rather than more tags
                      crammed into .plLine above: at six players and d2/d3
                      density that line is already Now/Jail/Key/Winner deep,
                      and the field is too narrow to add a name-bearing ally
                      badge there without the player's own name losing every
                      pixel to the ellipsis. This row costs height only for a
                      player who actually has something to show — the column's
                      measured squeeze (top of this file) already gives that
                      height back from the Latest list, exactly like a longer
                      property row does. */}
                  {(allyPl || myWar || traitorOn) && (
                    <div className={s.plDiplo}>
                      {allyPl && (
                        <span
                          className={`${s.tag} ${s.tagAlly}`}
                          title={`Allied with ${allyPl.name} · no rent between you, +25% rent to everyone else`}
                        >
                          <Link2 size={12} aria-hidden="true" />
                          <Tok player={allyPl} size={16} />
                          <span lang={hasCyrillic(allyPl.name) ? "ru" : undefined}>
                            {allyPl.name}
                          </span>
                        </span>
                      )}
                      {myWar && (
                        <span
                          className={`${s.tag} ${s.tagWar}`}
                          title={`At war · double rent · ${warLeft} round${
                            warLeft === 1 ? "" : "s"
                          } left`}
                        >
                          <Swords size={12} aria-hidden="true" />
                          {warLeft}r left
                        </span>
                      )}
                      {traitorOn && (
                        <span
                          className={`${s.tag} ${s.tagTraitor}`}
                          title={`Branded traitor · +25% rent · ${traitorLeft} round${
                            traitorLeft === 1 ? "" : "s"
                          } left`}
                        >
                          <Skull size={12} aria-hidden="true" />
                          Traitor · {traitorLeft}r
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <TvCash
                  value={p.money}
                  reduce={reduce}
                  className={s.cash}
                  delay={cashDelay}
                  silent={silent}
                />
              </div>

              {/* One line, always: the card's height is load-bearing for the
                  whole column (see the budget at the top of this file), so the
                  slots that do not fit become a "+N" rather than a second row.
                  `ci === 0` is the one the width is measured off — every card
                  is the same width, so one ref is enough. */}
              <div className={s.props} ref={ci === 0 ? propsRef : undefined}>
                {stakes.length === 0 ? (
                  <span className={s.propsEmpty}>No properties yet</span>
                ) : (
                  <>
                    {stakes.slice(0, fit).map((st) => (
                      <Slot key={st.key} st={st} />
                    ))}
                    {more > 0 && <span className={s.slotMore}>+{more}</span>}
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <section className={s.latest} ref={latestRef} aria-label="Latest">
        <span className={s.label}>Latest</span>
        <ul className={s.evs}>
          {shown.map((r) => (
            <EventRow
              key={r.key}
              event={r.ev}
              ctx={ctx}
              /* The figure manual's size for a TV feed row: 32px tokens,
                 marks and icon circles. The row's 40px min-height and 4px
                 padding were already sized for exactly this. */
              size={32}
              /* Cards only, and it is not a preference. Every other row on
                 this screen is a short phrase that reads fine as one clamped
                 line, but a deck sentence is a sentence ("You have won second
                 prize in a beauty contest…") and one nowrap line either blew
                 .evs's grid track open or, once that was pinned, cut the text
                 off with no ellipsis at all (report 2 in the handoff). Two
                 lines, not .evWrap's default three: a row's height is the unit
                 the whole column budget at the top of this file is written in,
                 and .evs sets --ev-lines: 2 to say so. */
              wrap={r.ev.type === "card"}
              fresh={feed != null && (r.seq == null || r.seq === feed.seq)}
            />
          ))}
        </ul>
      </section>
    </aside>
  );
}
