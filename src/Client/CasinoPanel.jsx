// The Casino: a full-screen takeover for the player who has to bet, and a
// statement in the act row's place for the five who do not.
//
// Cell 13 is not a property and has no owner — the BANK is the house. Landing
// on it is MANDATORY (spec §5): the server writes `game.casino` and moves the
// room into phase 'casino', and while that phase is on, every other verb
// (roll, move, buy, build, pay_jail, use_jail_card, end_turn, every auction_*
// and every trade_*) is refused with "The casino is waiting". Exactly three
// things clear it: casino_play, skip_turn from the board, and leaving. So the
// takeover offers ONE button and no way out — no Decline, no close, no scrim to
// tap. A way out here would be a button the server refuses, which is worse
// than no button at all. And since nothing else on the phone can be pressed to
// any effect while the house is waiting, there is nothing the takeover hides
// that the player could have used.
//
// THE BETTOR gets the whole phone, in felt and brass (CasinoRoom.jsx): the
// machine they have picked big at the top, already there and idle before any
// money is on it; under it the game tabs, the honest odds, the bet and one
// button, all in the lower half where a thumb is. ClientScreen still mounts
// this component inside the act row; the frame portals itself out to the
// `[data-client]` root — see CasinoRoom.jsx for why that is what keeps it
// pressable whatever ClientScreen has made `inert`.
//
// THE OTHER FIVE keep their ordinary screen and get a panel in the act row —
// the same rule the auction panel follows — because a phone with nothing on it
// is how five people end up staring at a dead screen for somebody else's turn,
// and because a full-screen takeover nobody can dismiss is only defensible for
// the one player who actually has something to do in it. They see who is at
// the tables; then every phone gets the spin (CasinoResult.jsx).
//
// NOTHING HERE DECIDES AN OUTCOME. The only thing this component produces is
// the payload {game, bet, colour}; the spin, the symbols, the pocket, the
// segment and the payout are all the server's. The machine on screen is idle
// for as long as this component is alive: it does not turn, tease or "warm
// up", because there is no result for it to be turning towards. The animation
// that follows only replays what came back. See casinoGames.js.
//
// SPINNING "IN PLACE". The server returns to phase 'act' in the same response
// that carries the result, so this component is unmounted the instant the bet
// resolves — it never sees the outcome and cannot animate it. What it does
// instead is hand over: on SPIN it publishes what the player chose (and how
// tall its controls are) on CasinoRoom's `bridge`, and CasinoResult, which is
// mounted for the life of the screen, puts up the IDENTICAL frame at once,
// machine idle, over this one. When this component goes, nothing visible
// changes; when the result arrives, that same machine starts to move.
//
// The bet bounds come from the server too. `casino.min` is
// mono_casino_min_bet(cash) — 15% of the player's cash rounded UP to the
// nearest $10, clamped to the cash — and `casino.max` is the cash itself.
// They are re-derived server-side from LIVE cash at play time, so this panel
// treats them as a hint for the slider and never as an authority: if the
// numbers have drifted the server's own message ("Bet at least N$", "Not
// enough money") is what the player is shown, rather than a second, differently
// wrong opinion computed here.

import { useEffect, useMemo, useRef, useState } from "react";
import { Cherry, Disc3, LifeBuoy, Spade } from "lucide-react";
import { nameOfFig, playerByFig } from "../Hooks/rules";
import { fmt } from "./format";
import Tok from "./Tok";
import { CASINO_GAMES } from "./casinoGames";
import CasinoMachine from "./CasinoMachines";
import CasinoRoom, { bridge, useCasinoHost } from "./CasinoRoom";
import b from "./bits.module.css";
import c from "./casino.module.css";

// Bets move in $10 steps, the same granularity the minimum is rounded to, so
// the slider has round numbers to land on. The two ends are exempt: `max` is
// the player's exact cash (all-in has to mean all in, not "all in less the
// change") and `min` is already a multiple of 10 by construction.
const STEP = 10;

