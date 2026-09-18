import { useEffect, useRef } from "react";
import Sheet from "../Sheet";
import Mark from "../Mark";
import { fmt } from "../format";
import { groupByColor } from "../../Hooks/groupByColor";
import { GROUP_NAMES, KIND_LABEL, Pips, hasCyrillic } from "../boardDisplay";
import {
  HOTEL,
  canBuild,
  cellKind,
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
export default function MineSheet({ open, onClose, board, me, focus, onBuild, busy }) {
  const mine = me ? ownedBy(board, me.figure) : [];
  const groups = groupByColor(mine);
  const totalPaid = mine.reduce((sum, c) => sum + (priceOf(c) || 0), 0);
  const focusRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => focusRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 320);
    return () => clearTimeout(t);
  }, [open, focus]);

  return (
    <Sheet open={open} title="My properties" onClose={onClose}>
      {mine.length === 0 ? (
        <p className={sh.empty}>
          Nothing here yet.
          <br />
          Land on a free street, railroad or utility and buy it.
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
                  <div className={sh.groupLabel}>Railroads &amp; utilities</div>
                )}

                <ul className={sh.list}>
                  {cells.map((cell) => {
                    const kind = cellKind(cell);
                    const street = kind === "street";
                    const houses = cell.houses || 0;
                    const build = street ? canBuild(board, me.figure, cell.id, me.money) : null;
                    const rent = rentFor(board, cell.id);

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
                    const line1 = street ? status : KIND_LABEL[kind] || kind;
                    const line2 = preview ? `Rent ${preview}` : disabledReason || null;

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
                            <strong>{fmt(rent)}</strong>
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
