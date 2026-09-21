// The presentation buffer: nothing that comes OUT of a roll may be visible
// before the dice are at rest.
//
// The problem it solves. The server resolves a whole turn in one transaction:
// the row that carries {"type":"roll"} also carries the move, the rent, the
// card and the bankruptcy. Until now every screen applied that row the moment
// it arrived — so the money changed, the piece moved, the log grew and the
// ticket re-tinted while the dice were still tumbling. The dice were the last
// thing to tell you what you already knew.
//
// So the view reads a SNAPSHOT that this hook may hold one beat behind the
// truth. Nothing else changes: run() is untouched, the actions fired and their
// payloads are untouched, and the server never waits for anybody.
//
// The rules, in full:
//
//   * A live batch that contains a `roll` freezes the snapshot that is CURRENTLY
//     ON SCREEN and keeps showing it until the dice land.
//   * Nothing is ever held on a first load or a refetch. Both the phone
//     (useGameRoom) and the TV (useTvFeed) only emit a feed for updates that
//     arrived live, so "no feed, no hold" falls out of that for free.
//   * Batches WITHOUT a roll are never held. Buying, building, bidding,
//     trading and ending a turn stay instant.
//   * Rows that arrive DURING a hold are buffered, not dropped: the newest
//     snapshot wins at release, and every buffered batch's events are handed
//     over together.
//   * A hold with no answer yet can never last longer than HOLD_MAX_MS,
//     whatever happens to the network, and is released immediately on unmount.
//     Once the result IS in hand the hold is bounded by the landing instead —
//     at most the moment the row arrived plus MIN_LAND_MS — because cutting a
//     landing short would let the new state out while the dice were still
//     moving, which is the one thing this file exists to stop.
//   * While holding, the view — and therefore every button derived from it —
//     is the HELD state, and `rolling` is true so the phone disables them. A
//     player can never act on state they have not been shown.
//
// WHY THE DECISION IS MADE DURING RENDER. The obvious place for it is an
// effect, and that is wrong twice over. A passive effect runs after the browser
// has painted, so the new row would flash for a frame. A layout effect runs
// before paint — but the commit that carried the new row still HAPPENED, so
// every passive effect below it ran against it: the cash count-up started
// towards the new balance and then had to count backwards when the hold landed
// a moment later. Deriving the hold while rendering (React's documented
// "adjust state when props change" pattern: setState during render of the same
// component, which re-renders immediately and discards the output) means the
// leaky commit never exists at all. The timers this needs are scheduled from an
// effect afterwards, where side effects belong.
//
// The phone's own roll is a special case with its own entry point: the dice
// start spinning on the TAP, before the server has answered, so `beginLocalRoll`
// opens the hold at that moment and the reply is simply the result the dice
// resolve onto. If the action is refused, `failLocalRoll` puts the dice back and
// releases the hold with the state untouched.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

// Every number the roll -> land -> move -> money -> card pipeline is timed by.
// Shared with the TV so both screens tell the same story at the same pace.
export const REVEAL = {
  ROLL_MS: 1500, // tap (or live roll) -> both dice at rest
  ROLL_REDUCED_MS: 600, // the same beat, with prefers-reduced-motion on
  MIN_LAND_MS: 520, // landing phase once the result is known
  MIN_LAND_REDUCED_MS: 220,
  HOLD_MAX_MS: 2200, // safety net: a hold may never outlast this
  PIECE_MS: 380, // release -> the piece has moved, money may speak
  CARD_MS: 450, // release -> the card overlay is dealt
  COIN_MS: 820, // a coin's flight
  CASH_LEAD_MS: 220, // the cash count starts this long before the coins land
  BANNER_IN_MS: 280,
  BANNER_HOLD_MS: 1800,
  BANNER_OUT_MS: 200,
  TOAST_MS: 1800,
  PAY_STAGGER_MS: 150, // between the transfers of a pay-each cascade
  CARD_CLEAR_MS: 1200, // a transfer waits this long behind a card overlay
  // THE READ BEAT. A card is a sentence somebody has to read across a room,
  // and the server hands its consequence over in the same breath as the draw.
  // This is how long the table gets with the card face — and therefore how
  // long everything the card CAUSED waits before it plays. One number, shared
  // by the TV and every phone, so the room is never told two different
  // stories at the same moment. See cardSchedule() below.
  CARD_READ_MS: 3000,
};

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

const rollOf = (events) =>
  (Array.isArray(events) ? events : []).find((e) => e && e.type === "roll") || null;

/**
 * snapshot  whatever the view reads (any object; it is only ever handed back)
 * feed      { seq, actor, events } for LIVE updates only, or null
 * meFig     my figure, so a roll can be labelled as mine
 */
