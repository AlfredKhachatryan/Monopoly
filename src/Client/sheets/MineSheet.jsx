import { useEffect, useRef } from "react";
import { LockOpen } from "lucide-react";
import Sheet from "../Sheet";
import Mark from "../Mark";
import { fmt } from "../format";
import { groupByColor } from "../../Hooks/groupByColor";
import { GROUP_NAMES, KIND_LABEL, Pips, hasCyrillic } from "../boardDisplay";
import {
  FARM_INCOME_STEP,
  HOTEL,
  canBuild,
  cellKind,
  farmIncome,
  housePrice,
  ownedBy,
  ownsSet,
  priceOf,
  rentFor,
  streetRent,
} from "../../Hooks/rules";
import sh from "../sheet.module.css";

const SHORT_REASON = {
  "Needs the whole colour set": "Need the full set",
  "Build on the other streets first": "Build evenly",
  "Hotel built": "Maxed out",
};

// Your deeds, grouped by colour set. Opened by tapping a card in the hand;
// `focus` is the card that was tapped, which gets a ring and scrolls into view.
//
// `players` is not decoration: rentFor()'s third argument is the players array
// (it used to be `diceSum`, which nothing needs any more), and a property whose
// owner is currently in jail collects NOTHING — not for the owner, not for the
// pot, not for the bank. Without the array this sheet promised its owner a rent
// the server was never going to charge, which is the one number in here that
// has to be true.
export default function MineSheet({ open, onClose, board, me, players, focus, onBuild, busy }) {
  const mine = me ? ownedBy(board, me.figure) : [];
  const groups = groupByColor(mine);
  const totalPaid = mine.reduce((sum, c) => sum + (priceOf(c) || 0), 0);
  const focusRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => focusRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 320);
    return () => clearTimeout(t);
  }, [open, focus]);

  const jailCards = me?.jailCards || 0;

  return (
    <Sheet open={open} title="My properties" onClose={onClose}>
      {/* A Get Out of Jail Free card is a thing you own, same as a deed — it
          just isn't a board cell, so it lives here rather than in the groups
          below. Shown regardless of whether any deeds exist, and it never
          appears in TradeSheet: `tradableOwnedBy` only ever looks at board
          cells, so there is nothing more to guard there. */}
      {jailCards > 0 && (
        <div className={sh.jailCard} role="img" aria-label={`${jailCards} Get Out of Jail Free card${jailCards === 1 ? "" : "s"}, not tradable`}>
          <span className={sh.jailCardIcon} aria-hidden="true">
            <LockOpen size={20} />
          </span>
          <div className={sh.jailCardBody}>
            <strong>Get Out of Jail Free</strong>
            <span>
              {jailCards} card{jailCards === 1 ? "" : "s"} · not tradable
            </span>
          </div>
        </div>
      )}

      {mine.length === 0 ? (
        <p className={sh.empty}>
          Nothing here yet.
          <br />
          {/* "utility" is gone with the two cells it named: 13 is the Casino
              (nobody can own it) and 28 is the Weed Farm (anybody can). */}
          Land on a free street, railroad or the farm and buy it.
        </p>
      ) : (
        <>
          <p className={sh.sum}>
            {mine.length} deed{mine.length === 1 ? "" : "s"} · bought for {fmt(totalPaid)}
          </p>

          {groups.map(([color, cells]) => {
            const isStreetSet = color !== "#000";
            return (
              <div key={color}>
                {isStreetSet ? (
                  <div className={sh.setHead}>
                    <span>{GROUP_NAMES[String(color).toLowerCase()] || "Colour"} set</span>
                    <span className={sh.setDots} aria-hidden="true" />
                    <span>{fmt(housePrice(cells[0].id))} per house</span>
                  </div>
                ) : (
                  /* Everything ownable that carries no colour set. The
                     utilities are gone; what shares this bucket with the four
                     railroads now is the Weed Farm. */
                  <div className={sh.groupLabel}>Railroads &amp; the farm</div>
                )}

                <ul className={sh.list}>
                  {cells.map((cell) => {
                    const kind = cellKind(cell);
                    const street = kind === "street";
                    const farm = kind === "farm";
                    const houses = cell.houses || 0;
                    const build = street ? canBuild(board, me.figure, cell.id, me.money) : null;
                    // `players`, not a dice sum: 0 whenever I am in jail.
                    const rent = rentFor(board, cell.id, players);

                    let status = null;
                    if (street) {
                      if (houses >= HOTEL) status = "hotel";
                      else if (houses > 0) status = `${houses} house${houses === 1 ? "" : "s"}`;
                      else if (ownsSet(board, me.figure, cell.color)) status = "full set";
                    }

                    let preview = null;
                    if (street && build?.ok) {
                      const next = streetRent(board, cell, houses + 1);
                      preview = `${fmt(rent)} → ${fmt(next)}`;
                    }

                    // The reason a build is blocked used to live only in a
                    // `title` attribute, which touch never sees — it is now
                    // visible text on the row instead.
                    const disabledReason = build && !build.ok ? SHORT_REASON[build.reason] || build.reason : undefined;

                    // Streets already carry their colour ("<Colour> set")
                    // above, so line 1 skips the redundant "Street" kind
                    // label and shows just the status; the rent preview and
                    // the blocked-build reason share line 2's slot — a row
                    // has one or the other, never both (`preview` only
                    // exists when `build.ok`, `disabledReason` only when it
                    // is not) — never squeezed onto line 1 with the status,
                    // where it used to get truncated. The reason exists so a
                    // phone user can read *why* the button is disabled, so
                    // line 2 wraps instead of ellipsising it.
                    //
                    // The Weed Farm is the one deed whose number is not a
                    // rent: rentFor() answers 0 for it on purpose (a visitor
                    // pays nothing), and the figure worth showing is the crop
                    // waiting for its owner — the same word and the same
                    // number the TV tile shows. So it prints the crop and
                    // says, on line 2, the only two things that move it.
                    const line1 = street ? status : KIND_LABEL[kind] || kind;
                    const line2 = farm
                      ? `Crop · land on it yourself to harvest · +${fmt(FARM_INCOME_STEP)} per visitor`
                      : preview
                        ? `Rent ${preview}`
                        : disabledReason || null;

                    const nextIsHotel = houses >= HOTEL || (build?.ok ? build.hotel : houses === HOTEL - 1);
                    const priceShown = build?.ok ? build.price : housePrice(cell.id);
                    const cyr = hasCyrillic(cell.header);

                    return (
                      <li
                        key={cell.id}
                        ref={cell.id === focus ? focusRef : undefined}
                        className={cell.id === focus ? sh.rowFocus : undefined}
                      >
                        <Mark cell={cell} size={36} radius={10} />
                        <div className={sh.rowMain}>
                          <div className={sh.rowTitle}>
                            <span lang={cyr ? "ru" : undefined}>{cell.header}</span>
                            <Pips houses={houses} />
                          </div>
                          {line1 && <span className={sh.rowSub}>{line1}</span>}
                          {line2 && <span className={`${sh.rowSub} ${sh.rowSubWrap}`}>{line2}</span>}
                        </div>
                        {street ? (
                          <button
                            type="button"
                            className={sh.rowBtn}
                            onClick={() => onBuild(cell.id)}
                            disabled={!build.ok || busy}
                          >
                            {nextIsHotel ? "Hotel" : "+ House"} {fmt(priceShown)}
                          </button>
                        ) : (
                          <div className={sh.rowNum}>
                            <strong>{fmt(farm ? farmIncome(cell) : rent)}</strong>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </Sheet>
  );
}
