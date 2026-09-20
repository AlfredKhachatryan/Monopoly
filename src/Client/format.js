// Money, the way the phone controller writes it: the sign leads, the currency
// trails — `1755$`, `−18$` with a true minus so it lines up with the digits
// instead of hanging off them like a hyphen does.
//
// Below 10000 a separator only adds noise, so there is none. Above it a narrow
// no-break space keeps `12 500$` readable without widening the number enough to
// break the big cash line on a 360px phone.

const MINUS = "−"; // U+2212 MINUS SIGN
const THIN = " "; // U+202F NARROW NO-BREAK SPACE

function digits(n) {
  const a = Math.abs(n);
  if (a < 10000) return String(a);
  return String(a).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

// CONTRACT: fmt(number) -> string. Used by the sheets too.
export const fmt = (n) => {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? MINUS : ""}${digits(v)}$`;
};

// The same, but a gain keeps its plus: `+200$` / `−18$`. For event badges.
export const fmtSigned = (n) => {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? MINUS : "+"}${digits(v)}$`;
};

// Server-provided prose ("Bank pays you a dividend of $50.") still writes
// money the `$50` way. This rewrites every `$<number>` it finds to the
// client's own `50$` format, leaving everything else untouched. Display-only:
// never apply this to anything sent back to the server or kept in state.
export const fmtText = (s) =>
  String(s ?? "").replace(/\$\s?(\d[\d,]*)/g, (_, n) => fmt(Number(n.replace(/,/g, ""))));

// ---- jail, in one voice --------------------------------------------------
//
// The banner and the ticket both talk about the same three turns and they used
// to word it differently — "In jail · roll 2 of 3, or pay 50$" on one and
// "In jail · turn 2 of 3" on the other, on the same screen at the same time.
// Both now come out of here, so the count and the noun can never disagree
// again. The noun is ROLL: a turn in jail is not a turn, it is an attempt, and
// "roll 3 of 3" is what the last-chance line has to build on.
//
//   jailLine(me)              -> "In jail · roll 2 of 3"            (the ticket)
//   jailLine(me, { full: 1 }) -> "… , or pay 50$" / the last-roll warning
//
// `jailTurns` counts attempts ALREADY served (0..2), so the one about to be
// made is jailTurns + 1.
export function jailLine(me, { full = false, fine = 50, max = 3 } = {}) {
  const attempt = Math.min((Number(me?.jailTurns) || 0) + 1, max);
  const base = `In jail · roll ${attempt} of ${max}`;
  if (!full) return base;
  return attempt >= max
    ? `${base} — the last one; a non-double takes the ${fmt(fine)} fine`
    : `${base}, or pay ${fmt(fine)}`;
}
