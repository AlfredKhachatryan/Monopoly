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
// number; a build shows "2 houses" / "Hotel".
//
// Event shapes come from game_action; see the migration header for the list.

import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Ban,
  Dices,
  Gavel,
  Gift,
  Hammer,
  Lock,
  LockOpen,
  MapPin,
  RotateCcw,
  ShoppingBag,
  Skull,
  Sparkles,
  Trophy,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { nameOfFig } from "../Hooks/rules";
import { fmt, fmtSigned, fmtText } from "./format";

const REASON = {
  rent: "rent",
  tax: "tax",
  jailFee: "the jail fine",
  repairs: "repairs",
  card: "a card",
  passGo: "for passing Start",
};

// The same reasons, short enough to sit on one row next to a badge.
const REASON_SHORT = {
  rent: "Rent",
  tax: "Tax",
  jailFee: "Jail fine",
  repairs: "Repairs",
  card: "Card",
  passGo: "Passing Start",
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
      if (ev.reason === "auction") return null;
      return {
        icon: ArrowUpRight,
        tone: mine ? "out" : ev.to === meFig ? "in" : null,
        actorFig: ev.figure,
        objectFig: ev.to || undefined,
        label: ev.to
          ? `${REASON_SHORT[ev.reason] || "Paid"} → ${Subject(ev.to, true)}`
          : REASON_SHORT[ev.reason] || Subject(ev.figure),
        // Rent I receive is a gain for me even though somebody else paid it.
        badge: moneyBadge(ev.amount, mine ? -1 : 1, mine || ev.to === meFig),
        text: ev.to
          ? `${Subject(ev.figure)} paid ${fmt(ev.amount)} ${REASON[ev.reason] || ""} to ${Subject(
              ev.to,
              true,
            )}`.replace(/\s+/g, " ")
          : `${Subject(ev.figure)} paid ${fmt(ev.amount)} ${REASON[ev.reason] || ""}`.replace(
              /\s+$/,
              "",
            ),
      };

    case "card":
      return {
        icon: ev.deck === "chance" ? Sparkles : Gift,
        actorFig: ev.figure,
        deck: { kind: ev.deck === "chance" ? "Chance" : "Community Chest", text: fmtText(ev.text) },
        label: fmtText(ev.text),
        text: `${Subject(ev.figure)} drew: ${fmtText(ev.text)}`,
      };

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
      return {
        icon: Trophy,
        tone: "in",
        actorFig: ev.figure,
        label: `${Subject(ev.figure)} won the game`,
        text: `${Subject(ev.figure)} won the game`,
      };

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
