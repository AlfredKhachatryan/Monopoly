// The action row: the dice, the one big thing to press, and — when there is a
// yes/no to answer — Pass beside it.
//
// `alts` is the row of outlined buttons above it. Two situations need it: jail,
// where Pay and Use jail card sit next to Roll for doubles, and a buy/build
// decision, where the act row is taken over by Buy + Pass and the turn's own
// action (End turn / Roll again) would otherwise have nowhere to go. Nothing
// that can be pressed today ever loses its button.
//
// The dice are the shared RollDice (phone and TV), driven by the reveal
// buffer's `roll` descriptor rather than by the game state: they start on the
// tap and come to rest 1.5s later, and only then does anything the roll caused
// appear.
//
// While that beat runs the primary button IS the waiting state — "Rolling…"
// with a quiet ellipsis and a thin sweep along its bottom edge. It is the same
// disabled-while-busy button it always was, wearing what it is doing.

import RollDice from "./RollDice";
import s from "./screen.module.css";

function label(b) {
  return [b?.verb, b?.amount].filter(Boolean).join(" ");
}

// The doubles run, on the tray itself. One element per beat, all of them
// `pointer-events: none` overlays that are SIBLINGS of the dice — never
// ancestors — so nothing they do (a clip for the jail bars, an opacity for the
// tint) can reach into the cube's 3D context and flatten it.
const FX_TONE = { d1: "good", d2: "warn", d3: "bad", jail: "info" };

export default function ActRow({
  dice,
  roll,
  fx = null,
  doubles = 0,
  diceLabel,
  primary,
  pass,
  alts = [],
  diceSize = 36,
}) {
  // 0-3 segments, shown for as long as the run is alive. The third only ever
  // lights during the busted beat itself: the server resets the counter to 0 in
  // the same batch as the jail event, so `fx.kind === "d3"` is what says "three"
  // — the counter never gets there.
  const heat = fx?.kind === "d3" ? 3 : Math.max(0, Math.min(3, doubles));

  return (
    <>
      {alts.length > 0 && (
        <div className={s.alts}>
          {alts.map((b) => (
            <button
              key={b.key || label(b)}
              type="button"
              className={s.alt}
              onClick={b.onClick}
              disabled={b.disabled}
              aria-disabled={b.disabled || undefined}
              // A disabled button that only shrugs ("Pay 50$", greyed out) reads
              // as a bug on a phone with no hover/title to explain it. Same rule
              // the primary button's own `.ph` hint already follows — say why.
              aria-label={b.hint ? `${label(b)} — ${b.hint}` : undefined}
            >
              {label(b)}
              {b.hint && <span className={s.altHint}>{b.hint}</span>}
            </button>
          ))}
        </div>
      )}

      <div className={s.act}>
        <div className={s.dicebox} data-heat={heat > 0 ? heat : undefined}>
          <RollDice
            values={dice}
            roll={roll}
            fx={fx}
            size={diceSize}
            gap={diceSize >= 36 ? 8 : 6}
            label={diceLabel}
          />

          {/* The warm / danger wash over the tray. Opacity only. */}
          {fx && (
            <span
              key={`tint-${fx.id}`}
              className={s.dfxTint}
              data-kind={fx.kind}
              aria-hidden="true"
            />
          )}

          {/* The ring that snaps out of the tray on every double. */}
          {fx && fx.kind !== "jail" && (
            <span
              key={`ring-${fx.id}`}
              className={s.dfxRing}
              data-tone={FX_TONE[fx.kind]}
              aria-hidden="true"
            />
          )}

          {/* Bars drop over the tray when the dice have actually jailed you.
              Its own rounded clip, and it is a SIBLING of the dice, so the
              overflow never touches the cube's 3D context. */}
          {fx && (fx.kind === "d3" || fx.kind === "jail") && (
            <span
              key={`bars-${fx.id}`}
              className={s.dfxBars}
              data-kind={fx.kind}
              aria-hidden="true"
            >
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
          )}

          {/* How hot the run is, for as long as it lasts. Persistent, not a
              beat: it is the thing you can look at to know where you stand. */}
          {heat > 0 && (
            <span
              className={s.heat}
              data-n={heat}
              role="img"
              aria-label={`${heat} of 3 doubles`}
            >
              <i className={heat >= 1 ? s.heatOn : undefined} />
              <i className={heat >= 2 ? s.heatOn : undefined} />
              <i className={heat >= 3 ? s.heatOn : undefined} />
            </span>
          )}
        </div>

        {primary && (
          <button
            type="button"
            className={s.primary}
            onClick={primary.onClick}
            disabled={primary.disabled}
            aria-disabled={primary.disabled || undefined}
          >
            <span className={s.pvpa}>
              <span className={s.pv}>
                {primary.verb}
                {primary.rolling && (
                  <span className={s.ell} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                )}
              </span>
              {primary.amount && <span className={s.pa}>{primary.amount}</span>}
            </span>
            {primary.hint && <span className={s.ph}>{primary.hint}</span>}
            {primary.rolling && <span className={s.sweep} aria-hidden="true" />}
          </button>
        )}

        {pass && (
          <button
            type="button"
            className={s.pass}
            onClick={pass.onClick}
            disabled={pass.disabled}
            aria-disabled={pass.disabled || undefined}
          >
            {pass.verb}
          </button>
        )}
      </div>
    </>
  );
}
