// One server event, described.
//
// `describeEvent` returns two views of the same event and the caller picks:
//
//   text            a whole sentence, for prose
//   icon / tone     how it reads
//   actorFig        who did it            -> the token at the head of a row
//   objectCell      what it was done to   -> a Mark
//   objectFig       who it was done to    -> a Tok
//   label           the short middle of a row, with the subject left out when
//                   the actor token already says it
//   badge           { text, tone } for the right edge
//
// Badge rule from the design: money that moved for ME is signed and coloured;
// money that moved for someone else is a plain neutral badge; a roll shows the
// number; a build shows "2 houses" / "Hotel". The `card` case is the one
// deliberate exception, and says there why.
//
// Event shapes come from game_action; see the migration header for the list.

import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Ban,
  Cannabis,
  Coins,
  Dices,
  Flag,
  Gavel,
  Gift,
  Hammer,
  Handshake,
  LifeBuoy,
  Lock,
  LockOpen,
  MapPin,
  PartyPopper,
  Percent,
  RotateCcw,
  ShieldOff,
  ShoppingBag,
  Skull,
  Spade,
  Sparkles,
  Sprout,
  Swords,
  Trophy,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { nameOfFig } from "../Hooks/rules";
import { GAME_NAME, multLabel } from "./casinoGames";
import { fmt, fmtSigned, fmtText } from "./format";

const REASON = {
  rent: "rent",
  tax: "tax",
  jailFee: "the jail fine",
  repairs: "repairs",
  card: "a card",
  passGo: "for passing Start",
  // Three new bank movements (20260920170000_casino_farm_rebalance.sql). The
  // first two are money the bank PRINTS — the Free Parking pot handed over and
  // the Weed Farm's harvest — and the third is both halves of a casino play,
  // which is settled as a `pay` of the bet followed by a `collect` of the
  // payout rather than as one net figure.
  pot: "from the Free Parking pot",
  farm: "from the farm",
  casino: "at the casino",
  // Diplomacy's own bank movements. `warFee`/`peace` are guesses at the `pay`
  // reason the SQL migration uses for the war declaration fee and an accepted
  // peace payment — the spec's event list gives both their own `war` stage
  // instead of a dedicated shape, so there is no contract name for the `pay`
  // row that (presumably) carries the money. Harmless if the guess is wrong:
  // an unrecognised reason still renders, just without this word — see the
  // `REASON_SHORT` fallback in the `pay` case below.
  warFee: "the war fee",
  peace: "a peace payment",
};

// The short suffix a rent row's `mods` array earns on top of its own reason —
// see SPEC-DIPLOMACY.md "Rent, in one place": the `pay` event for rent
// carries `mods: string[]` from "war" | "allyTax" | "traitor" so a doubled or
// taxed rent never just disagrees with the deed card's own chips (Ticket.jsx)
// without saying why.
const MOD_LABEL = { war: "war ×2", allyTax: "alliance +25%", traitor: "traitor +25%" };

// The same reasons, short enough to sit on one row next to a badge.
const REASON_SHORT = {
  rent: "Rent",
  tax: "Tax",
  jailFee: "Jail fine",
  repairs: "Repairs",
  card: "Card",
  passGo: "Passing Start",
  pot: "Free Parking pot",
  farm: "Harvest",
  casino: "Casino",
};

const JAIL_WHY = {
  gtj: " from Go To Jail",
  doubles: " for three doubles",
  card: " on a card",
};

const LEAVE_HOW = {
  doubles: " by rolling doubles",
  fee: " by paying the fine",
  pay: " by paying the fine",
  card: " with a card",
};