export function useReveal(snapshot, feed, { meFig = null } = {}) {
  // `hold` is the frozen snapshot, or null. `roll` is what the dice are doing.
  // `out` is what has been released, and the counter the follow-up
  // choreography hangs off.
  const [hold, setHold] = useState(null);
  const [roll, setRoll] = useState(null);
  const [out, setOut] = useState({ shownFeed: null, releaseAt: 0, releaseSeq: 0 });
  const [seenSeq, setSeenSeq] = useState(null);

  // The snapshot the view is showing right now — which is what a hold has to
  // freeze, not the one that just arrived. Written after every commit that was
  // NOT holding, so on the render that starts a hold it is still the old one.
  const shownRef = useRef(snapshot);
  // Batches that arrived during the hold, in order, collected in an effect (a
  // render must not push to anything).
  const pending = useRef([]);
  const collected = useRef(null);
  const rollSeq = useRef(0);
  const timers = useRef([]);
  const alive = useRef(true);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // ---- the decision, during render ---------------------------------------
  if (feed && feed.seq !== seenSeq) {
    setSeenSeq(feed.seq);
    const r = rollOf(feed.events);
    if (r) {
      const reduce = prefersReducedMotion();
      const total = reduce ? REVEAL.ROLL_REDUCED_MS : REVEAL.ROLL_MS;
      const minLand = reduce ? REVEAL.MIN_LAND_REDUCED_MS : REVEAL.MIN_LAND_MS;
      const now = Date.now();
      // An optimistic beat that is still in the air gets its result; anything
      // else is a fresh beat that starts now.
      const open = !!hold && !!roll && roll.result == null && !roll.cancelled;
      const startedAt = open ? roll.startedAt : now;
      const id = open ? roll.id : rollSeq.current + 1;
      if (!open) rollSeq.current = id;
      if (!hold) setHold({ snapshot: shownRef.current, at: now });
      setRoll({
        id,
        startedAt,
        mine: open ? true : r.figure != null && r.figure === meFig,
        by: r.figure ?? null,
        result: [r.d1, r.d2],
        // At least the full beat from the tap; and if the server took longer
        // than that, whatever is left of the landing phase, so the dice never
        // stop dead the instant the row lands.
        restAt: Math.max(startedAt + total, now + minLand),
        cancelled: false,
      });
    } else if (!hold) {
      // Nothing to hold. Straight through, exactly as before.
      setOut((cur) => ({
        shownFeed: { seq: feed.seq, actor: feed.actor, events: feed.events ?? [] },
        releaseAt: Date.now(),
        releaseSeq: cur.releaseSeq + 1,
      }));
    }
  }

  // ---- collecting what arrived while held --------------------------------
  // Only while holding: a batch that went straight through has already been
  // handed over by the render-phase block above, and keeping a copy here would
  // see it replayed at the end of the NEXT hold.
  useLayoutEffect(() => {
    if (!feed || feed.seq === collected.current) return;
    collected.current = feed.seq;
    if (hold) {
      pending.current.push({ seq: feed.seq, actor: feed.actor, events: feed.events ?? [] });
    }
  }, [feed, hold]);

  // Declared after, so the effect above still sees the previous value of
  // `shownRef` if it ever needs it, and so a held commit never overwrites it.
  useLayoutEffect(() => {
    if (!hold) shownRef.current = snapshot;
  });

  // Hand the newest snapshot and every buffered batch to the view, in one
  // commit, and kick the follow-up choreography off by moving `releaseSeq`.
  const release = useCallback(() => {
    if (!alive.current) return;
    clearTimers();
    const batches = pending.current;
    pending.current = [];
    const last = batches[batches.length - 1] ?? null;
    const merged = last
      ? {
          seq: last.seq,
          actor: last.actor,
          events: batches.flatMap((b) => (Array.isArray(b.events) ? b.events : [])),
        }
      : null;
    setHold(null);
    setOut((cur) => ({
      shownFeed: merged ?? cur.shownFeed,
      releaseAt: Date.now(),
      releaseSeq: cur.releaseSeq + 1,
    }));
  }, []);

  // ---- when to let go ----------------------------------------------------
  useEffect(() => {
    if (!hold) return undefined;
    clearTimers();
    const now = Date.now();
    const landing = roll?.restAt != null && !roll.cancelled;
    if (landing) {
      // The result is in hand, so the hold is already bounded: `restAt` is at
      // most the moment the row arrived plus the landing phase. The 2.2s cap
      // deliberately does NOT apply here — it exists for a reply that never
      // comes, and firing it in the middle of a landing would let the new
      // state out while the dice were still moving, which is the one thing
      // this whole file is for.
      timers.current.push(setTimeout(release, Math.max(0, roll.restAt - now)));
    } else {
      // Nothing has answered yet. Measured from the moment the hold opened, so
      // a reply that never comes cannot freeze the screen.
      timers.current.push(setTimeout(release, Math.max(0, hold.at + REVEAL.HOLD_MAX_MS - now)));
    }
    return () => clearTimers();
  }, [hold, roll?.restAt, roll?.cancelled, release]);

  // ---- the phone's own roll, from the tap --------------------------------
  const beginLocalRoll = useCallback(() => {
    if (!alive.current) return;
    const startedAt = Date.now();
    const id = ++rollSeq.current;
    setHold((cur) => cur ?? { snapshot: shownRef.current, at: startedAt });
    setRoll({
      id,
      startedAt,
      mine: true,
      by: meFig,
      result: null,
      restAt: null,
      cancelled: false,
    });
  }, [meFig]);

  // The server refused it. No fake result: the dice go back to the faces they
  // were showing, and the held snapshot — which is the unchanged truth — is
  // handed straight back.
  const failLocalRoll = useCallback(() => {
    if (!alive.current) return;
    setRoll((cur) => (cur ? { ...cur, cancelled: true } : cur));
    release();
  }, [release]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimers();
    };
  }, []);

  return {
    view: hold ? hold.snapshot : snapshot,
    holding: hold != null,
    rolling: hold != null,
    roll,
    feed: out.shownFeed,
    releaseAt: out.releaseAt,
    releaseSeq: out.releaseSeq,
    beginLocalRoll,
    failLocalRoll,
  };
}

