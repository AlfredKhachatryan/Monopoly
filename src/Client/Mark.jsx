// CONTRACT (shared with the sheets): Mark({ cell, size, radius, className }).
//
// The rounded tinted square that stands for one board space. It takes its
// background from accentFor(cell) — the same function that tints the whole
// screen — so a space looks the same in the ticket, on an event row and in a
// sheet list.
//
// Special spaces, railroads and utilities get an icon. A street named after a
// real brand (marks.js) gets that brand's logo. Everything else gets a
// two-letter monogram: the initials of the first two words, or the first two
// letters of a single word. Names on this board are Russian as often as not, so
// the split is done over code points, never over bytes or char codes.

import {
  Armchair,
  Droplets,
  Flag,
  Gift,
  Landmark,
  Lightbulb,
  Lock,
  Siren,
  Sparkles,
  TrainFront,
} from "lucide-react";
import { accentFor, cellKind, readableOn } from "../Hooks/rules";
import b from "./bits.module.css";
import { markFor } from "./marks";
import m from "./marks.module.css";

const KIND_ICON = {
  start: Flag,
  tax: Landmark,
  chance: Sparkles,
  community: Gift,
  jail: Lock,
  gtj: Siren,
  parking: Armchair,
  road: TrainFront,
};

function iconFor(cell) {
  const kind = cellKind(cell);
  if (kind === "communal") return cell?.info === "Water" ? Droplets : Lightbulb;
  return KIND_ICON[kind] || null;
}

export function monogramOf(name) {
  const words = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "??";
  const out =
    words.length > 1
      ? Array.from(words[0])[0] + Array.from(words[1])[0]
      : Array.from(words[0]).slice(0, 2).join("");
  return out.toLocaleUpperCase();
}

// The prototype's monogram does not scale linearly with the square: a 26px mark
// carries proportionally more letter than a 52px one.
function monoSize(size) {
  if (size >= 44) return Math.round(size * 0.29);
  if (size >= 34) return Math.round(size * 0.33);
  return Math.round(size * 0.38);
}

export default function Mark({ cell, size = 52, radius = 16, className = "" }) {
  const tint = accentFor(cell);
  const Ico = iconFor(cell);
  const logo = markFor(cell);
  return (
    <span
      className={`${b.mark} ${className}`}
      style={{
        "--mk": `${size}px`,
        "--mk-r": `${radius}px`,
        "--mk-bg": tint,
        "--mk-fg": readableOn(tint),
      }}
      aria-hidden="true"
    >
      {logo ? (
        <svg
          className={m.logo}
          viewBox={logo.viewBox}
          width={Math.round(size * 0.54)}
          height={Math.round(size * 0.54)}
          fill="currentColor"
          stroke="none"
        >
          <path d={logo.d} />
        </svg>
      ) : Ico ? (
        <Ico size={Math.round(size * 0.52)} strokeWidth={2} />
      ) : (
        <span className={b.mono} style={{ fontSize: `${monoSize(size)}px` }}>
          {monogramOf(cell?.header)}
        </span>
      )}
    </span>
  );
}
