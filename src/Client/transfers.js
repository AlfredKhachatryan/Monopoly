// Money moving, read off the events the server already sends.
//
// One grammar for every kind of movement, so the phone toast, the TV banner and
// the flying coins are all descriptions of the same object:
//
//   { id, from, to, amount, reason, cell }
//
// `from` / `to` are figures, and `null` means the bank. Everything the game can
// do to money reduces to that: rent and tax and a card's "pay each player" are
// `pay`, passing Start and a card's dividend are `collect`, buying and building
// are money to the bank, and an accepted trade is up to two transfers at once.
//
// Nothing here reads state — only the batch of events — so the same function
// serves a live batch on the phone and on the TV, and gives both the same
// answer.

export const BANK = null;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

// How loud this movement is allowed to be. Player to player is the headline of
// the game; money to and from the bank is book-keeping; a purchase is a
// decision the player just made themselves and needs the least announcing.
export function weightOf(t, meFig) {
  if (t.reason === "buy" || t.reason === "build") return "quiet";
  if (meFig && (t.from === meFig || t.to === meFig)) return "loud";
  if (t.from != null && t.to != null) return "loud";
  return "soft";
}

export const REASON_TEXT = {
  rent: "rent",
  tax: "tax",
  card: "card",
  repairs: "repairs",
  jailFee: "jail fine",
  auction: "auction",
  passGo: "passing Start",
  trade: "trade",
  // The three the rebalance added. All of them are the BANK moving money, so
  // `from`/`to` is null on one side and the reason is the only thing that says
  // what happened: the Free Parking pot handed over on cell 21, the Weed
  // Farm's pile harvested by its owner, and either half of a casino play (the
  // stake going in and the payout coming back are two separate transfers —
  // never one net figure — so both wear the same word).
  pot: "the Free Parking pot",
  farm: "the farm",
  casino: "the casino",
  // buy / build deliberately have no word of their own: the space they were
  // spent on is named right after the amount, and "Afo pays the bank 260$
  // purchase · Spotify" says the same thing twice.
  // Diplomacy (SPEC-DIPLOMACY.md §1-3): the four money moves that are not
  // already a plain `pay`/`collect`/`trade` (allyUpkeep, commission, backstab
  // and debtShare all carry their OWN event type — see EventView.jsx and
  // transfersFrom() below) get folded into the same toast/banner grammar
  // everything else here already speaks, rather than staying silent just
  // because they arrived on an event this file did not use to know about.
  allyUpkeep: "alliance upkeep",
  commission: "ally commission",
  backstab: "in a backstab",
  debtShare: "toward a shared debt",
  // The declaration fee and an accepted peace payment are BOTH ordinary `pay`
  // events with no headline event of their own carrying the amount (a war's
  // `declare` stage has no `amount` field, and its `peace` stage is a `war`-
  // type event this file does not read at all — see transfersFrom below), so
  // unlike the four reasons above these two are never in danger of a double
  // announcement and never skipped.
  warFee: "war fee",
  peace: "peace payment",
};

