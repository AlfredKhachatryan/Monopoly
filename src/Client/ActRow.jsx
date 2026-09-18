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

export default function ActRow({
  dice,
  roll,
  diceLabel,
  primary,
  pass,
  alts = [],
  diceSize = 44,
}) {
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
            >
              {label(b)}
            </button>
          ))}
        </div>
      )}

      <div className={s.act}>
        <div className={s.dicebox}>
          <RollDice
            values={dice}
            roll={roll}
            size={diceSize}
            gap={diceSize >= 44 ? 8 : 6}
            label={diceLabel}
          />
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
