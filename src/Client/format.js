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