// ---------------------------------------------------------------------------
// The card read beat
// ---------------------------------------------------------------------------
// The same problem the buffer above solves for the dice, one layer further in.
//
// The server resolves a whole action in one transaction, so the row that
// carries {"type":"card"} ALSO carries everything the card said: the second
// move to Jail or three cells back, the second landing and its rent, the
// pays and collects. Until now every screen applied all of it at the moment
// the roll released — the piece flew straight past the Chance cell to Jail,
// the cash counted, the feed row appeared — and the card face was dealt
// REVEAL.CARD_MS later, on top of a board that had already spoiled it. The
// owner's words: "it is being instant".
//
// So a batch that draws a card is not one beat but several, told in order:
//
//     release ──CARD_MS──▶ the card face is dealt (the piece has arrived on
//                          the Chance / Chest cell by now)
//             ──CARD_READ_MS──▶ the table has read it
//                          ▶ NOW the consequence plays: the piece walks on,
//                            the money moves, a second landing resolves
//
// and a CHAIN — a card whose move lands on another deck, or on a property
// whose rent is the next thing to happen — simply repeats that: each card in
// the batch gets its own dealt-then-read beat, one after the other.
//
// `cardSchedule` is the whole of that as arithmetic, with no React in it: it
// turns one batch's events into the offset, measured from the moment the
// reveal buffer released the batch, at which each thing is allowed on screen.
// Both screens run it over the same events and therefore agree to the
// millisecond without talking to each other.
//
// prefers-reduced-motion deliberately does NOT shorten any of this. Reduced
// motion is a request to stop things MOVING, not a request to read faster —
// the travel animations are already dropped for it further down (Motion's
// reducedMotion config, useWalkingTokens), and the beat is the one part of
// this that is information rather than decoration.

const hasRoll = (events) =>
  (Array.isArray(events) ? events : []).some((e) => e && e.type === "roll");

// The cell the drawer was standing on when the card came off the deck: the
// nearest `land` for that figure BEFORE the card event. That is the tile the
// piece has to stop on and wait on — the row's own `position` is already
// wherever the card sent it.
function cellOfDraw(list, at, figure) {
  for (let j = at - 1; j >= 0; j--) {
    const e = list[j];
    if (e && e.type === "land" && e.figure === figure) return e.cell ?? null;
  }
  return null;
}

/**
 * events   one released batch's events (reveal.feed.events)
 * rolled   whether the batch contains a roll; defaults to reading the events
 *
 * Returns { cards, hold, delayAt } where
 *   cards[k] = { index, event, figure, cell, showAt, actAt }
 *     index   the event's index in the batch
 *     cell    the deck cell the piece must be standing on while it is read
 *     showAt  ms after release at which the card face is dealt
 *     actAt   showAt + CARD_READ_MS: everything this card caused may now play
 *   hold      actAt of the LAST card — what the money layer waits for; 0 when
 *             nothing was drawn, so a batch with no card is timed exactly as
 *             it always was
 *   delayAt(i) the offset at which the event at index `i` may be shown: the
 *             actAt of the last card drawn before it, or 0
 */
