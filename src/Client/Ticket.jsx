// The space you are standing on, as a DEED CARD: a band in the space's own
// colour carrying its group, then the name set large, who owns it and what is
// built on it, the one number that matters right now, and — for anything that
// charges by a schedule — the whole schedule with the row in force picked out.
//
// It used to be a small torn-off ticket squeezed into the bottom panel between
// the path strip and the roll button, with a three-column stub of Price / Rent
// / Owner. The panel is now buttons only and the card lives in the freed middle
// of the aura (Aura.jsx's `card` slot), which is why it can afford a rent table
// at all. The file keeps its name because everything that was true of the
// ticket is still true of the card: one space, described the way THAT kind of
// space works.
//
// THE HEADLINE NUMBER is a decision, not a column:
//   nobody owns it   → the PRICE, because the only question is "do I buy it".
//                      Except the farm, which cannot be bought at any price:
//                      it says "Sold by / Auction" instead. See below.
//   somebody owns it → the LIVE rent, straight from rules.rentFor(), which is
//                      the number the server will actually move. That includes
//                      its one surprise: while the owner sits in jail the space
//                      collects nothing, so the headline reads 0$ and its label
//                      says why, instead of the table appearing to lie.
//   the farm, owned  → the CROP (see below), never a rent
//   a fixed charge   → Tax's fine, Start's bonus and Free Parking's live pot
//                      are the same kind of fact and sit in the same place.
//
// THE CARD IS ON --surface, NOT ON THE TINT. The old ticket was a slab of
// --tint with --on-tint text, which worked for three numbers and cannot work
// for a seven-row table in two themes: accentFor() now runs from near-white
// steel (#c3d0de, railroads) to deep oxblood (#66232f, tax). So only the band
// carries the colour, always paired with readableOn(), and everything that has
// to be READ is ink on surface.
//
// HOW IT FITS is the stylesheet's business (see "deed card" in
// screen.module.css): the card sits in a size container and picks one of five
// forms from the height it was actually given, giving up the table first and
// the name, owner and headline never. The only thing this file does for that
// is mark the table rows: `data-cur` on the row in force and `data-near` on
// the three-row window around it, which is what a short card keeps.
//
// Two of the spaces it describes stopped being properties in the rebalance and
// are handled here rather than anywhere else:
//   Casino (13)  not ownable at all — the bank is the house — so it takes the
//                one-line `factsFor` treatment and says the one thing a player
//                needs before the panel opens: landing is mandatory and the
//                floor is 15% of their cash.
//   Weed Farm (28)  ownable, so it keeps a deed's owner line and headline, but
//                its number is the CROP, never a rent: a visitor pays nothing
//                and only the owner harvests, by landing on it. A line under
//                the numbers says so, because "Crop 800$" on a space that
//                charges nobody anything explains nothing by itself. It is also
//                never BOUGHT — landing on it unowned auctions it to the whole
//                table — so while nobody owns it the headline is the way it is
//                sold rather than a price.
// Free Parking is the third change: it used to say "nothing to pay here" and is
// now the one cell on the board that PAYS, so it shows the live pot.
//
// The Build pill (now on the owner's line, beside the houses it would add to)
// is about THIS space, and only this space. It used to appear
// whenever the viewer owned a finished colour set anywhere on the board, which
// put a "Build" button on Free Parking, on Jail, and on a street owned by
// nobody — three places where pressing it could not possibly build anything.
// The caller now passes `canBuild` = "you own this street, you hold its whole
// colour set, and it is this street's turn to take the next house"; see
// `buildHere` in ClientScreen. Building anywhere else is reached through the
// Deeds tab, which is what that tab is for.

import { Hammer } from "lucide-react";
import {
  FARM_INCOME_START,
  FARM_INCOME_STEP,
  JAIL_MAX_TURNS,
  RAILROAD_RENT,
  START_BONUS,
  accentFor,
  cellKind,
  farmIncome,
  isProperty,
  nameOfFig,
  ownerOf,
  ownsSet,
  playerByFig,
  priceOf,
  readableOn,
  rentFor,
  streetRentTable,
} from "../Hooks/rules";
// Diplomacy's own honesty check on the headline number: `game` and my own
// figure feed rentFor() so a payer standing on someone else's street sees
// what THEY would actually pay (war double, the +25% outsider tax, a
// lingering Traitor brand), and rentMods() is the same computation used to
// print the short chips underneath that say WHY — "War ×2", not just a
// number that disagrees with the rent table above it. See SPEC-DIPLOMACY.md
// "Rent, in one place".
import { rentMods } from "../Hooks/diplomacy";
import { groupLabel, Pips, hasCyrillic } from "./boardDisplay";
import { fmt, fmtText, jailLine } from "./format";
import Mark from "./Mark";
import Tok from "./Tok";
import s from "./screen.module.css";