/** Every money movement in one batch of events, in the order they happened. */
export function transfersFrom(events) {
  const out = [];
  const list = Array.isArray(events) ? events : [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e || typeof e !== "object") continue;
    const amount = num(e.amount);
    const id = `${i}`;
    if (e.type === "pay" && amount) {
      // Three of the five diplomacy money moves (SPEC-DIPLOMACY.md, and the
      // server's own doubling-up convention — see the REASON_TEXT comment
      // above) log the SAME movement twice on purpose: once as this plain
      // ledger `pay` and once as a dedicated headline event later in this same
      // batch (`allyUpkeep`, `debtShare`, `backstab` below). Reading both sides
      // would hand the caller two transfers for one payment — not just a
      // doubled toast, but for debtShare and backstab (both ends real figures,
      // never the bank) a SECOND transfer with the same `from`+reason trips
      // groupTransfers' "more than one of these" check, and the announcement
      // reads as "X paid everyone" when actually nobody but the one ally/one
      // backstabber was ever paid — this is the exact bug behind "Backstabber
      // pays to all 375". So skip the ledger row here and let the dedicated
      // case below be the only source. warFee and peace are NOT in this list:
      // a war's `declare` event carries no amount at all, and its `peace`
      // event is a `type:'war'` row this function does not read (see the
      // bottom of the loop) — for those two the ledger `pay` is the only place
      // the amount ever appears, so it must come through.
      if (e.reason === "allyUpkeep" || e.reason === "debtShare" || e.reason === "backstab") continue;
      out.push({
        id,
        from: e.figure ?? BANK,
        to: e.to ?? BANK,
        amount,
        reason: e.reason || "pay",
        cell: e.cell ?? null,
      });
    } else if (e.type === "collect" && amount) {
      // Commission's own ledger twin (mono_credit's ordinary `collect`,
      // reason 'commission') is the fourth of those doubled-up movements —
      // same reasoning as the `pay` skip just above, minus the grouping risk
      // (it is always bank-to-ally, so `from` is null and groupTransfers never
      // sees a repeated key), but still a plain duplicate toast without this.
      if (e.reason === "commission") continue;
      out.push({
        id,
        from: BANK,
        to: e.figure ?? BANK,
        amount,
        reason: e.reason || "collect",
        cell: e.cell ?? null,
      });
    } else if (e.type === "buy" && amount) {
      out.push({ id, from: e.figure ?? BANK, to: BANK, amount, reason: "buy", cell: e.cell ?? null });
    } else if (e.type === "build" && amount) {
      out.push({ id, from: e.figure ?? BANK, to: BANK, amount, reason: "build", cell: e.cell ?? null });
    } else if (e.type === "trade" && e.status === "accepted") {
      // Cash can cross in both directions in one deal, and both sides deserve
      // the same treatment as any other transfer.
      const give = num(e.give?.cash);
      const get = num(e.get?.cash);
      if (give) out.push({ id: `${id}g`, from: e.figure, to: e.to, amount: give, reason: "trade", cell: null });
      if (get) out.push({ id: `${id}r`, from: e.to, to: e.figure, amount: get, reason: "trade", cell: null });
    } else if (e.type === "allyUpkeep" && amount) {
      out.push({ id, from: e.figure ?? BANK, to: BANK, amount, reason: "allyUpkeep", cell: null });
    } else if (e.type === "commission" && amount) {
      // The bank PRINTS this (spec: "not taken from the rent itself"), so it
      // has no player-side debit anywhere else in the batch — from is BANK.
      out.push({ id, from: BANK, to: e.figure ?? BANK, amount, reason: "commission", cell: e.cell ?? null });
    } else if (e.type === "backstab" && amount) {
      out.push({ id, from: e.victim ?? BANK, to: e.figure ?? BANK, amount, reason: "backstab", cell: null });
    } else if (e.type === "debtShare" && amount) {
      // The event itself names no recipient for the shortfall — the charge it
      // rescues can be rent, tax, a card fine, jail fee or repairs (§1), each
      // with its own payee — so this shows the ally's side of the story: cash
      // leaving them to keep the payer whole, which is the pairing worth a
      // "who just helped whom" toast even though the payer forwards it on.
      out.push({ id, from: e.ally ?? BANK, to: e.figure ?? BANK, amount, reason: "debtShare", cell: null });
    }
  }
  return out;
}

// "Pay each player 50$" is three separate transfers with one story. Same for a
// card that collects 10$ from everybody. One banner, one cascade.
//
// Returns the transfers with a `group` key attached: transfers sharing a group
// are one announcement.
export function groupTransfers(list) {
  const byKey = new Map();
  for (const t of list) {
    const key = t.from != null && t.to != null ? `${t.from}>${t.reason}` : null;
    if (!key) continue;
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
  }
  const byTo = new Map();
  for (const t of list) {
    const key = t.from != null && t.to != null ? `${t.to}<${t.reason}` : null;
    if (!key) continue;
    byTo.set(key, (byTo.get(key) ?? 0) + 1);
  }
  return list.map((t) => {
    if (t.from == null || t.to == null) return { ...t, group: null };
    const out = `${t.from}>${t.reason}`;
    const into = `${t.to}<${t.reason}`;
    if ((byKey.get(out) ?? 0) > 1) return { ...t, group: { kind: "each-out", key: out, who: t.from } };
    if ((byTo.get(into) ?? 0) > 1) return { ...t, group: { kind: "each-in", key: into, who: t.to } };
    return { ...t, group: null };
  });
}

/**
 * Everything one batch of events has to say about money, ready to show:
 * grouped, totalled, and labelled with how loud it is allowed to be.
 * The phone and the TV both start here, so they always agree on what happened.
 */
export function announceBatch(events, meFig = null) {
  return announcements(transfersFrom(events)).map((a) => {
    const total = a.members.reduce((n, t) => n + t.amount, 0);
    // "Pay each player 50$" is three transfers of 50$, and the sentence the
    // card told everyone is "50$", not "150$". So a group whose members are all
    // the same size is announced at that size; an uneven one falls back to the
    // sum, which is the only honest single number left.
    const even = a.members.every((t) => t.amount === a.members[0].amount);
    const shown = a.group && even ? a.members[0].amount : total;
    const involvesMe =
      meFig != null && a.members.some((t) => t.from === meFig || t.to === meFig);
    const weights = a.members.map((t) => weightOf(t, meFig));
    const weight = weights.includes("loud")
      ? "loud"
      : weights.includes("soft")
        ? "soft"
        : "quiet";
    return { ...a, total, shown, involvesMe, weight };
  });
}

/** One entry per announcement: a single transfer, or a whole pay-each. */
export function announcements(list) {
  const grouped = groupTransfers(list);
  const seen = new Set();
  const out = [];
  for (const t of grouped) {
    if (!t.group) {
      out.push({ key: t.id, lead: t, members: [t], group: null });
      continue;
    }
    if (seen.has(t.group.key)) {
      out[out.findIndex((a) => a.group?.key === t.group.key)].members.push(t);
      continue;
    }
    seen.add(t.group.key);
    out.push({ key: t.group.key, lead: t, members: [t], group: t.group });
  }
  return out;
}
