// "Offer a trade" compose sheet, and "Counter-offer" when countering a
// pending trade someone sent me. Built on the shared <Sheet>, so dialog a11y
// (focus save/restore, Tab trap, Escape) already comes for free.
//
// Local state (partner + the two sides' cells/cash) is only ever
// re-initialised when the sheet opens or `draft`/`counterOf` change identity
// — never on every `board` tick, or a selection the player is mid-way
// through building would be wiped out by the next poll.

import { useEffect, useMemo, useRef, useState } from "react";
import Sheet from "../Sheet";
import Mark from "../Mark";
import Tok from "../Tok";
import { fmt } from "../format";
import { hasCyrillic } from "../boardDisplay";
import { ownedBy, priceOf, tradable, tradableOwnedBy } from "../../Hooks/rules";
import sh from "../sheet.module.css";
import t from "../trade.module.css";

const CASH_STEP = 10;

// Rounds to the nearest step and clamps to [0, floor(max/step)*step] — the
// stepper, the quick chips and a prefilled draft all funnel through this so
// the cash amount is never above what the payer actually has.
function clampCash(value, max) {
  const ceiling = Math.max(0, Math.floor((Number(max) || 0) / CASH_STEP) * CASH_STEP);
  const rounded = Math.round((Number(value) || 0) / CASH_STEP) * CASH_STEP;
  return Math.min(Math.max(rounded, 0), ceiling);
}

function sideValue(board, ids, cash) {
  return ids.reduce((sum, id) => sum + (priceOf(board?.[id]) || 0), 0) + cash;
}