export function cardSchedule(events, { rolled } = {}) {
  const list = Array.isArray(events) ? events : [];
  const roll = rolled == null ? hasRoll(list) : !!rolled;
  const cards = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || e.type !== "card") continue;
    const prev = cards[cards.length - 1];
    // The first card waits only for the piece to reach the deck cell. Each
    // one after it waits for the card before it to be read AND for the piece
    // to travel to wherever that card sent it — the same CARD_MS, measured
    // from the same kind of moment.
    const showAt = (prev ? prev.actAt : roll ? 0 : -REVEAL.CARD_MS) + REVEAL.CARD_MS;
    cards.push({
      index: i,
      event: e,
      figure: e.figure ?? null,
      cell: cellOfDraw(list, i, e.figure),
      showAt,
      actAt: showAt + REVEAL.CARD_READ_MS,
    });
  }
  const hold = cards.length > 0 ? cards[cards.length - 1].actAt : 0;
  const delayAt = (i) => {
    let out = 0;
    for (const c of cards) if (c.index < i) out = c.actAt;
    return out;
  };
  return { cards, hold, delayAt };
}

/**
 * The read beat as a hook. One per screen; every screen that runs it over the
 * same batch gets the same answers.
 *
 * feed    the RELEASED batch ({ seq, actor, events }) or null. Live batches
 *         only, which is what keeps a resync or a reload silent: no feed, no
 *         beat, and a TV that reconnects mid-game never replays a card.
 * onCard  called once per card in the batch, at that card's `showAt`, with
 *         (card, k). Kept in a ref, so a caller may pass a fresh closure every
 *         render without rescheduling anything.
 *
 * Returns { cards, hold, delayAt, pin, cut, seq, reading } — the schedule
 * itself (see cardSchedule) plus the three live answers below and `seq`, the
 * batch all of them are about.
 *   pin      { [figure]: cell } while a card is being read — the tile the
 *            piece must be shown standing on, whatever the row says. Handed to
 *            useWalkingTokens so the token stops on Chance and walks on
 *            afterwards, instead of flying straight past it to Jail.
 *   cut      the last index in the batch that may be told RIGHT NOW: the card
 *            currently being read, or Infinity once the last beat is over. A
 *            running list of events (the TV's Latest column, the phone's three
 *            newest lines) draws only up to it, so the feed cannot print "Afo
 *            went to jail on a card" a beat before the card says so. It needs
 *            no clock of its own — it moves when the beat does.
 *   reading  true while any card face is owed its beat.
 *
 * WHY THE FIRST ANSWER IS DERIVED DURING RENDER. Same reason as the buffer
 * above: the pin has to be in the caller's hands in the SAME commit the new
 * row arrives in. Computed in an effect it would be one commit late, the
 * token would already have been told to fly to Jail, and the pin would pull
 * it back mid-flight.
 */
export function useCardBeat(feed, onCard) {
  const sched = useMemo(
    () => cardSchedule(feed?.events),
    // The batch is immutable and replaced wholesale; its identity is the key.
    [feed],
  );
  const cb = useRef(onCard);
  cb.current = onCard;

  // Which card of THIS batch is currently owed its beat. `-1` = none left.
  const [seen, setSeen] = useState(null);
  const [idx, setIdx] = useState(-1);
  if (feed && feed.seq !== seen) {
    setSeen(feed.seq);
    setIdx(sched.cards.length > 0 ? 0 : -1);
  }

  useEffect(() => {
    if (!feed || sched.cards.length === 0) return undefined;
    const timers = [];
    sched.cards.forEach((c, k) => {
      timers.push(setTimeout(() => cb.current?.(c, k), Math.max(0, c.showAt)));
      timers.push(
        setTimeout(
          () => setIdx((cur) => (cur === k ? (k + 1 < sched.cards.length ? k + 1 : -1) : cur)),
          Math.max(0, c.actAt),
        ),
      );
    });
    return () => timers.forEach(clearTimeout);
  }, [feed, sched]);

  const active = idx >= 0 ? sched.cards[idx] ?? null : null;
  const pinFig = active?.figure ?? null;
  const pinCell = active?.cell ?? null;
  const pin = useMemo(
    () => (pinFig && pinCell != null ? { [pinFig]: pinCell } : null),
    [pinFig, pinCell],
  );

  return {
    cards: sched.cards,
    hold: sched.hold,
    delayAt: sched.delayAt,
    pin,
    cut: active ? active.index : Infinity,
    seq: feed?.seq ?? null,
    reading: active != null,
  };
}

export default useReveal;