// What a space that cannot be owned has to say for itself: an optional headline
// (`head`, the same slot a deed's price or rent sits in) and one line of plain
// words. The three spaces that are really just a number — the tax's fine, the
// Start bonus, the Free Parking pot — put it in the headline, so the card reads
// the same way whether the number is a rent or a fine; the rest have no number
// and give the whole body of the card to the sentence.
function factsFor(cell, lastCard, me, pot) {
  switch (cellKind(cell)) {
    case "start":
      return { head: ["Collect", fmt(START_BONUS)], note: "Every time you pass Start." };
    case "chance":
    case "community":
      return { head: null, note: lastCard ? fmtText(lastCard) : "Take the card" };
    case "tax":
      // Every fine paid to the bank lands on the Free Parking pot (spec §2),
      // so the tax cell is the obvious place to say where the money goes — it
      // turns a flat charge into the other half of a story the player can see
      // paid out on cell 21.
      return { head: ["Pay", fmt(cell.price || 0)], note: "It goes to the Free Parking pot." };
    // Standing on Jail is two different facts. Saying "Just visiting" to a
    // player who is locked up is the ticket contradicting the banner.
    // Both this and the banner in ClientScreen come out of jailLine(), so the
    // ticket can no longer say "turn 2 of 3" while the banner says "roll 2 of
    // 3" six inches above it.
    case "jail":
      return {
        head: null,
        note: me?.inJail ? jailLine(me, { max: JAIL_MAX_TURNS }) : "Just visiting",
      };
    // No longer "nothing to pay here": Free Parking is now the one cell on the
    // board that PAYS, and the number is the live pot. A pot of 0 is silent
    // server-side (no event, no money) and the wording follows it.
    case "parking":
      return {
        head: ["Pot", fmt(pot > 0 ? pot : 0)],
        note: pot > 0 ? "Landing here takes the whole pot." : "The pot is empty. Take a breather.",
      };
    case "gtj":
      return { head: null, note: "Unlucky: go straight to jail" };
    // The Casino has no owner and no rent — the bank is the house. Landing is
    // mandatory, and the ticket says the one number a player needs before the
    // panel opens: the floor under the bet.
    case "casino":
      return {
        head: null,
        note: "Land here and you must bet — at least 15% of your cash. The bank is the house.",
      };
    default:
      return { head: null, note: cell?.info || "" };
  }
}

// The schedule a deed charges by, as rows of [label, amount], and which row is
// in force right now (`cur`, or -1 when nobody owns it and so nobody is being
// charged anything).
//
// `communal` is GONE, along with the two utilities it stood for: this used to
// print "10× roll" / "4× roll" for cells 13 and 28, which are now the Casino
// and the Weed Farm and charge nothing of the sort. The casino is not a deed at
// all; the farm has a pile instead of a rent, so its "schedule" is the three
// numbers that pile moves by, labelled as what they are.
//
// Everything comes from the same constants the server uses — streetRentTable()
// and RAILROAD_RENT — so the highlighted row and rentFor()'s headline can only
// disagree in the one case where they are MEANT to: a jailed owner, where the
// row still says what the street is built up to and the headline says 0.
function scheduleFor(board, cell, owner) {
  switch (cellKind(cell)) {
    case "street": {
      const houses = Math.min(Math.max(Math.round(Number(cell.houses) || 0), 0), 5);
      const cur = !owner ? -1 : houses > 0 ? houses + 1 : ownsSet(board, owner, cell.color) ? 1 : 0;
      return { title: "Rent table", rows: streetRentTable(board, cell), cur };
    }
    case "road": {
      const n = owner
        ? Object.values(board || {}).filter((c) => cellKind(c) === "road" && ownerOf(c) === owner)
            .length
        : 0;
      return {
        title: "Rent by railroads owned",
        rows: RAILROAD_RENT.map((r, i) => [`${i + 1} railroad${i ? "s" : ""}`, r]),
        cur: n > 0 ? Math.min(n, RAILROAD_RENT.length) - 1 : -1,
      };
    }
    // The pile the owner would harvest by landing here, which is the farm's
    // whole economy: a visitor pays nothing and leaves it bigger.
    case "farm":
      return {
        title: "Crop",
        rows: [
          ["Crop now", farmIncome(cell)],
          ["Each visitor adds", FARM_INCOME_STEP],
          ["After a harvest", FARM_INCOME_START],
        ],
        cur: 0,
      };
    default:
      return null;
  }
}