export default function TradeSheet({
  open,
  onClose,
  board,
  players,
  me,
  canPropose,
  whyNot,
  draft,
  counterOf,
  busy,
  onSend,
  onCounter,
}) {
  const others = useMemo(
    () => (players || []).filter((p) => p.figure !== me?.figure && !p.bankrupt),
    [players, me?.figure],
  );

  const [partner, setPartner] = useState(null);
  const [giveCells, setGiveCells] = useState(() => new Set());
  const [giveCash, setGiveCash] = useState(0);
  const [getCells, setGetCells] = useState(() => new Set());
  const [getCash, setGetCash] = useState(0);
  const radioRefs = useRef([]);

  useEffect(() => {
    if (!open) return;
    const fixedPartner = counterOf?.from;
    const initialPartner =
      fixedPartner && others.some((p) => p.figure === fixedPartner)
        ? fixedPartner
        : draft?.to && others.some((p) => p.figure === draft.to)
          ? draft.to
          : (others[0]?.figure ?? null);

    const mineIds = new Set(tradableOwnedBy(board, me?.figure).map((c) => c.id));
    const partnerIds = new Set(
      initialPartner ? tradableOwnedBy(board, initialPartner).map((c) => c.id) : [],
    );
    const partnerPlayer = others.find((p) => p.figure === initialPartner) || null;

    setPartner(initialPartner);
    setGiveCells(new Set((draft?.give?.cells || []).filter((id) => mineIds.has(id))));
    setGetCells(new Set((draft?.get?.cells || []).filter((id) => partnerIds.has(id))));
    setGiveCash(clampCash(draft?.give?.cash, me?.money));
    setGetCash(clampCash(draft?.get?.cash, partnerPlayer?.money));
    // Intentionally NOT depending on `board`/`others`/`me`: this only re-runs
    // when the sheet opens or the prefill identity changes (see file header).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft, counterOf]);

  const partnerPlayer = others.find((p) => p.figure === partner) || null;
  const mine = me ? ownedBy(board, me.figure) : [];
  const theirs = partnerPlayer ? ownedBy(board, partnerPlayer.figure) : [];

  const mineTradableIds = useMemo(
    () => new Set(mine.filter((c) => tradable(board, c.id)).map((c) => c.id)),
    [board, mine],
  );
  const theirsTradableIds = useMemo(
    () => new Set(theirs.filter((c) => tradable(board, c.id)).map((c) => c.id)),
    [board, theirs],
  );
  const mineHasUntradable = mine.some((c) => !mineTradableIds.has(c.id));
  const theirsHasUntradable = theirs.some((c) => !theirsTradableIds.has(c.id));

  const maxGiveCash = Math.max(0, Math.floor((me?.money || 0) / CASH_STEP) * CASH_STEP);
  const maxGetCash = Math.max(0, Math.floor((partnerPlayer?.money || 0) / CASH_STEP) * CASH_STEP);

  // Either side's cap can drop out from under a composition already in
  // progress — the partner may have paid rent, or I might have, while the
  // sheet sat open. Re-clamp the DISPLAYED amount the moment the cap drops,
  // rather than let the stepper show a number a send would silently cut down.
  useEffect(() => {
    setGiveCash((c) => clampCash(c, me?.money));
  }, [me?.money]);
  useEffect(() => {
    setGetCash((c) => clampCash(c, partnerPlayer?.money));
  }, [partnerPlayer?.money]);

  function toggleGive(id) {
    setGiveCells((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGet(id) {
    setGetCells((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Changing partner invalidates whatever was picked on the "get" side —
  // those cells belonged to the old partner.
  function choosePartner(fig) {
    if (fig === partner) return;
    setPartner(fig);
    setGetCells(new Set());
    setGetCash(0);
  }

  function handleRadioKeyDown(e, idx) {
    let dir = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") dir = -1;
    else if (e.key === "ArrowRight" || e.key === "ArrowDown") dir = 1;
    else return;
    e.preventDefault();
    if (others.length === 0) return;
    const next = (idx + dir + others.length) % others.length;
    const fig = others[next]?.figure;
    if (!fig) return;
    choosePartner(fig);
    radioRefs.current[next]?.focus();
  }

  const giveIds = [...giveCells].filter((id) => mineTradableIds.has(id)).sort((a, b) => a - b);
  const getIds = [...getCells].filter((id) => theirsTradableIds.has(id)).sort((a, b) => a - b);
  const giveValue = sideValue(board, giveIds, giveCash);
  const getValue = sideValue(board, getIds, getCash);
  const giveEmpty = giveIds.length === 0 && giveCash === 0;
  const getEmpty = getIds.length === 0 && getCash === 0;
  const sendDisabled = giveEmpty || getEmpty || busy || (!canPropose && !counterOf) || !partner;

  async function handleSend() {
    // Re-clamp at the moment of sending, not just at the moment of typing: the
    // partner (or I) may have paid rent since the last stepper tap, and the
    // send-time amount must never be the one that has already fallen out of
    // date.
    const payload = {
      to: partner,
      give: { cells: giveIds, cash: clampCash(giveCash, me?.money) },
      get: { cells: getIds, cash: clampCash(getCash, partnerPlayer?.money) },
    };
    const res = counterOf
      ? await onCounter({ give: payload.give, get: payload.get })
      : await onSend(payload);
    // A server rejection must not throw away the whole composition — only a
    // call that actually went through gets to close the sheet.
    if (!res?.error) onClose();
  }

  const title = counterOf ? "Counter-offer" : "Offer a trade";
  const noPartner = others.length === 0;
  const showComposer = !noPartner && (Boolean(counterOf) || canPropose);

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      {!showComposer ? (
        <p className={sh.empty}>{noPartner ? "Nobody to trade with" : whyNot}</p>
      ) : (
        <>
          {counterOf ? (
            <p className={t.trTo}>To {partnerPlayer?.name ?? "…"}</p>
          ) : (
            <div className={t.trWho} role="radiogroup" aria-label="Trade with">
              {others.map((p, i) => {
                const checked = p.figure === partner;
                const cyr = hasCyrillic(p.name);
                return (
                  <button
                    key={p.figure}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    tabIndex={checked ? 0 : -1}
                    ref={(el) => {
                      radioRefs.current[i] = el;
                    }}
                    className={t.trP}
                    onClick={() => choosePartner(p.figure)}
                    onKeyDown={(e) => handleRadioKeyDown(e, i)}
                  >
                    <Tok player={p} size={36} />
                    <span lang={cyr ? "ru" : undefined}>{p.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className={t.trH}>You give</div>
          {mine.length === 0 ? (
            <p className={t.trNone}>No properties</p>
          ) : (
            <div className={t.trChips}>
              {mine.map((cell) => {
                const disabled = !mineTradableIds.has(cell.id);
                const pressed = giveCells.has(cell.id);
                const cyr = hasCyrillic(cell.header);
                return (
                  <button
                    key={cell.id}
                    type="button"
                    className={t.trChip}
                    aria-pressed={pressed}
                    disabled={disabled}
                    aria-label={disabled ? `${cell.header}, has buildings in its set` : cell.header}
                    onClick={() => toggleGive(cell.id)}
                  >
                    <Mark cell={cell} size={32} radius={10} />
                    <span lang={cyr ? "ru" : undefined}>{cell.header}</span>
                  </button>
                );
              })}
            </div>
          )}
          {mineHasUntradable && <p className={t.trHint}>Sets with buildings can&rsquo;t be traded</p>}

          <div className={t.trCash}>
            <div className={t.trCashRow}>
              <span>Cash you give</span>
              <div className={t.trStepGroup}>
                <button
                  type="button"
                  className={t.trStepBtn}
                  aria-label="Decrease cash you give"
                  disabled={giveCash <= 0}
                  onClick={() => setGiveCash((c) => clampCash(c - CASH_STEP, me?.money))}
                >
                  −
                </button>
                <span className={t.trCashVal}>{fmt(giveCash)}</span>
                <button
                  type="button"
                  className={t.trStepBtn}
                  aria-label="Increase cash you give"
                  disabled={giveCash >= maxGiveCash}
                  onClick={() => setGiveCash((c) => clampCash(c + CASH_STEP, me?.money))}
                >
                  +
                </button>
              </div>
            </div>
            {(giveCash + 50 <= maxGiveCash || giveCash + 100 <= maxGiveCash) && (
              <div className={t.trCashQuick}>
                {giveCash + 50 <= maxGiveCash && (
                  <button
                    type="button"
                    className={t.trQuick}
                    onClick={() => setGiveCash((c) => clampCash(c + 50, me?.money))}
                  >
                    +50
                  </button>
                )}
                {giveCash + 100 <= maxGiveCash && (
                  <button
                    type="button"
                    className={t.trQuick}
                    onClick={() => setGiveCash((c) => clampCash(c + 100, me?.money))}
                  >
                    +100
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={t.trH}>You get from {partnerPlayer?.name ?? "…"}</div>
          {theirs.length === 0 ? (
            <p className={t.trNone}>No properties</p>
          ) : (
            <div className={t.trChips}>
              {theirs.map((cell) => {
                const disabled = !theirsTradableIds.has(cell.id);
                const pressed = getCells.has(cell.id);
                const cyr = hasCyrillic(cell.header);
                return (
                  <button
                    key={cell.id}
                    type="button"
                    className={t.trChip}
                    aria-pressed={pressed}
                    disabled={disabled}
                    aria-label={disabled ? `${cell.header}, has buildings in its set` : cell.header}
                    onClick={() => toggleGet(cell.id)}
                  >
                    <Mark cell={cell} size={32} radius={10} />
                    <span lang={cyr ? "ru" : undefined}>{cell.header}</span>
                  </button>
                );
              })}
            </div>
          )}
          {theirsHasUntradable && <p className={t.trHint}>Sets with buildings can&rsquo;t be traded</p>}

          <div className={t.trCash}>
            <div className={t.trCashRow}>
              <span>Cash you get</span>
              <div className={t.trStepGroup}>
                <button
                  type="button"
                  className={t.trStepBtn}
                  aria-label="Decrease cash you get"
                  disabled={getCash <= 0}
                  onClick={() => setGetCash((c) => clampCash(c - CASH_STEP, partnerPlayer?.money))}
                >
                  −
                </button>
                <span className={t.trCashVal}>{fmt(getCash)}</span>
                <button
                  type="button"
                  className={t.trStepBtn}
                  aria-label="Increase cash you get"
                  disabled={getCash >= maxGetCash}
                  onClick={() => setGetCash((c) => clampCash(c + CASH_STEP, partnerPlayer?.money))}
                >
                  +
                </button>
              </div>
            </div>
            {(getCash + 50 <= maxGetCash || getCash + 100 <= maxGetCash) && (
              <div className={t.trCashQuick}>
                {getCash + 50 <= maxGetCash && (
                  <button
                    type="button"
                    className={t.trQuick}
                    onClick={() => setGetCash((c) => clampCash(c + 50, partnerPlayer?.money))}
                  >
                    +50
                  </button>
                )}
                {getCash + 100 <= maxGetCash && (
                  <button
                    type="button"
                    className={t.trQuick}
                    onClick={() => setGetCash((c) => clampCash(c + 100, partnerPlayer?.money))}
                  >
                    +100
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={t.bSum}>
            <div className={t.bStat}>
              <span>You give</span>
              <strong>{fmt(giveValue)}</strong>
            </div>
            <div className={t.bStat}>
              <span>You get</span>
              <strong>{fmt(getValue)}</strong>
            </div>
            <button type="button" className={t.bConfirm} disabled={sendDisabled} onClick={handleSend}>
              {counterOf ? "Send counter" : "Send offer"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
