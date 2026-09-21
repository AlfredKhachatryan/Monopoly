// One casino play, replayed — on the casino floor, on the machine itself.
//
// THE CONTRACT, and it is the important part of this file: the server has
// already resolved the bet by the time anything here moves. `event` is the
// `{type:'casino', stage:'result'}` event out of `game.events` and it carries
// the whole outcome — the three reel indices, the roulette pocket, the wheel
// segment, the multiplier and the payout. This component's ONLY job is to make
// the machine come to rest on that answer.
//
// So there is no random number anywhere below, no "spin and then correct", and
// nothing that turns before the answer is known. Each machine
// (CasinoMachines.jsx) is positioned by a pure function of the server's own
// index (casinoGames.js) — the cell a reel or the track rests on, the angle the
// wheel stops at — and the animation is one journey INTO that position. A reel
// physically cannot stop on a symbol the server did not send, because the only
// place the stopping offset comes from is the number it sent. Replaying the RPC
// cannot reroll anything either; mono_casino_spin runs once, inside the
// transaction that already took the money.
//
// ONE SCREEN, NOT TWO. This is the same full-screen felt frame the bettor's
// takeover uses (CasinoRoom.jsx) with the same machine at the same size — the
// takeover fills the foot with the controls, this fills it with the verdict.
// CasinoPanel cannot do the spinning itself: the server is back in phase 'act'
// in the very response that carries the result, so the panel is unmounted
// before there is anything to animate. This component, on the other hand, is
// mounted for the life of the screen (ClientScreen hands it a null event when
// there is nothing to show), so it is the one that can hold the frame across
// that gap:
//
//   bridge      the bettor pressed SPIN. The panel published what they chose;
//               this puts the identical frame up at once, machine idle, foot
//               pinned to the height the panel's controls had. The panel may
//               now be unmounted at any moment and nothing on screen changes.
//   spinning    the event arrived. The SAME machine element — not a new one —
//               gets the result and starts to move.
//   verdict     it has stopped. Only now do the multiplier and the money
//               appear, on the hub / the payline / the table and in the foot.
//
// Every phone in the room gets the spin, not only the one that bet; for the
// other five it fades in over their ordinary screen. It dismisses itself on
// every phone — a spectator must never have to tap something to get their
// board back, and the player who bet still has a turn to finish underneath.
// A tap closes it early (after the verdict, for the bettor, so the second half
// of a double-tap on SPIN cannot throw the result away unseen), and so does
// Escape.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { nameOfFig, playerByFig } from "../Hooks/rules";
import { fmt, fmtSigned } from "./format";
import Tok from "./Tok";
import { GAME_NAME, multLabel, toneOfMult } from "./casinoGames";
import CasinoMachine, { SPIN_MS, prefersReducedMotion } from "./CasinoMachines";
import CasinoRoom, { bridge, useCasinoHost } from "./CasinoRoom";
import c from "./casino.module.css";

// The beat between the machine stopping and the verdict, and how long the
// verdict then stays up before the frame lets go of the screen. All of it
// presentation — the money moved before any of this mounted. The bettor's hold
// is longer: it is their money, and they also have a Continue button.
const VERDICT_GAP_MS = 220;
const HOLD_MS = { mine: 4200, watching: 2600 };

// With "reduce motion" on, the machines simply ARRIVE on the server's answer
// (the transitions are off in the stylesheet, and the wheel skips its loop).
// Nothing is hidden by that — the answer was always the thing on screen — so
// the timers only have to be short enough that the frame does not sit there
// for five seconds of nothing happening.
const REDUCED = { spin: 200, hold: 2600 };

// A spectator's frame arrives under whatever they were doing, possibly under a
// finger already on its way to a button. Ignore taps for this long so the spin
// cannot be dismissed by a tap that was never meant for it.
const TAP_GUARD_MS = 650;

// How long the frame may stand with a bet sent, the panel gone and no result.
// That only happens when the block went away for some other reason (the player
// left, a resync replaced the room) — the result, when there is one, arrives in
// the same response that unmounts the panel.
const ORPHAN_MS = 2500;
const FADE_MS = 220;

// Milliseconds from the frame opening to the verdict appearing, for one game.
//
// Exported because ClientScreen needs the same number: it holds the aura's
// cash count-up back until the machine has stopped, so the balance cannot
// answer before the reels do. That used to be a literal over there (2550, from
// when the wheel took 2400ms) and it went stale the day the wheel grew its long
// 5600ms crawl — the count-up was finishing three seconds early, underneath
// the frame. One function, read by both the timer below and the caller, is the
// only version of this that cannot drift again.
export function verdictAtMs(game) {
  const spin = prefersReducedMotion() ? REDUCED.spin : (SPIN_MS[game] ?? 2600);
  return spin + VERDICT_GAP_MS;
}

