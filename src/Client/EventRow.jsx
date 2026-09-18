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

import { playerByFig } from "../Hooks/rules";
import { describeEvent } from "./EventView";
import { hasCyrillic } from "./boardDisplay";
import Mark from "./Mark";
import Tok from "./Tok";
import b from "./bits.module.css";
import e from "./events.module.css";

export default function EventRow({ event, ctx, fresh = false, size = 26 }) {
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

  return (
    <li
      className={`${e.ev} ${fresh ? e.isNew : ""}`}
      style={{ "--ev-size": `${size}px`, "--ev-ic": `${icSize}px` }}
    >
      {actor && <Tok player={actor} size={size} />}
      <span className={e.evIc}>{Ico && <Ico size={icSize} />}</span>
      {objectCell && <Mark cell={objectCell} size={size} radius={Math.round(size * 0.3)} />}
      {objectPlayer && <Tok player={objectPlayer} size={size} />}
      {sentence && <span className={b.sr}>{sentence}</span>}
      <span className={e.evName} aria-hidden="true" lang={hasCyrillic(visible) ? "ru" : undefined}>
        {visible}
      </span>
      {d.badge?.text && (
        <span className={`${e.badge} ${d.badge.tone ? e[d.badge.tone] : ""}`} aria-hidden="true">
          {d.badge.text}
        </span>
      )}
    </li>
  );
}