// `ctx` = { players, board, meFig }
export function describeEvent(ev, ctx) {
  const { players, board, meFig } = ctx;
  const Subject = (fig, lower = false) =>
    fig === meFig ? (lower ? "you" : "You") : nameOfFig(players, fig);
  // "X's rent" reads fine; "you's rent" does not — same fix the `trade` case
  // below already applies as `whose`, generalised so debtShare gets it too.
  const possessive = (fig) => (fig === meFig ? "your" : `${nameOfFig(players, fig)}'s`);
  const cellName = (id) => board?.[id]?.header ?? `cell ${id}`;
  const mine = ev.figure === meFig;

  // A money badge: signed and coloured when the money was mine, neutral when it
  // was somebody else's business.
  const moneyBadge = (amount, dir, forMe) =>
    forMe
      ? { text: fmtSigned(dir * Math.abs(amount)), tone: dir > 0 ? "pos" : "neg" }
      : { text: fmt(Math.abs(amount)), tone: null };

  switch (ev.type) {
    case "roll":
      return {
        icon: Dices,
        actorFig: ev.figure,
        label: `${Subject(ev.figure)}${ev.doubles ? " · doubles" : ""}`,
        badge: { text: String(ev.d1 + ev.d2), tone: null },
        text: `${Subject(ev.figure)} rolled ${ev.d1 + ev.d2}${ev.doubles ? " · doubles" : ""}`,
      };

    case "move":
      return {
        icon: MapPin,
        actorFig: ev.figure,
        objectCell: ev.to,
        label: cellName(ev.to),
        text: `${Subject(ev.figure)} → ${cellName(ev.to)}`,
      };

    case "collect":
      // Three of the bank's payouts arrive WITH a headline event of their own
      // in the same batch — the Free Parking pot, the farm harvest and a
      // winning casino bet — and that event says the amount too. Same fold the
      // auction's `pay` has always done below, and for the same reason: two
      // rows for one thing that happened once reads as a bug. The money itself
      // is untouched, and transfers.js still announces it on the money layer.
      if (ev.reason === "pot" || ev.reason === "farm" || ev.reason === "casino") return null;
      // Diplomacy made a fourth: the ally's 10% arrives as a `commission` event
      // AND (the server keeps every movement reconstructible from the log, the
      // same convention as the casino) an ordinary `collect` with
      // reason 'commission'. The headline row already says the amount.
      if (ev.reason === "commission") return null;
      return {
        icon: ArrowDownLeft,
        tone: "in",
        actorFig: ev.figure,
        label: REASON_SHORT[ev.reason] || Subject(ev.figure),
        badge: moneyBadge(ev.amount, 1, mine),
        text: `${Subject(ev.figure)} collected ${fmt(ev.amount)}${
          ev.reason === "passGo" ? " for passing Start" : ev.reason === "card" ? " from a card" : ""
        }`,
      };

    case "pay":
      // An auction's winner pays for what they won, and the auction_won row
      // right next to it already says the amount. Two rows for one fact read as
      // a bug, so this one is not drawn — the event itself still exists, and
      // the cash line and the sounds still use it.
      //
      // A casino bet is the same shape: the play is settled as a `pay` of the
      // stake and then a `collect` of the payout (never one net figure — see
      // the payout convention in casinoGames.js), and the `casino` result row
      // below carries the swing those two add up to.
      if (ev.reason === "auction" || ev.reason === "casino") return null;
      // Diplomacy's money follows the same convention (alliance_war.sql): each
      // movement is logged twice on purpose — once as its own headline event
      // (`allyUpkeep`, `debtShare`, `war` declare / peace, `backstab`) and once
      // as the plain `pay` that lets a balance be rebuilt from the log. The
      // headline row carries the amount, so the ledger row is not drawn. These
      // five reason strings are the server's, verbatim.
      if (
        ev.reason === "allyUpkeep" ||
        ev.reason === "debtShare" ||
        ev.reason === "warFee" ||
        ev.reason === "peace" ||
        ev.reason === "backstab"
      )
        return null;
      // Diplomacy's own footnote on a rent row: the `mods` array the spec
      // gives the rent `pay` event ("war" | "allyTax" | "traitor"), rendered
      // as the same short words the deed card's own chips use (Ticket.jsx's
      // `modChips`) so the two never tell a different story about the same
      // number.
      const modsList = ev.reason === "rent" && Array.isArray(ev.mods) ? ev.mods : [];
      const modsSuffix = modsList.length
        ? ` (${modsList.map((mkey) => MOD_LABEL[mkey] || mkey).join(", ")})`
        : "";
      return {
        icon: ArrowUpRight,
        tone: mine ? "out" : ev.to === meFig ? "in" : null,
        actorFig: ev.figure,
        objectFig: ev.to || undefined,
        label: ev.to
          ? `${REASON_SHORT[ev.reason] || "Paid"} → ${Subject(ev.to, true)}${modsSuffix}`
          : `${REASON_SHORT[ev.reason] || Subject(ev.figure)}${modsSuffix}`,
        // Rent I receive is a gain for me even though somebody else paid it.
        badge: moneyBadge(ev.amount, mine ? -1 : 1, mine || ev.to === meFig),
        text: ev.to
          ? `${Subject(ev.figure)} paid ${fmt(ev.amount)} ${REASON[ev.reason] || ""} to ${Subject(
              ev.to,
              true,
            )}${modsSuffix}`.replace(/\s+/g, " ")
          : // `modsSuffix` is always empty here in practice — rent always has a
            // `to` (the owner) and takes the branch above, so this bank-payment
            // branch never carries mods — but it is still appended rather than
            // assumed away, so a future reason that both lacks `to` AND carries
            // `mods` is not silently dropped.
            `${Subject(ev.figure)} paid ${fmt(ev.amount)} ${REASON[ev.reason] || ""}${modsSuffix}`.replace(
              /\s+$/,
              "",
            ),
      };

    // A card draw is TWO events in the log, not one. `mono_land` pushes this
    // `card`, then `mono_apply_card` pushes its OWN collect/pay right behind it
    // with the SAME seq (reason `card` or `repairs`, and PLURAL for payEach /
    // collectEach), and both of them describe perfectly well on their own. A
    // list that draws every describable event therefore drew one card draw as
    // two rows — a bare "Card · 10$" over the card's whole sentence — which the
    // owner read, correctly, as two notifications for one thing that happened
    // once (see handoff/tv-feed-and-notifications.md, report 1).
    //
    // So a caller is allowed to FOLD: sum the card's own money events, drop
    // their rows, and hand the signed total back here on the event as
    // `cardAmount`. Nothing on the wire carries that field — neither the
    // migration nor the mock ever writes it — so a caller that has not folded
    // anything (the phone's aura preview, the full log in GameSheet) gets
    // exactly the badge-less card row it has always got, with no badge slot
    // appearing out of nowhere under it.
    //
    // Signed and coloured whoever drew it, which is where this case departs
    // from the badge rule at the top of the file. That rule can afford to be
    // neutral about somebody else's money because the DIRECTION is still on
    // screen — it is the up/down arrow and the in/out tone of the collect/pay
    // row that moved it. Folding that row away takes the direction with it, and
    // a deck's own icon cannot say whether $250 arrived or left. The sign is
    // the only thing left to carry it, so it is always drawn.
    case "card": {
      const folded = Number(ev.cardAmount);
      const signed = Number.isFinite(folded) && folded !== 0 ? folded : 0;
      return {
        icon: ev.deck === "chance" ? Sparkles : Gift,
        actorFig: ev.figure,
        deck: { kind: ev.deck === "chance" ? "Chance" : "Community Chest", text: fmtText(ev.text) },
        label: fmtText(ev.text),
        badge: signed ? { text: fmtSigned(signed), tone: signed > 0 ? "pos" : "neg" } : undefined,
        // The badge is aria-hidden, so a folded row would otherwise say the
        // sentence and not a word about the money the fold swallowed.
        text: `${Subject(ev.figure)} drew: ${fmtText(ev.text)}${
          signed ? ` · ${fmtSigned(signed)}` : ""
        }`,
      };
    }

    case "buy":
      return {
        icon: ShoppingBag,
        actorFig: ev.figure,
        objectCell: ev.cell,
        label: cellName(ev.cell),
        badge: moneyBadge(ev.amount, -1, mine),
        text: `${Subject(ev.figure)} bought ${cellName(ev.cell)} for ${fmt(ev.amount)}`,
      };

    case "build":
      return {
        icon: Hammer,
        actorFig: ev.figure,
        objectCell: ev.cell,
        label: cellName(ev.cell),
        badge: {
          text: ev.houses >= 5 ? "Hotel" : `${ev.houses} house${ev.houses === 1 ? "" : "s"}`,
          tone: null,
        },
        text: `${Subject(ev.figure)} built ${ev.houses >= 5 ? "a hotel" : "a house"} on ${cellName(
          ev.cell,
        )} for ${fmt(ev.amount)}`,
      };

    case "jail":
      return {
        icon: Lock,
        actorFig: ev.figure,
        label: `${Subject(ev.figure)} went to jail${JAIL_WHY[ev.reason] || ""}`,
        text: `${Subject(ev.figure)} went to jail${JAIL_WHY[ev.reason] || ""}`,
      };

    case "jailStay":
      return {
        icon: Lock,
        actorFig: ev.figure,
        label: `Still in jail`,
        badge: { text: `${ev.turn} of 3`, tone: null },
        text: `${Subject(ev.figure)} stayed in jail, roll ${ev.turn} of 3`,
      };

    case "jailLeave":
      return {
        icon: LockOpen,
        actorFig: ev.figure,
        label: `Out of jail${LEAVE_HOW[ev.how] || ""}`,
        text: `${Subject(ev.figure)} got out of jail${LEAVE_HOW[ev.how] || ""}`,
      };

    case "bankrupt":
      return {
        icon: Skull,
        tone: "out",
        actorFig: ev.figure,
        objectFig: ev.to || undefined,
        label: ev.to ? `Bankrupt → ${Subject(ev.to, true)}` : "Bankrupt",
        text: `${Subject(ev.figure)} went bankrupt${
          ev.to ? `, everything goes to ${Subject(ev.to, true)}` : ""
        }`,
      };

    case "win":
      // An allied pair wins together (SPEC-DIPLOMACY.md §1, `game.winners`
      // carries one OR two figures). The event shape for that is not part of
      // the spec's own list — only the resting state (`game.winners`) is —
      // so this reads an optional `figures` array defensively and falls back
      // to the single-figure shape the game has always emitted when it is
      // not there, rather than assuming a shape nothing has confirmed.
      if (Array.isArray(ev.figures) && ev.figures.length > 1) {
        const names = ev.figures.map((f) => Subject(f));
        return {
          icon: Trophy,
          tone: "in",
          actorFig: ev.figures[0],
          objectFig: ev.figures[1],
          label: `${names.join(" & ")} win`,
          text: `${names.join(" and ")} win the game together`,
        };
      }
      return {
        icon: Trophy,
        tone: "in",
        actorFig: ev.figure,
        label: `${Subject(ev.figure)} won the game`,
        text: `${Subject(ev.figure)} won the game`,
      };

    // ---- diplomacy: alliances, war and the backstab gambit ---------------
    // Shapes from SPEC-DIPLOMACY.md "Events". `figure`'s meaning shifts with
    // the event the same way it always has elsewhere in this file (compare
    // `bankrupt`'s `to` / `jail`'s `reason`) — see each case for who it is.
    case "ally": {
      if (ev.stage === "propose")
        return {
          icon: Handshake,
          actorFig: ev.from,
          objectFig: ev.to,
          label: `Alliance offered → ${Subject(ev.to, true)}`,
          text: `${Subject(ev.from)} proposed an alliance to ${Subject(ev.to, true)}`,
        };
      if (ev.stage === "decline")
        return {
          icon: Handshake,
          tone: "out",
          actorFig: ev.to,
          objectFig: ev.from,
          label: "Alliance declined",
          text: `${Subject(ev.to)} declined ${
            ev.from === meFig ? "your" : `${nameOfFig(players, ev.from)}'s`
          } alliance offer`,
        };
      if (ev.stage === "cancel")
        return {
          icon: Handshake,
          tone: "out",
          actorFig: ev.from,
          objectFig: ev.to,
          label: "Alliance offer cancelled",
          text: `${Subject(ev.from)} cancelled the alliance offer to ${Subject(ev.to, true)}`,
        };
      if (ev.stage === "form")
        return {
          icon: Handshake,
          tone: "in",
          actorFig: ev.a,
          objectFig: ev.b,
          label: "Alliance formed",
          text: `${Subject(ev.a)} and ${Subject(ev.b, true)} form an alliance`,
        };
      if (ev.stage === "break")
        return {
          icon: Handshake,
          tone: "out",
          actorFig: ev.figure,
          objectFig: ev.other,
          label: "Alliance broken",
          text: `${Subject(ev.figure)} broke the alliance with ${Subject(ev.other, true)}`,
        };
      if (ev.stage === "dissolve") {
        const why = { upkeep: "could not pay the upkeep", bankrupt: "went bankrupt", left: "left the game" }[
          ev.reason
        ];
        return {
          icon: Handshake,
          tone: "out",
          actorFig: ev.a,
          objectFig: ev.b,
          label: "Alliance dissolved",
          text: `The alliance between ${Subject(ev.a)} and ${Subject(ev.b, true)} dissolved${
            why ? ` — ${why}` : ""
          }`,
        };
      }
      return null;
    }

    // The 10% commission an ally banks whenever an outsider pays THEIR ally
    // rent (§1) — money the bank prints, not taken from the rent itself, so
    // it earns its own row rather than folding into the `pay` it rode in on.
    case "commission":
      return {
        icon: Percent,
        tone: "in",
        actorFig: ev.figure,
        objectFig: ev.payer,
        label: "Ally commission",
        badge: moneyBadge(ev.amount, 1, mine),
        text: `${Subject(ev.figure)} banked ${fmt(ev.amount)} commission — ${Subject(
          ev.payer,
        )} paid rent to ${Subject(ev.owner, true)}`,
      };

    // 50$/round, every allied player, straight to the pot (§1). Its OWN event
    // rather than a generic `pay` because "upkeep" is not one of the pay
    // reasons any `REASON` map above knows, and a bare "Paid 50$" four times a
    // round with no word for why would read as a bug.
    case "allyUpkeep":
      return {
        icon: Coins,
        tone: "out",
        actorFig: ev.figure,
        label: "Alliance upkeep",
        badge: moneyBadge(ev.amount, -1, mine),
        text: `${Subject(ev.figure)} paid ${fmt(ev.amount)} alliance upkeep to the Free Parking pot`,
      };

    // The shared-debt rescue (§1): a forced charge neither the payer nor the
    // ally could cover alone, so the ally's cash covers the shortfall and the
    // charge is paid in full. `figure` is the payer being rescued, `ally` is
    // who is covering it — the opposite order from most of this file's
    // events, where `figure` is normally the one acting, so it is named
    // explicitly here rather than trusted to the usual convention.
    case "debtShare":
      return {
        icon: LifeBuoy,
        tone: ev.ally === meFig ? "out" : null,
        actorFig: ev.ally,
        objectFig: ev.figure,
        label: `Covered ${possessive(ev.figure)} ${REASON_SHORT[ev.reason] || "debt"}`,
        badge: moneyBadge(ev.amount, -1, ev.ally === meFig),
        text: `${Subject(ev.ally)} covered ${fmt(ev.amount)} of ${possessive(ev.figure)} ${
          REASON[ev.reason] || "debt"
        } — together they could still pay it`,
      };

    case "war": {
      if (ev.stage === "declare") {
        const names = (arr) => (Array.isArray(arr) ? arr : []).map((f) => Subject(f)).join(" & ");
        return {
          icon: Swords,
          tone: "out",
          actorFig: ev.declarer,
          objectFig: ev.target,
          label: `War declared → ${Subject(ev.target, true)}`,
          text: `${Subject(ev.declarer)} declared war on ${Subject(ev.target, true)} — ${names(
            ev.sideA,
          )} vs ${names(ev.sideB)}, until round ${ev.endsRound}`,
        };
      }
      if (ev.stage === "peaceOffer")
        return {
          icon: Flag,
          actorFig: ev.from,
          label: "Peace offered",
          badge: ev.amount ? { text: fmt(ev.amount), tone: null } : undefined,
          text: `${Subject(ev.from)} offered peace${ev.amount ? ` with ${fmt(ev.amount)}` : ""}`,
        };
      if (ev.stage === "peaceDecline")
        return {
          icon: Flag,
          tone: "out",
          actorFig: ev.from,
          label: "Peace declined",
          text: `The peace offered by ${Subject(ev.from)} was declined`,
        };
      if (ev.stage === "peace")
        return {
          icon: Flag,
          tone: "in",
          label: "Peace",
          badge: ev.amount ? { text: fmt(ev.amount), tone: null } : undefined,
          text: `Peace was made${ev.amount ? `, with ${fmt(ev.amount)} changing hands` : ""}`,
        };
      if (ev.stage === "expire" || ev.stage === "end")
        return {
          icon: ShieldOff,
          label: ev.stage === "expire" ? "War expired" : "War ended",
          text:
            ev.stage === "expire"
              ? "The war ran its course and expired"
              : `The war ended${ev.reason ? ` — ${ev.reason}` : ""}`,
        };
      return null;
    }

    // Once per game (§3): the alliance ends, the backstabber takes 15% of the
    // victim's cash, and the amount is on the event itself rather than a
    // separate `pay`/`collect` pair — there is only one number to show, so it
    // is shown once, signed for whichever of the two figures is looking at
    // their own screen.
    // The server says so when a Traitor brand burns out (round start, five
    // rounds after the backstab). Only the +25% ends — the ban on ever allying
    // again is permanent, and the row says both so nobody reads "expired" as a
    // clean slate.
    case "traitor":
      if (ev.stage !== "expire") return null;
      return {
        icon: Skull,
        actorFig: ev.figure,
        label: "Traitor tax over",
        text: `${possessive(ev.figure).replace(/^y/, "Y")} Traitor rent penalty has ended — ${
          ev.figure === meFig ? "you" : "they"
        } still can never ally again`,
      };

    case "backstab": {
      const backstabberGain = mine;
      const victimLoss = ev.victim === meFig;
      return {
        icon: Skull,
        tone: backstabberGain ? "in" : victimLoss ? "out" : null,
        actorFig: ev.figure,
        objectFig: ev.victim,
        label: `Backstabbed ${Subject(ev.victim, true)}`,
        badge: moneyBadge(ev.amount, backstabberGain ? 1 : -1, backstabberGain || victimLoss),
        text: `${Subject(ev.figure)} backstabbed ${Subject(ev.victim, true)}, taking ${fmt(ev.amount)} — ${
          backstabberGain ? "you are" : `${Subject(ev.figure, true)} is`
        } branded Traitor`,
      };
    }

    // ---- the Free Parking pot, the farm and the casino -------------------
    // All five shapes below come from
    // supabase/migrations/20260920170000_casino_farm_rebalance.sql. The two
    // that move money (`pot`, `farm` at stage harvest) carry the badge for the
    // `collect` that was folded away above; the three casino stages carry the
    // play.

    // Cell 5, cell 39 and every card that fines you to the bank pile up on
    // game.pot, and landing on Free Parking takes the lot. The server emits
    // nothing at all for a pot of 0, so this row always has money in it and is
    // always worth the exclamation.
    case "pot":
      return {
        icon: PartyPopper,
        tone: "in",
        actorFig: ev.figure,
        objectCell: ev.cell,
        label: "Free Parking pot",
        badge: moneyBadge(ev.amount, 1, mine),
        text: `${Subject(ev.figure)} landed on Free Parking and took the whole pot: ${fmt(
          ev.amount,
        )}`,
      };

    // A landlord in jail collects nothing — not the owner, not the pot, not
    // the bank. Without a row of its own the log would show a landing on an
    // owned street and then simply no charge, which reads as a dropped
    // payment rather than as the rule it is.
    case "rentFree":
      // The same event serves two different reasons for a free landing. It was
      // born for the jailed landlord; the alliance rules reuse it with
      // reason 'ally' (the server emits no `pay` of 0), and announcing an
      // ally's free passage as "the owner is in jail" would be simply false.
      if (ev.reason === "ally")
        return {
          icon: Handshake,
          actorFig: ev.figure,
          objectCell: ev.cell,
          label: `No rent · allies`,
          badge: { text: fmt(0), tone: null },
          // "you is an ally" is the trap the jail wording below also has to
          // dodge: when I am the landlord the sentence turns around instead.
          text:
            ev.owner === meFig
              ? `${Subject(ev.figure)} paid no rent on ${cellName(ev.cell)} — you are allies`
              : `${Subject(ev.figure)} paid no rent on ${cellName(ev.cell)} — ${Subject(
                  ev.owner,
                  true,
                )} is an ally`,
        };
      return {
        icon: Lock,
        actorFig: ev.figure,
        objectCell: ev.cell,
        label: `No rent · ${Subject(ev.owner, true)} in jail`,
        badge: { text: fmt(0), tone: null },
        text: `${Subject(ev.figure)} paid no rent on ${cellName(ev.cell)} — ${Subject(
          ev.owner,
          true,
        )} is in jail`,
      };

    // The Weed Farm keeps a counter on the cell instead of a rent. Everyone
    // who is not the owner waters it (+150, and they pay nothing at all); the
    // owner harvests the whole pile by landing on it themselves, and it drops
    // back to 50. `amount` is what was paid out, `income` is the counter
    // AFTER — which is the number worth showing on a grow, because it is what
    // the next visitor is walking towards.
    case "farm": {
      const harvest = ev.stage === "harvest";
      return {
        icon: harvest ? Cannabis : Sprout,
        tone: harvest ? "in" : null,
        actorFig: ev.figure,
        objectCell: ev.cell,
        // The badge carries the number in both cases — the money harvested, or
        // the crop the next visitor is walking towards — so the label says
        // which of the two it is rather than repeating it.
        label: harvest ? "Harvested the crop" : "Watered the crop",
        badge: harvest
          ? moneyBadge(ev.amount, 1, mine)
          : { text: fmt(ev.income), tone: null },
        text: harvest
          ? `${Subject(ev.figure)} harvested the farm for ${fmt(ev.amount)}`
          : `${Subject(ev.figure)} paid nothing at the farm and grew the crop to ${fmt(
              ev.income,
            )}`,
      };
    }

    // ---- casino ----------------------------------------------------------
    // One landing produces `enter` (the house is waiting), then exactly one of
    // `result` (a bet was played) or `skipped` (the board skipped a phone that
    // had gone away). The bank is the house, so none of this touches the pot.
    case "casino": {
      if (ev.stage === "enter") {
        return {
          icon: Spade,
          actorFig: ev.figure,
          objectCell: ev.cell,
          label: "At the casino",
          badge: { text: `Min ${fmt(ev.min)}`, tone: null },
          text: `${Subject(ev.figure)} landed on the Casino and must bet at least ${fmt(
            ev.min,
          )}`,
        };
      }
      if (ev.stage === "skipped") {
        return {
          icon: Ban,
          actorFig: ev.figure,
          objectCell: ev.cell,
          label: "Left the casino unplayed",
          text: `${Subject(ev.figure)} was skipped at the Casino and bet nothing`,
        };
      }
      // `result`. The two ledger movements were folded away above, so this row
      // carries the swing: what the player is left holding, the bet already
      // taken off. floor() matches the server's own payout rounding.
      const bet = Math.max(Math.round(Number(ev.bet) || 0), 0);
      const payout = Math.max(Math.round(Number(ev.payout) || 0), 0);
      const swing = payout - bet;
      const won = Number(ev.mult) > 0;
      return {
        icon: Spade,
        tone: swing > 0 ? "in" : swing < 0 ? "out" : null,
        actorFig: ev.figure,
        objectCell: ev.cell,
        label: `${GAME_NAME[ev.game] ?? "Casino"} · ${won ? multLabel(ev.mult) : "no win"}`,
        badge: moneyBadge(swing, swing >= 0 ? 1 : -1, mine),
        text: `${Subject(ev.figure)} bet ${fmt(bet)} on ${
          GAME_NAME[ev.game] ?? "the casino"
        } and ${won ? `won ${multLabel(ev.mult)}, taking ${fmt(payout)}` : "lost it"}`,
      };
    }

    // ---- auction ---------------------------------------------------------

    case "auction_start":
      return {
        icon: Gavel,
        actorFig: ev.figure,
        objectCell: ev.cell,
        label: `Auction · ${cellName(ev.cell)}`,
        text: `${Subject(ev.figure)} put ${cellName(ev.cell)} up for auction`,
      };

    // A bid is neutral money: nobody has paid anything yet, not even me.
    case "bid":
      return {
        icon: Gavel,
        actorFig: ev.figure,
        objectCell: ev.cell,
        label: cellName(ev.cell),
        badge: { text: fmt(ev.amount), tone: null },
        text: `${Subject(ev.figure)} bid ${fmt(ev.amount)} for ${cellName(ev.cell)}`,
      };

    case "drop":
      return {
        icon: Ban,
        actorFig: ev.figure,
        label: `${Subject(ev.figure)} dropped`,
        text: `${Subject(ev.figure)} dropped out of the auction${
          ev.cell != null ? ` for ${cellName(ev.cell)}` : ""
        }`,
      };

    // Winning an auction is a purchase, so it reads like one — same icon as
    // `buy`, and the money is signed and coloured when it was mine.
    case "auction_won":
      return {
        icon: ShoppingBag,
        actorFig: ev.figure,
        objectCell: ev.cell,
        label: cellName(ev.cell),
        badge: moneyBadge(ev.amount, -1, mine),
        text: `${Subject(ev.figure)} won ${cellName(ev.cell)} at auction for ${fmt(ev.amount)}`,
      };

    case "auction_none":
      return {
        icon: Ban,
        objectCell: ev.cell,
        label: `No bids · ${cellName(ev.cell)}`,
        text: `Nobody bid for ${cellName(ev.cell)}`,
      };

    // ---- trade -----------------------------------------------------------

    // One shape for every status, so the log can always print both sides of the
    // offer — what was given and what was asked for — however it ended.
    case "trade": {
      const side = (part) => {
        const cells = Array.isArray(part?.cells) ? part.cells.map(cellName) : [];
        const cash = Number(part?.cash) || 0;
        const bits = cash > 0 ? [...cells, fmt(cash)] : cells;
        return bits.length > 0 ? bits.join(" + ") : "nothing";
      };
      const give = side(ev.give);
      const get = side(ev.get);
      const fromS = Subject(ev.figure);
      const toS = Subject(ev.to);
      const toLower = Subject(ev.to, true);
      const whose = ev.figure === meFig ? "your" : `${nameOfFig(players, ev.figure)}'s`;

      const badges = {
        offered: { text: "Offer", tone: null },
        countered: { text: "Counter", tone: null },
        accepted: { text: "Deal", tone: "pos" },
        declined: { text: "No deal", tone: "neg" },
        cancelled: { text: "Cancelled", tone: null },
        expired: { text: "Expired", tone: null },
      };
      const sentences = {
        offered: `${fromS} offered ${toLower} ${give} for ${get}`,
        countered: `${fromS} sent ${toLower} a counter-offer: ${give} for ${get}`,
        accepted: `${toS} accepted ${whose} trade`,
        declined: `${toS} declined ${whose} trade offer`,
        cancelled: `${fromS} cancelled the trade offer`,
        // The server clears an offer that no longer adds up instead of throwing,
        // and says why; the reason is already a whole phrase ("You do not own
        // Далма Молл"), so it is quoted rather than rewritten.
        expired: `That offer is no longer valid${ev.reason ? ` (${ev.reason})` : ""}`,
      };

      return {
        icon: ArrowLeftRight,
        tone: ev.status === "accepted" ? "in" : null,
        actorFig: ev.figure,
        objectFig: ev.to || undefined,
        label: `${give} ⇄ ${get}`,
        badge: badges[ev.status] || { text: "Trade", tone: null },
        text: sentences[ev.status] || `${fromS} · trade with ${toLower}`,
      };
    }

    case "again":
      return {
        icon: Dices,
        actorFig: ev.figure,
        label: "Rolls again",
        text: `${Subject(ev.figure)} rolls again`,
      };

    case "join":
      return { icon: UserPlus, label: `${ev.name} joined`, text: `${ev.name} joined` };

    case "leave":
      return {
        icon: UserMinus,
        actorFig: ev.figure,
        label: `${Subject(ev.figure)} left`,
        text: `${Subject(ev.figure)} left`,
      };

    case "newGame":
      return { icon: RotateCcw, label: "New game", text: "New game" };

    // `land` duplicates `move`, and `turn` / `skip` are drawn as dividers.
    default:
      return null;
  }
}