export default function CasinoResult({ event, players = [], meFig = null, onClose }) {
  const [run, setRun] = useState(false);
  const [shown, setShown] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;

  const [anchor, host] = useCasinoHost();
  const pending = useSyncExternalStore(bridge.subscribe, bridge.get, bridge.getServer);
  // Only ever this phone's own bet: the bridge is written by the panel on this
  // phone, but `figure` is checked anyway so a stale entry can never dress a
  // spectator's replay up as theirs.
  const mineBridge = pending && meFig && pending.figure === meFig ? pending : null;

  const key = event ? `${event.seq ?? "x"}#${event.cell}#${event.bet}` : null;

  // The spin starts one frame after the result is on the element. Two nested
  // rAFs, not one: the first commits the machine at its idle offset WITH the
  // result attached, the second flips `run`, and only a change BETWEEN two
  // committed styles produces a transition. With a single frame the browser is
  // free to collapse both into the same style recalculation and the reels
  // would simply appear on the answer with no movement at all.
  const openedAt = useRef(0);
  useEffect(() => {
    if (!event) return undefined;
    setRun(false);
    setShown(false);
    openedAt.current = Date.now();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setRun(true));
    });
    const reduced = prefersReducedMotion();
    const mineNow = !!meFig && event.figure === meFig;
    const hold = reduced ? REDUCED.hold : mineNow ? HOLD_MS.mine : HOLD_MS.watching;
    const verdictAt = verdictAtMs(event.game);
    const tell = setTimeout(() => setShown(true), verdictAt);
    const gone = setTimeout(() => close.current?.(), verdictAt + hold);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(tell);
      clearTimeout(gone);
    };
    // Keyed on the PLAY, not on the object: ClientScreen builds a fresh
    // `{...event, seq}` whenever its feed effect runs, and a spin that started
    // over each time an identical copy of its own result arrived would be a
    // wheel that never stops. `meFig` cannot change under a play in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Escape closes it early. No autofocus: this dialog steals nothing, because
  // it goes away on its own.
  useEffect(() => {
    if (!event) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") close.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [event]);

  // The bridge has done its job once a result is on screen — and is an orphan
  // if the panel has gone and no result followed.
  useEffect(() => {
    if (!pending) return undefined;
    if (event) {
      bridge.clear();
      return undefined;
    }
    if (pending.goneAt == null) return undefined;
    const left = Math.max(ORPHAN_MS - (Date.now() - pending.goneAt), 0);
    const t = setTimeout(() => bridge.clear(), left);
    return () => clearTimeout(t);
  }, [pending, event]);

  // What is on the frame right now: a result, or the bettor's own bet waiting
  // for one. The last thing shown is kept for the length of the fade so the
  // frame leaves with its content rather than emptying first.
  const view = event
    ? { kind: "result", event }
    : mineBridge
      ? { kind: "bridge", bet: mineBridge }
      : null;
  // `leaving` is DERIVED, in the same render that loses the view, rather than
  // set from an effect a render later: one render with neither a view nor the
  // flag would unmount the frame and mount a fresh one to fade out — and a
  // freshly mounted wheel that is told `run` starts its spin all over again.
  const last = useRef(null);
  const [, redraw] = useState(0);
  if (view) last.current = view;
  const leaving = !view && last.current != null;
  useEffect(() => {
    if (!leaving) return undefined;
    const t = setTimeout(() => {
      last.current = null;
      redraw((n) => n + 1);
    }, FADE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  // The height the takeover's controls had, so this foot is exactly as tall
  // and the machine above it does not move by a pixel at the hand-over. Kept
  // in a ref because the bridge is cleared as soon as the result lands, and
  // the foot must stay that height for the whole replay.
  const footHeight = useRef(null);
  if (mineBridge?.footHeight) footHeight.current = mineBridge.footHeight;
  // What the takeover's cash readout said, for the same reason: see `cashShown`.
  const walkedIn = useRef(null);
  if (mineBridge && Number.isFinite(Number(mineBridge.cash))) walkedIn.current = Number(mineBridge.cash);
  const bridged = useRef(false);
  if (view?.kind === "bridge") bridged.current = true;
  if (!view && !last.current) {
    bridged.current = false;
    footHeight.current = null;
    walkedIn.current = null;
  }

  const now = view ?? last.current;
  const anchorEl = <span ref={anchor} hidden />;
  if (!now) return anchorEl;

  const ev = now.kind === "result" ? now.event : null;
  const bet0 = now.kind === "bridge" ? now.bet : null;
  const res = ev?.result ?? null;
  const game = ev?.game ?? bet0?.game ?? "slots";
  const mult = Number(ev?.mult) || 0;
  const bet = Math.max(Math.round(Number(ev?.bet ?? bet0?.bet) || 0), 0);
  const payout = Math.max(Math.round(Number(ev?.payout) || 0), 0);
  // The swing is what the player actually ends up with: the bet left them and
  // the payout came back, so the number that matters is the difference. It is
  // never a net figure on the wire (the server settles it as a `pay` and a
  // `collect`), which is exactly why it is computed here for display only.
  const swing = payout - bet;
  const figure = ev?.figure ?? bet0?.figure ?? null;
  const mineBet = !!meFig && figure === meFig;
  const bettor = figure ? playerByFig(players, figure) : null;
  const who = mineBet ? "You" : nameOfFig(players, figure);
  const pick = res?.pick ?? bet0?.colour ?? null;
  const done = !!ev && shown;
  const tone = done ? toneOfMult(mult) : null;

  // The cash in the header, for the bettor. `players` already holds the
  // SETTLED balance — the money moved in the same response — so printing it
  // during the spin would give the result away in the top corner while the
  // wheel is still turning. Until the verdict it shows what they walked in
  // with — the very number the takeover was showing, carried over the bridge,
  // or failing that settled − swing, which is the same thing — and after it,
  // what they have now.
  const cashNow = Number(bettor?.money);
  const cashBefore =
    walkedIn.current ?? (Number.isFinite(cashNow) ? Math.max(cashNow - swing, 0) : null);
  const cashShown = !ev
    ? (bet0?.cash ?? null)
    : done && Number.isFinite(cashNow)
      ? cashNow
      : cashBefore;

  const tryClose = () => {
    if (!ev) return;
    if (mineBet ? done : Date.now() - openedAt.current > TAP_GUARD_MS) onClose?.();
  };

  const betLine = (
    <p className={c.vBet}>
      {who} bet <b>{fmt(bet)}</b> on {GAME_NAME[game] ?? "the casino"}
      {game === "roulette" && pick ? ` · ${pick}` : ""}
    </p>
  );

  return (
    <>
      {anchorEl}
      <CasinoRoom
        host={host}
        role="alertdialog"
        label={`${who} bet ${fmt(bet)} on ${GAME_NAME[game] ?? "the casino"}`}
        sub={mineBet ? "No more bets" : `${who} is at the tables`}
        aside={
          mineBet ? (
            cashShown != null && (
              <>
                <span className={c.asideLab}>Cash</span>
                <strong>{fmt(cashShown)}</strong>
              </>
            )
          ) : (
            <span className={c.roomWho}>
              {bettor && <Tok player={bettor} size={28} />}
              <strong>{who}</strong>
            </span>
          )
        }
        enter={bridged.current || mineBet ? "none" : "fade"}
        leaving={leaving}
        tone={tone}
        footHeight={mineBet ? footHeight.current : null}
        onClick={tryClose}
        machine={
          <CasinoMachine
            game={game}
            result={res}
            run={!!ev && run}
            reveal={done}
            mult={mult}
            pick={pick ?? "red"}
          />
        }
        foot={
          <div className={c.verdict} data-tone={tone ?? undefined}>
            {betLine}

            {/* The verdict waits for the machine to stop. Saying "×10" over a
                reel that is still moving would be the screen answering a
                question it has not finished asking. */}
            <div className={c.vOut} aria-live="polite">
              {done ? (
                <>
                  <span className={c.vMult} data-tone={tone}>
                    {mult > 0 ? multLabel(mult) : "No win"}
                  </span>
                  <span className={c.vSwing}>
                    {mult > 0 ? (
                      <>
                        Paid {fmt(payout)} ·{" "}
                        <b data-tone={swing >= 0 ? "pos" : "neg"}>{fmtSigned(swing)}</b>
                      </>
                    ) : (
                      <>
                        The house keeps it · <b data-tone="neg">{fmtSigned(-bet)}</b>
                      </>
                    )}
                  </span>
                </>
              ) : (
                <span className={c.vWait}>
                  {ev ? (game === "roulette" ? "The ball is rolling…" : "Spinning…") : "Placing your bet…"}
                </span>
              )}
            </div>

            {/* The bettor gets a button once there is something to continue
                FROM; until then the slot it stands in says why nothing can be
                pressed. Everyone else can leave whenever they like. */}
            {mineBet ? (
              <button
                type="button"
                className={c.vBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  if (done) onClose?.();
                }}
                disabled={!done}
              >
                {done ? "Continue" : "No more bets"}
              </button>
            ) : (
              <button
                type="button"
                className={c.vBtn}
                data-quiet="1"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose?.();
                }}
              >
                Close
              </button>
            )}
          </div>
        }
      />
    </>
  );
}