// A short card keeps three rows of the schedule: the one in force and its
// neighbours, slid inward at either end so it is always three (Rent / Colour
// set / 1 house for a bare street, 3 houses / 4 houses / Hotel for a hotel).
// An unowned space has no row in force and shows the first three — what it
// would fetch the day somebody buys it.
function nearWindow(cur, length) {
  const start = Math.min(Math.max((cur < 0 ? 0 : cur) - 1, 0), Math.max(length - 3, 0));
  return [start, start + 2];
}

export default function Ticket({
  cell,
  board,
  players,
  me,
  // The live diplomacy state, for the same reason `players` is here: rentFor()
  // needs it to answer honestly for whoever is actually about to pay. Optional
  // — omitting it (an older caller, a test render) just means the headline
  // falls back to the base rent, same as before diplomacy existed.
  game = null,
  canBuild,
  onBuild,
  lastCard,
  pot = 0,
  label = "You are here",
}) {
  if (!cell) return null;

  const kind = cellKind(cell);
  const ownable = isProperty(cell);
  const owner = ownerOf(cell);
  const mine = !!owner && owner === me?.figure;
  const ownerPlayer = owner ? playerByFig(players, owner) : null;
  const ownerLabel = !owner ? "Unowned" : mine ? "You" : nameOfFig(players, owner);
  const price = priceOf(cell);

  // The band is the one part of the card that wears the space's colour, and it
  // computes its own pair rather than borrowing the aura's --tint / --on-tint:
  // they are the same two values today (ClientScreen tints the aura from this
  // very cell), but a band whose text colour came from somewhere else is
  // exactly how dark ink ends up on oxblood the day those two drift apart.
  const band = accentFor(cell);
  const onBand = readableOn(band);

  // The Weed Farm is ownable, so it gets a deed like any other — but its number
  // is NOT a rent and must not be labelled as one: a visitor pays nothing
  // there, ever. It is the CROP, the word the TV tile uses for the same number
  // (`CROP <income>`, always, owned or not), so the two screens in the same
  // room say the same thing. The line underneath says who gets it and how,
  // because "Crop 1250$" on a space that charges nobody anything is otherwise
  // unreadable.
  //
  // THE PHONE USED TO SHOW THE $150 PRICE HERE, and no longer does. It was the
  // headline while the farm was unowned because the phone was where the
  // buy/auction decision got made, and a screen with a Buy button on it had to
  // say what Buy cost. Since supabase/migrations/20260921160000_farm_auction.sql
  // there is no Buy: landing on the unowned farm auctions it to the whole table
  // on the spot, and $150 is a valuation nobody can pay. Showing it would be
  // the card quoting a price that buys nothing — so the headline says what
  // actually happens instead, and the number the bidders are fighting over is
  // the Crop, which is right underneath it in the table where it always was.
  const farm = kind === "farm";
  const farmNote = farm
    ? mine
      ? `Yours. Land on it yourself to harvest ${fmt(farmIncome(cell))} — the crop then restarts at ${fmt(FARM_INCOME_START)}.`
      : owner
        ? `Landing here costs nothing and grows the crop by ${fmt(FARM_INCOME_STEP)}. Only the owner harvests it, by landing on it.`
        : `Nobody can buy it: landing here puts it up for auction and every player bids. The landing still grows the crop by ${fmt(FARM_INCOME_STEP)} first.`
    : null;

  const facts = ownable ? null : factsFor(cell, lastCard, me, pot);
  const schedule = ownable ? scheduleFor(board, cell, owner) : null;

  // [label, amount] for the big number.
  let head = facts?.head ?? null;
  if (ownable) {
    // The unowned farm is the one deed with no asking price to print: see the
    // note above. "Sold by / Auction" sits in the same two slots a price would
    // have used, so the card keeps its shape and the biggest words on it are
    // still the answer to "what happens if I am standing here".
    if (!owner) head = farm ? ["Sold by", "Auction"] : ["Price", price != null ? fmt(price) : "—"];
    else if (farm) head = ["Crop", fmt(farmIncome(cell))];
    else {
      // rentFor() is the live answer, jail included. A jailed owner collects
      // nothing — not for themselves, not for the pot — and a bare "0$" above
      // a table that says 1600$ would read as a bug, so the label carries the
      // reason. It is in the LABEL rather than on a line of its own so that it
      // survives on the shortest card, which has no room for extra lines.
      const jailed = !!ownerPlayer?.inJail;
      // DEED CARD HONESTY. On MY OWN street the number is "Visitors pay" and
      // has to stay the base rent — it varies by who is standing there, and
      // showing MY war/alliance/traitor status on a headline about someone
      // else's payment would just be wrong. Standing on someone ELSE'S street
      // is the one case the headline is a promise to ME specifically, so it
      // is the only case that feeds `game` and my own figure into rentFor():
      // war doubles it, my own alliance tax adds a quarter, a lingering
      // Traitor brand adds another. A jailed owner already short-circuits to
      // 0 before any of that — passing `game` again would not change the
      // answer, only the console noise if `game` is null on an old caller.
      const liveRent =
        mine || jailed ? rentFor(board, cell.id, players) : rentFor(board, cell.id, players, game, me?.figure);
      head = [
        jailed
          ? mine
            ? "Rent · you are in jail"
            : "Rent · owner is in jail"
          : mine
            ? "Visitors pay"
            : "Rent now",
        fmt(liveRent),
      ];
    }
  }

  // The short chips under the headline that say WHY it is what it is — same
  // computation rentFor() above was just asked to apply, read straight off
  // rentMods() so the two can never disagree. Only for the case the headline
  // above just made a promise about: someone else's street, not in jail, me
  // as the one about to pay. `rentMods` already treats an ally as free rather
  // than a percentage, so that case gets its own single chip instead of a
  // meaningless "×1".
  const modChips =
    ownable && !farm && owner && !mine && !ownerPlayer?.inJail && me?.figure
      ? (() => {
          const rm = rentMods(game, players, me.figure, owner);
          if (rm.zero) return ["Ally · free"];
          const chips = [];
          if (rm.mods.includes("war")) chips.push("War ×2");
          if (rm.mods.includes("allyTax")) chips.push("Alliance +25%");
          if (rm.mods.includes("traitor")) chips.push("Traitor +25%");
          return chips.length ? chips : null;
        })()
      : null;

  const [nearFrom, nearTo] = schedule ? nearWindow(schedule.cur, schedule.rows.length) : [0, -1];
  const note = ownable ? farmNote : facts?.note;

  return (
    // The box is the size container the card measures itself against (see the
    // stylesheet); the card inside it is the thing with a face. Two elements
    // because a container query can only restyle what is INSIDE the container.
    <div className={s.deedBox}>
      <article
        className={s.ticket}
        aria-label={label}
        data-plain={ownable ? undefined : ""}
        style={{ "--band": band, "--on-band": onBand }}
      >
        <div className={s.tBand}>
          <Mark cell={cell} size={26} radius={9} />
          <span className={s.grp}>{groupLabel(cell)}</span>
          {/* "You are here" / "Up for auction". The article's aria-label
              already says it; on screen it is what tells a bidder that this
              card has stopped describing the square under their own token. */}
          <span className={s.tFlag} aria-hidden="true">
            {label}
          </span>
        </div>

        <div className={s.tBody}>
          {/* Most of this board's names are Russian; telling the browser so
              keeps hyphenation and speech synthesis honest. */}
          <h2 className={s.pname} lang={hasCyrillic(cell.header) ? "ru" : undefined}>
            {cell.header}
          </h2>

          {ownable && (
            <div className={s.tOwner}>
              <span className={s.tOwnerLab}>Owner</span>
              {ownerPlayer && <Tok player={ownerPlayer} size={22} />}
              <span className={`${s.tOwnerName} ${owner ? "" : s.tOwnerNone}`}>{ownerLabel}</span>
              <Pips houses={cell.houses} className={s.tPips} />
              {canBuild && (
                <button type="button" className={s.tBuild} onClick={onBuild} aria-label="Build">
                  {/* The word is its own element so the one-line card can drop
                      it and keep the hammer; the label keeps the button's name
                      when it does. */}
                  <Hammer size={18} aria-hidden="true" />
                  <span className={s.tBuildTxt}>Build</span>
                </button>
              )}
            </div>
          )}

          {head && (
            <div className={s.tHeadline}>
              <span>{head[0]}</span>
              <strong>{head[1]}</strong>
            </div>
          )}

          {modChips && (
            <div className={s.tMods} aria-label="Why this rent">
              {modChips.map((chip) => (
                <span key={chip} className={s.tModChip}>
                  {chip}
                </span>
              ))}
            </div>
          )}

          {schedule && (
            <ul className={s.tTable} aria-label={schedule.title}>
              {schedule.rows.map(([rowLabel, amount], i) => (
                <li
                  key={rowLabel}
                  data-cur={i === schedule.cur ? "" : undefined}
                  data-near={i >= nearFrom && i <= nearTo ? "" : undefined}
                  aria-current={i === schedule.cur ? "true" : undefined}
                >
                  <span>{rowLabel}</span>
                  <strong>{fmt(amount)}</strong>
                </li>
              ))}
            </ul>
          )}

          {note && <p className={ownable ? s.tFine : s.tNote}>{note}</p>}
        </div>
      </article>
    </div>
  );
}
