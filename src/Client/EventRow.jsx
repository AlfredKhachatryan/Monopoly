// CONTRACT (shared with the sheets): EventRow({ event, ctx, fresh, size }).
//
// Renders exactly one <li> in the prototype's `.ev` layout and nothing else, so
// the three-deep list in the aura and the full history in the game sheet are
// literally the same row:
//
//   [actor token] [event icon] [object mark or token] [name, truncated] [badge]
//
// Returns null when the event is not describable (turn dividers, land, …), so a
// caller can map over a raw log without filtering first — though the aura does
// filter, because it wants the latest three *describable* events.
//
// `ctx` = { players, board, meFig }.
// `fresh` plays the enter animation; the caller decides what counts as new.
// `size` scales the actor token, the object mark and the event icon together
// (default 26, unchanged from before this prop existed — the TV feed passes
// 32). It sets --ev-size/--ev-ic on the <li>, which events.module.css's
// .evIc reads for its own box and inner svg.
//
// The row background reads --ev-row-bg, so the game sheet can set it to
// var(--sunk) on its list without touching this file.
//
// ---- reading a row that does not fit --------------------------------------
//
// The visible label was always ONE line with an ellipsis, and on a 360px phone
// that cuts "Статуя Гая", "Rainbox 6 Siege", every trade and auction line and
// every card text — with no way at all to read the rest. describeEvent()
// already returns the whole sentence as `text` (it is what the screen-reader
// label has always used); these three props just let a caller put it on screen:
//
//   wrap        let the label run to 3 lines instead of truncating. The full
//               log turns this on; the aura's 3-row preview does not, because
//               that block sits above the ticket and the roll button and is not
//               allowed to grow.
//   expandable  make the row a button. `aria-expanded`, ≥44px, focus-visible.
//   expanded    show `text` — the complete sentence, no clamp — instead of the
//               short label.

import { playerByFig } from "../Hooks/rules";
import { describeEvent } from "./EventView";
import { hasCyrillic } from "./boardDisplay";
import Mark from "./Mark";
import Tok from "./Tok";
import b from "./bits.module.css";
import e from "./events.module.css";

export default function EventRow({
  event,
  ctx,
  fresh = false,
  size = 26,
  wrap = false,
  expandable = false,
  expanded = false,
  onToggle,
  onOpen,
}) {
  const d = describeEvent(event, ctx);
  if (!d) return null;

  const Ico = d.icon;
  const actor = d.actorFig ? playerByFig(ctx.players, d.actorFig) : null;
  const objectCell = d.objectCell != null ? ctx.board?.[d.objectCell] : null;
  const objectPlayer = !objectCell && d.objectFig ? playerByFig(ctx.players, d.objectFig) : null;
  const visible = d.label ?? d.text ?? "";
  // Without this a screen reader hears only the visual label plus the badge
  // number ("You" · "7"), never a real sentence. `text` is the full sentence;
  // fall back to whatever is visible so a row without one still says
  // something.
  const sentence = d.text || visible;
  const icSize = Math.round(size * 0.58);
  // A row is only worth tapping when opening it would actually show more than
  // it already does. A short "Koli joined" that is already complete stays an
  // inert <li> rather than a button that does nothing.
  const truncated = !!sentence && sentence !== visible;
  const hasMore = expandable && truncated;
  // The aura's preview cannot grow — it sits directly above the ticket, the
  // dice and the roll button — so a row there does not open in place. It hands
  // the whole log its key instead, and the sheet opens AT that row.
  const opensLog = !expandable && !!onOpen && truncated;
  const shown = expanded ? sentence : visible;
  // Anything that is not one clamped line has to top-align, or a two-line label
  // drags the token and the badge down to its own centre.
  const multiline = expanded || wrap;

  const inner = (
    <>
      {actor && <Tok player={actor} size={size} />}
      <span className={e.evIc}>{Ico && <Ico size={icSize} />}</span>
      {objectCell && <Mark cell={objectCell} size={size} radius={Math.round(size * 0.3)} />}
      {objectPlayer && <Tok player={objectPlayer} size={size} />}
      {sentence && <span className={b.sr}>{sentence}</span>}
      <span
        className={`${e.evName} ${expanded ? e.evFull : wrap ? e.evWrap : ""}`}
        aria-hidden="true"
        lang={hasCyrillic(shown) ? "ru" : undefined}
      >
        {shown}
      </span>
      {d.badge?.text && (
        <span className={`${e.badge} ${d.badge.tone ? e[d.badge.tone] : ""}`} aria-hidden="true">
          {d.badge.text}
        </span>
      )}
    </>
  );

  return (
    <li
      className={`${e.ev} ${fresh ? e.isNew : ""}`}
      style={{ "--ev-size": `${size}px`, "--ev-ic": `${icSize}px` }}
    >
      {hasMore || opensLog ? (
        <button
          type="button"
          className={`${e.evIn} ${e.evTap} ${multiline ? e.evTop : ""}`}
          aria-expanded={hasMore ? expanded : undefined}
          aria-label={opensLog ? `${sentence} — open in the full log` : sentence}
          onClick={hasMore ? onToggle : onOpen}
        >
          {inner}
        </button>
      ) : (
        <span className={`${e.evIn} ${multiline ? e.evTop : ""}`}>{inner}</span>
      )}
    </li>
  );
}
