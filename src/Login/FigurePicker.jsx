// The four characters, as a real radiogroup.
//
// One card per figure, in the treatment the figure manual reserves for them:
// the full figure on a stage washed with 14% of its own colour, its name
// underneath, and a ring in that colour when it is the pick. A figure somebody
// in the room already has drops out of the tab order entirely and goes to a
// one-colour silhouette in --muted — "gone", rather than "the same picture,
// dimmer" (design-reference/figures-manual.html, §Silhouettes).
//
// Keyboard: one tab stop for the whole group (the checked card, or the first
// card that can still be taken), arrows move between the cards that are free
// and check as they go — the standard radio-group behaviour, which is what a
// screen-reader user is told to expect by role="radiogroup".

import { useRef } from "react";

import Figure from "../Client/Figure";
import { FIG_COLORS } from "../Hooks/rules";

import { FIGS, FIGURE_ASPECT, FIGURE_SILHOUETTE, nameOf } from "./figureMeta";
import s from "./login.module.css";

export default function FigurePicker({
  value,
  takenBy = {},
  onPick,
  size = 72,
  labelId,
  allDisabled = false,
}) {
  const refs = useRef({});

  const free = FIGS.filter((f) => !allDisabled && !takenBy[f]);
  // Exactly one tab stop into the group: the pick, else the first free card.
  // With nothing free the group holds no tab stop at all, which is correct —
  // there is no choice left to make.
  const tabStopKey = free.includes(value) ? value : (free[0] ?? null);

  function move(fromKey, step) {
    if (free.length === 0) return;
    const i = free.indexOf(fromKey);
    const next = free[((((i < 0 ? 0 : i) + step) % free.length) + free.length) % free.length];
    if (!next) return;
    onPick(next);
    // preventScroll: the root is `overflow: clip` and the panel is its own
    // scroll container — a focus() that scrolls has nowhere legitimate to go
    // and used to drag the whole screen off its own floor in this project.
    refs.current[next]?.focus({ preventScroll: true });
  }

  function onKeyDown(e, key) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(key, 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(key, -1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(free[free.length - 1], 1);
    } else if (e.key === "End") {
      e.preventDefault();
      move(free[0], -1);
    }
  }

  return (
    <div className={s.picker} role="radiogroup" aria-labelledby={labelId}>
      {FIGS.map((fig) => {
        const label = nameOf(fig);
        const taker = takenBy[fig];
        const taken = allDisabled || !!taker;
        const checked = value === fig;
        // The one card that is disabled but must NOT read as gone: the figure
        // a returning player is already playing. It is their face on this
        // screen, so it keeps its colour and wears the ring.
        const mine = allDisabled && checked;
        const gone = taken && !mine;
        const sil = gone && FIGURE_SILHOUETTE?.[fig];

        return (
          <button
            key={fig}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={
              taken && !mine ? `${label}, taken${taker?.name ? ` by ${taker.name}` : ""}` : label
            }
            disabled={taken}
            tabIndex={taken ? -1 : tabStopKey === fig ? 0 : -1}
            ref={(node) => {
              refs.current[fig] = node;
            }}
            className={`${s.card} ${checked ? s.cardOn : ""} ${gone ? s.cardOff : ""}`}
            style={{ "--fc": FIG_COLORS[fig] }}
            onClick={() => onPick(fig)}
            onKeyDown={(e) => onKeyDown(e, fig)}
          >
            <span className={s.cardArt} style={{ height: size }}>
              {sil ? (
                // An <img> cannot take currentColor, so the silhouette is a
                // mask over a --muted fill: same file, exact colour control,
                // and it follows the theme without a filter stack.
                <span
                  className={s.cardSil}
                  style={{
                    "--sil": `url("${sil}")`,
                    height: size,
                    width: Math.round(size * FIGURE_ASPECT),
                  }}
                />
              ) : (
                <Figure player={{ figure: fig }} height={size} />
              )}
            </span>
            {gone && taker ? (
              // Whose it is, rather than the word "taken": the silhouette has
              // already said the seat is gone, and the name says the one thing
              // it cannot. A card that is merely un-pickable (every figure, for
              // a returning player) keeps its own name — calling those "taken"
              // would be untrue of the three nobody has.
              <span className={s.cardTag}>{taker.name}</span>
            ) : (
              <span className={s.cardName}>{label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