const GAME_ICON = { slots: Cherry, roulette: Disc3, wheel: LifeBuoy };

// What the one button says. Every machine here is spun, so it is the same verb
// three times — kept as a table so a fourth game does not inherit it by
// accident.
const GO_VERB = { slots: "Spin", roulette: "Spin", wheel: "Spin" };

// useGameRoom's own wording for a request that never reached the server (it
// is not exported, and the hook is not this component's to edit). A rule
// rejection is quoted verbatim instead — that is the server talking to the
// player — but "TypeError: Failed to fetch" tells them nothing they can act on.
const NETWORK_MESSAGE = "Connection problem — try again";

// Snap a dragged value onto the step grid without ever leaving [min, max].
//
// BOTH ENDS ARE EXEMPT FROM THE SNAP, and that is the whole subtlety here.
// `max` is the player's exact cash, which is not a multiple of ten as often as
// not — rent is floor(price / 8) — so rounding it would turn "All in" into
// "all in, less the change", which is a promise the button should not be
// allowed to break. `min` is already a multiple of ten by construction
// (mono_casino_min_bet rounds up to it) but is clamped the same way for
// symmetry, so a snap can never land a dollar under the floor and have the
// server refuse a bet the slider offered.
function snap(value, min, max) {
  const v = Number(value);
  if (!Number.isFinite(v)) return min;
  if (v >= max) return max;
  if (v <= min) return min;
  return Math.min(Math.max(Math.round(v / STEP) * STEP, min), max);
}

