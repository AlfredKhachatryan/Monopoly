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

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

export default useReveal;