export default function CasinoPanel({ casino, players = [], me, busy, onPlay }) {
  // Read defensively and bail out only after the hooks below have run: a room
  // written by an older server, or a `casino` block that went missing, must not
  // change the number of hooks this component calls (Rules of Hooks).
  const fig = casino?.figure ?? null;
  const rawMin = Math.max(Math.round(Number(casino?.min) || 0), 0);
  const rawMax = Math.max(Math.round(Number(casino?.max) || 0), 0);
  // A floor above the ceiling is impossible by construction (the server clamps
  // the 15% to the cash) but a stale block can still say it. Clamp rather than
  // render a slider whose min exceeds its max, which browsers resolve silently
  // and differently from one another.
  const min = Math.min(rawMin, rawMax);
  const max = rawMax;

  const mine = !!me && !!fig && fig === me.figure;
  const atTable = fig ? playerByFig(players, fig) : null;

  const [game, setGame] = useState("slots");
  const [colour, setColour] = useState("red");
  const [bet, setBet] = useState(min);
  // The server's own words when it refuses the bet. ClientScreen shows the
  // same string as a banner in the aura, but the takeover is sitting on top of
  // the aura, so it has to be said here or it is not said at all.
  const [refusal, setRefusal] = useState(null);

  const [anchor, host] = useCasinoHost();
  const foot = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Going away with a bet in flight is the normal case — the server moved
      // on, and the result is on its way to CasinoResult. Tell the bridge, so
      // that if nothing ever arrives the frame is not left standing.
      bridge.panelGone();
    };
  }, []);

  // The floor follows the player's cash, and the cash moves between landings.
  // Re-seed the slider whenever the pending block itself changes — a new
  // landing, or the same one re-served with different bounds — so a bet left
  // over from last time can never be sent against this time's limits.
  const boundsKey = `${fig}|${min}|${max}`;
  const seeded = useRef(null);
  useEffect(() => {
    if (seeded.current === boundsKey) return;
    seeded.current = boundsKey;
    setBet(min);
  }, [boundsKey, min]);

  // Keep the bet inside the bounds even without a re-seed: paying rent in the
  // same batch that opened the casino lowers the ceiling under a slider that
  // is already on screen.
  const value = snap(bet, min, max);

  // One tap must not reach the server twice. The same latch the auction panel
  // uses: a second press is rejected harmlessly server-side ("The casino is
  // not waiting for you" — the first call already cleared the block) but that
  // rejection still flashes a red banner for something the player did not do
  // wrong. Released when the pending block moves on, or when `busy` has cycled
  // back to false after a call that changed nothing.
  const [sent, setSent] = useState(null);
  const prevBusy = useRef(busy);
  useEffect(() => {
    if (sent !== null && sent !== boundsKey) setSent(null);
  }, [boundsKey, sent]);
  useEffect(() => {
    if (prevBusy.current && !busy && sent === boundsKey) {
      setSent(null);
      // The call came back and this panel is still here: the bet did not
      // resolve. Take the hand-over frame down so the controls underneath it
      // can be used again.
      bridge.clear();
    }
    prevBusy.current = busy;
  }, [busy, boundsKey, sent]);
  const latched = sent === boundsKey;

  const pick = useMemo(() => CASINO_GAMES.find((g) => g.id === game) ?? CASINO_GAMES[0], [game]);

  if (!casino || !fig) return null;

  const name = atTable?.name ?? nameOfFig(players, fig);
  // The 15% floor, said in words as well as in dollars. Players read a slider
  // that will not go below a number as "broken" unless something says why.
  const floorLine = min > 0 ? `${fmt(min)} minimum · 15% of your cash` : "Any bet";

  async function send() {
    if (latched || busy) return;
    setSent(boundsKey);
    setRefusal(null);
    const needs = pick.id === "roulette";
    // Hand the screen over BEFORE the request leaves: from this moment the
    // frame the player is looking at belongs to CasinoResult, so this
    // component can be unmounted at any point without anything flickering.
    // What crosses the bridge is the player's own choice and the geometry of
    // this frame — never an outcome; there isn't one yet.
    bridge.open({
      figure: fig,
      game: pick.id,
      bet: value,
      colour: needs ? colour : null,
      cash: max,
      // The fractional height, not offsetHeight: a foot rounded up by 0.4px
      // is a stage 0.4px shorter and a wheel that visibly twitches at the
      // hand-over.
      footHeight: foot.current?.getBoundingClientRect().height ?? null,
    });
    // `colour` is only meaningful for roulette. The server ignores it for the
    // other two, and sending it anyway would make the payload lie about what
    // was chosen, so it is left off.
    let res;
    try {
      res = await onPlay?.({
        game: pick.id,
        bet: value,
        ...(needs ? { colour } : {}),
      });
    } catch (err) {
      res = { error: { message: err?.message ?? String(err) } };
    }
    if (!res?.error) return;
    // Refused. The server's string, as it is — "Bet at least 280$", "Not
    // enough money", "The casino is not waiting for you". The hand-over frame
    // comes down and the controls are live again underneath it.
    bridge.clear();
    if (!alive.current) return;
    setRefusal(res.error.network ? NETWORK_MESSAGE : (res.error.message ?? "The bet was refused"));
  }

  // ---- the five phones that are not betting -------------------------------
  if (!mine) {
    return (
      <section className={c.cas} aria-label="The casino">
        <div className={c.casTop}>
          <span className={c.casChip} aria-hidden="true">
            <Spade size={22} />
          </span>
          <div className={c.casHead}>
            <span>The casino</span>
            <strong>{name} is placing a bet</strong>
          </div>
        </div>
        <div className={c.watch}>
          {atTable && <Tok player={atTable} size={40} />}
          <div className={c.watchBody}>
            <strong>At the tables</strong>
            <span>
              {max > 0
                ? `Betting between ${fmt(min)} and ${fmt(max)}`
                : "Choosing a game"}
            </span>
          </div>
        </div>
      </section>
    );
  }

  // ---- my move ------------------------------------------------------------
  const needColour = pick.id === "roulette";
  const disabled = busy || latched || max <= 0;
  const verb = GO_VERB[pick.id] ?? "Bet";

  const controls = (
    <>
      <div className={c.tabs} role="group" aria-label="Pick a game">
        {CASINO_GAMES.map((g) => {
          const Ico = GAME_ICON[g.id] ?? Spade;
          const on = g.id === pick.id;
          return (
            <button
              key={g.id}
              type="button"
              className={c.tab}
              aria-pressed={on}
              aria-label={`${g.name} — ${g.odds}`}
              onClick={() => setGame(g.id)}
              disabled={disabled}
            >
              <Ico size={18} aria-hidden="true" />
              {g.name}
            </button>
          );
        })}
      </div>

      {/* The real odds for the game that is actually selected. Never a
          summary, never "great prizes": a bet the player cannot price is a
          bet they did not agree to. */}
      <p className={c.odds}>
        {pick.odds}. <b>×2</b> means you end holding twice your bet.
      </p>

      <div className={c.bet}>
        <div className={c.betTop}>
          <div className={c.betSum}>
            {/* The 15% floor, stated rather than implied. A slider that refuses
                to go below a number reads as broken unless something says where
                the number comes from, and this one is not the player's choice
                to make: the server recomputes it from live cash and rejects
                anything under it. */}
            <span className={c.betLab}>Bet · min {fmt(min)} (15%)</span>
            <strong>{fmt(value)}</strong>
          </div>
          <div className={c.jumps}>
            <button
              type="button"
              className={c.jump}
              aria-pressed={value === min}
              aria-label={`Bet the minimum, ${fmt(min)}`}
              onClick={() => setBet(min)}
              disabled={disabled}
            >
              Min
            </button>
            <button
              type="button"
              className={c.jump}
              aria-pressed={value === max}
              aria-label={`Bet everything, ${fmt(max)}`}
              onClick={() => setBet(max)}
              disabled={disabled || max <= min}
            >
              All in
            </button>
          </div>
        </div>
        <input
          className={c.slider}
          type="range"
          min={min}
          max={Math.max(max, min)}
          step={STEP}
          value={value}
          /* --fill paints the track up to the thumb on WebKit, which has no
             ::-moz-range-progress equivalent of its own. */
          style={{ "--fill": `${max > min ? ((value - min) / (max - min)) * 100 : 100}%` }}
          onChange={(e) => setBet(snap(e.target.value, min, max))}
          disabled={disabled || max <= min}
          aria-label={`Your bet — ${floorLine}`}
          aria-valuetext={fmt(value)}
        />
      </div>

      {refusal && (
        <p className={c.refusal} role="alert">
          {refusal}
        </p>
      )}

      {/* Deliberately alone. There is no Decline, no Skip and no Later. */}
      <button
        type="button"
        className={c.go}
        onClick={send}
        disabled={disabled}
        aria-disabled={disabled || undefined}
        aria-label={`Bet ${fmt(value)} on ${pick.name}${needColour ? `, ${colour}` : ""}`}
      >
        <span className={c.goMain}>
          {verb} {fmt(value)}
        </span>
        <span className={c.goHint}>
          {pick.name}
          {needColour ? ` · on ${colour}` : ""}
        </span>
      </button>
    </>
  );

  return (
    <>
      {/* Stays where ClientScreen mounted the panel; the frame itself is
          portalled to the [data-client] root this anchor sits under. */}
      <span ref={anchor} hidden />
      <CasinoRoom
        host={host}
        role="dialog"
        label="The casino. You must place a bet."
        sub="You must play · the bank is the house"
        aside={
          <>
            <span className={c.asideLab}>Cash</span>
            <strong>{fmt(max)}</strong>
          </>
        }
        enter="rise"
        trap
        footRef={foot}
        machine={
          <CasinoMachine
            game={pick.id}
            pick={colour}
            onPick={needColour ? setColour : null}
            disabled={disabled}
          />
        }
        foot={
          <>
            <p className={b.sr} aria-live="polite">
              You landed on the Casino. You must place a bet of at least {fmt(min)}.
            </p>
            {controls}
          </>
        }
      />
    </>
  );
}
