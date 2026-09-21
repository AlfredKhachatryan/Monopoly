// Players — and, since diplomacy landed, the one place to SEE and DO
// alliances, wars and the backstab gambit. The spec calls this sheet the
// natural home for it (it is already "everyone at the table, one row each"),
// and asks that it reuse the incoming-trade-offer interaction model rather
// than invent a new one: a pill per available action, and — because these are
// big, irreversible moves — an inline confirm panel that spells out the real
// numbers before anything is sent. Server-answered proposals (an alliance or
// a peace treaty someone sent ME) are NOT here: those are DiplomacyOverlay,
// dealt over the whole screen like a trade offer, reachable even off-turn.
//
// `game` is read-only here — every mutation goes through `onDiplomacy(verb,
// payload)`, a thin wrapper around useGameRoom's `run()` (see ClientScreen).
// Same optional-prop convention `onTrade` already set: without `onDiplomacy`
// this renders as a plain read-only roster (the game is over, or I am not
// seated), same as it always did before diplomacy existed.
import { useState } from "react";
import Sheet from "../Sheet";
import Tok from "../Tok";
import { fmt } from "../format";
import { hasCyrillic } from "../boardDisplay";
import { nameOfFig, ownedBy, playerByFig } from "../../Hooks/rules";
import {
  BACKSTAB_CUT,
  WAR_FEE,
  allyOf,
  canAlly,
  canDeclareWar,
  isTraitorNow,
  warBetween,
  warSides,
  warsOf,
} from "../../Hooks/diplomacy";
import { allyBenefits, allyCosts, backstabCosts, warCosts } from "../diplomacyText";
import sh from "../sheet.module.css";
import d from "../diplomacy.module.css";

const CASH_STEP = 10;
function clampCash(value, max) {
  const ceiling = Math.max(0, Math.floor((Number(max) || 0) / CASH_STEP) * CASH_STEP);
  const rounded = Math.round((Number(value) || 0) / CASH_STEP) * CASH_STEP;
  return Math.min(Math.max(rounded, 0), ceiling);
}

// "You can only do this on your own turn" is not something canAlly()/
// canDeclareWar() check — see their header comments in diplomacy.js, they
// only mirror the RULE conditions. It is checked here, once, the same way
// TradeSheet's `canPropose` already gates trade proposals.
const OWN_TURN_REASON = "You can do this on your own turn";

export default function PlayersSheet({
  open,
  onClose,
  board,
  players,
  current,
  winner,
  // An allied pair wins together (SPEC-DIPLOMACY.md §1) — see useGameRoom.js.
  // Optional: a caller that only ever passes `winner` still gets the single-
  // winner "Winner" tag exactly as before.
  winners,
  meFig,
  me,
  game,
  myTurn,
  phase,
  busy,
  onTrade,
  onDiplomacy,
}) {
  const ordered = [...players].sort((a, b) => a.order - b.order);
  const round = Number(game?.round) || 1;
  const myAlly = meFig ? allyOf(game, meFig) : null;
  const ownTurnOk = !!myTurn && (phase === "roll" || phase === "act");

  // The one inline action panel open at a time: { figure, kind }, kind one of
  // "ally" | "war" | "peace" | "break" | "backstab". Two open panels at once
  // on a 360px sheet is a worse idea than the trade sheet's own single-draft
  // rule, for the same reason — there is only room to read one at a time.
  const [action, setAction] = useState(null);
  const [peaceAmount, setPeaceAmount] = useState(0);

  function toggle(figure, kind) {
    setAction((cur) => {
      if (cur && cur.figure === figure && cur.kind === kind) return null;
      if (kind === "peace") setPeaceAmount(0);
      return { figure, kind };
    });
  }

  // Closes the panel only once the server has actually taken the call — a
  // rejection leaves it open so the reason (surfaced as the usual top-level
  // error banner) lands next to the button that caused it, exactly like
  // TradeSheet leaves a composition standing after a bounced send.
  async function confirm(verb, payload, figure, kind) {
    const res = await onDiplomacy(verb, payload);
    if (!res?.error) setAction((cur) => (cur?.figure === figure && cur?.kind === kind ? null : cur));
    return res;
  }

  const showActions = !!onDiplomacy && !!me;

  return (
    <Sheet open={open} title={`Players (${players.length})`} onClose={onClose}>
      <ul className={d.pList}>
        {ordered.map((p) => {
          const owned = ownedBy(board, p.figure);
          const houses = owned.reduce((n, cell) => n + (cell.houses || 0), 0);
          const jailCards = p.jailCards || 0;
          const isMe = p.figure === meFig;
          const isNow = current?.playerId === p.playerId && !winner;
          const isWinner =
            winners && winners.length ? winners.some((w) => w.figure === p.figure) : winner?.figure === p.figure;
          const cellName = board?.[p.position]?.header;
          const cyr = hasCyrillic(p.name);

          const bits = [
            fmt(p.money ?? 0),
            `${owned.length} deed${owned.length === 1 ? "" : "s"}`,
            houses ? `${houses} house${houses === 1 ? "" : "s"}` : null,
            jailCards ? `${jailCards} jail card${jailCards === 1 ? "" : "s"}` : null,
            cellName || null,
          ].filter(Boolean);

          // ---- relationship, from MY point of view ---------------------
          const rel = relationshipFor(p, { game, players, meFig, myAlly, round, isMe });

          // ---- what this row can do to/for me ---------------------------
          const rowOpen = action?.figure === p.figure ? action.kind : null;
          let warAsPrincipal = null;
          if (!isMe && meFig) {
            warAsPrincipal = (game?.wars || []).find(
              (w) =>
                (w.declarer === meFig && w.target === p.figure) ||
                (w.target === meFig && w.declarer === p.figure),
            );
          }

          return (
            <li key={p.playerId} className={`${d.pRow} ${p.bankrupt ? d.dim : ""}`}>
              <div className={d.pHead}>
                <Tok player={p} size={36} />
                <div className={sh.rowMain}>
                  <div className={sh.rowTitle}>
                    <span lang={cyr ? "ru" : undefined}>{p.name}</span>
                    {isMe && <span className={`${sh.tag} ${sh.tagMe}`}>You</span>}
                    {isNow && <span className={sh.tag}>Now</span>}
                    {p.inJail && <span className={sh.tag}>Jail</span>}
                    {p.bankrupt && <span className={sh.tag}>Out</span>}
                    {isWinner && <span className={sh.tag}>Winner</span>}
                  </div>
                  <span className={`${sh.rowSub} ${sh.rowSubWrap}`}>{bits.join(" · ")}</span>
                  {rel && <span className={`${d.rel} ${d[`rel_${rel.tone}`]}`}>{rel.text}</span>}
                </div>
                {onTrade && !isMe && !p.bankrupt && (
                  <button
                    type="button"
                    className={sh.rowBtn}
                    onClick={() => onTrade(p.figure)}
                    aria-label={`Offer a trade to ${p.name}`}
                  >
                    Trade
                  </button>
                )}
              </div>

              {showActions && !p.bankrupt && !isMe && (
                <div className={d.actions}>
                  {(() => {
                    const check = !ownTurnOk
                      ? { ok: false, reason: OWN_TURN_REASON }
                      : canAlly(game, players, meFig, p.figure);
                    // The reason a pill is disabled is shown as real text, not
                    // just a `title` — a tooltip nobody can hover on a phone
                    // is the same as no reason at all. See the spec's "disable
                    // with the reason shown".
                    const showHint = !check.ok && rowOpen !== "ally";
                    return (
                      <>
                        <button
                          type="button"
                          className={d.pill}
                          onClick={() => toggle(p.figure, "ally")}
                          disabled={busy || showHint}
                          aria-label={`Propose an alliance to ${p.name}${check.reason ? ` — ${check.reason}` : ""}`}
                        >
                          Propose alliance
                        </button>
                        {showHint && <span className={d.pillHint}>{check.reason}</span>}
                      </>
                    );
                  })()}
                  {(() => {
                    const check = !ownTurnOk
                      ? { ok: false, reason: OWN_TURN_REASON }
                      : canDeclareWar(game, players, meFig, p.figure, me?.money);
                    const showHint = !check.ok && rowOpen !== "war";
                    return (
                      <>
                        <button
                          type="button"
                          className={`${d.pill} ${d.pillDanger}`}
                          onClick={() => toggle(p.figure, "war")}
                          disabled={busy || showHint}
                          aria-label={`Declare war on ${p.name}, ${fmt(WAR_FEE)}${check.reason ? ` — ${check.reason}` : ""}`}
                        >
                          Declare war · {fmt(WAR_FEE)}
                        </button>
                        {showHint && <span className={d.pillHint}>{check.reason}</span>}
                      </>
                    );
                  })()}
                  {warAsPrincipal && (() => {
                    const already = warAsPrincipal.peace;
                    const check = !ownTurnOk
                      ? { ok: false, reason: OWN_TURN_REASON }
                      : already
                        ? {
                            ok: false,
                            reason:
                              already.from === meFig
                                ? "Waiting for them to answer your peace offer"
                                : "They already offered peace — answer it above",
                          }
                        : { ok: true };
                    const showHint = !check.ok && rowOpen !== "peace";
                    return (
                      <>
                        <button
                          type="button"
                          className={d.pill}
                          onClick={() => toggle(p.figure, "peace")}
                          disabled={busy || showHint}
                        >
                          Propose peace
                        </button>
                        {showHint && <span className={d.pillHint}>{check.reason}</span>}
                      </>
                    );
                  })()}
                </div>
              )}

              {showActions && isMe && myAlly && (
                <div className={d.actions}>
                  {(() => {
                    const check = ownTurnOk ? { ok: true } : { ok: false, reason: OWN_TURN_REASON };
                    const showHint = !check.ok && rowOpen !== "break";
                    return (
                      <>
                        <button
                          type="button"
                          className={d.pill}
                          onClick={() => toggle(p.figure, "break")}
                          disabled={busy || showHint}
                        >
                          Break alliance
                        </button>
                        {showHint && <span className={d.pillHint}>{check.reason}</span>}
                      </>
                    );
                  })()}
                  {(() => {
                    const check = !ownTurnOk
                      ? { ok: false, reason: OWN_TURN_REASON }
                      : me?.backstabUsed
                        ? { ok: false, reason: "Only once per game, and you have used it" }
                        : { ok: true };
                    const showHint = !check.ok && rowOpen !== "backstab";
                    return (
                      <>
                        <button
                          type="button"
                          className={`${d.pill} ${d.pillDanger}`}
                          onClick={() => toggle(p.figure, "backstab")}
                          disabled={busy || showHint}
                        >
                          Backstab
                        </button>
                        {showHint && <span className={d.pillHint}>{check.reason}</span>}
                      </>
                    );
                  })()}
                </div>
              )}

              {/* ---- the confirm panels ---------------------------------- */}
              {rowOpen === "ally" && (
                <div className={d.panel}>
                  <p className={d.panelLead}>Ally with {p.name}?</p>
                  <div className={d.panelCols}>
                    <div>
                      <p className={`${d.panelColHead} ${d.good}`}>Benefits</p>
                      <ul className={d.panelList}>
                        {allyBenefits().map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className={`${d.panelColHead} ${d.bad}`}>Costs</p>
                      <ul className={d.panelList}>
                        {allyCosts().map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <div className={d.panelAct}>
                    <button type="button" className={d.cancel} onClick={() => setAction(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={d.confirm}
                      disabled={busy}
                      onClick={() => confirm("ally_propose", { to: p.figure }, p.figure, "ally")}
                    >
                      Propose alliance
                    </button>
                  </div>
                </div>
              )}

              {rowOpen === "war" && (
                <div className={d.panel}>
                  <p className={d.panelLead}>Declare war on {p.name}?</p>
                  <ul className={d.panelList}>
                    {warCosts().map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <div className={d.panelAct}>
                    <button type="button" className={d.cancel} onClick={() => setAction(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={`${d.confirm} ${d.confirmDanger}`}
                      disabled={busy}
                      onClick={() => confirm("war_declare", { target: p.figure }, p.figure, "war")}
                    >
                      Declare war · {fmt(WAR_FEE)}
                    </button>
                  </div>
                </div>
              )}

              {rowOpen === "peace" && warAsPrincipal && (
                <div className={d.panel}>
                  <p className={d.panelLead}>Offer peace to {p.name}?</p>
                  <p className={d.panelNote}>
                    Ending the war returns rent to normal for both whole sides immediately. A
                    payment is optional — the bigger the offer, the harder it is to refuse.
                  </p>
                  <div className={d.stepRow}>
                    <span>Payment (optional)</span>
                    <div className={d.stepGroup}>
                      <button
                        type="button"
                        className={d.stepBtn}
                        aria-label="Decrease payment"
                        disabled={peaceAmount <= 0}
                        onClick={() => setPeaceAmount((v) => clampCash(v - CASH_STEP, me?.money))}
                      >
                        −
                      </button>
                      <span className={d.stepVal}>{fmt(peaceAmount)}</span>
                      <button
                        type="button"
                        className={d.stepBtn}
                        aria-label="Increase payment"
                        disabled={peaceAmount >= clampCash(me?.money, me?.money)}
                        onClick={() => setPeaceAmount((v) => clampCash(v + CASH_STEP, me?.money))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className={d.panelAct}>
                    <button type="button" className={d.cancel} onClick={() => setAction(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={d.confirm}
                      disabled={busy}
                      onClick={() =>
                        confirm(
                          "peace_propose",
                          { warId: warAsPrincipal.id, amount: peaceAmount },
                          p.figure,
                          "peace",
                        )
                      }
                    >
                      Offer peace
                    </button>
                  </div>
                </div>
              )}

              {rowOpen === "break" && (
                <div className={d.panel}>
                  <p className={d.panelLead}>Break your alliance with {nameOfFig(players, myAlly)}?</p>
                  <p className={d.panelNote}>
                    Free, any time on your turn. The +25% outsider tax and the round upkeep stop
                    immediately for both of you.
                  </p>
                  <div className={d.panelAct}>
                    <button type="button" className={d.cancel} onClick={() => setAction(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={d.confirm}
                      disabled={busy}
                      onClick={() => confirm("ally_break", {}, meFig, "break")}
                    >
                      Break alliance
                    </button>
                  </div>
                </div>
              )}

              {rowOpen === "backstab" && (() => {
                const allyPlayer = playerByFig(players, myAlly);
                const cut = Math.floor((allyPlayer?.money || 0) * BACKSTAB_CUT);
                return (
                  <div className={d.panel}>
                    <p className={d.panelLead}>Backstab {allyPlayer?.name}?</p>
                    <ul className={d.panelList}>
                      {backstabCosts(cut).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                    <div className={d.panelAct}>
                      <button type="button" className={d.cancel} onClick={() => setAction(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={`${d.confirm} ${d.confirmDanger}`}
                        disabled={busy}
                        onClick={() => confirm("backstab", {}, meFig, "backstab")}
                      >
                        Backstab · take {fmt(cut)}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

// One line describing MY relationship to `p` — Ally / At war / Traitor brand
// / nothing worth a chip. For my OWN row this reads as a status summary
// instead ("Allied with X · At war with Y"), which is the same information
// the aura's compact chips show, just spelled out.
function relationshipFor(p, { game, players, meFig, myAlly, round, isMe }) {
  const traitorActive = isTraitorNow(game, p);
  if (isMe) {
    const bits = [];
    if (myAlly) bits.push(`Allied with ${nameOfFig(players, myAlly)}`);
    const mine = meFig ? warsOf(game, meFig) : [];
    if (mine.length) {
      const names = mine.map((w) => {
        const sides = warSides(game, w);
        const other = sides.a.includes(meFig) ? sides.b : sides.a;
        return other.map((f) => nameOfFig(players, f)).join(" & ");
      });
      bits.push(`At war with ${names.join(", ")}`);
    }
    if (p.traitor) {
      const left = Math.max((Number(p.traitorUntil) || 0) - round, 0);
      bits.push(traitorActive ? `Traitor · +25% rent, ${left} round${left === 1 ? "" : "s"} left` : "Traitor");
    }
    if (!bits.length) return null;
    return { text: bits.join(" · "), tone: mine.length ? "war" : myAlly ? "ally" : "traitor" };
  }

  if (!meFig) return null;
  if (myAlly === p.figure) return { text: "Your ally", tone: "ally" };
  const war = warBetween(game, meFig, p.figure);
  if (war) {
    const sides = warSides(game, war);
    const mySide = sides.a.includes(meFig) ? "a" : "b";
    const theirSide = sides.a.includes(p.figure) ? "a" : "b";
    const left = Math.max((Number(war.endsRound) || round) - round, 0);
    return mySide === theirSide
      ? { text: `Allied, at war together · ${left} round${left === 1 ? "" : "s"} left`, tone: "war" }
      : { text: `At war · ${left} round${left === 1 ? "" : "s"} left`, tone: "war" };
  }
  if (p.traitor) {
    const left = Math.max((Number(p.traitorUntil) || 0) - round, 0);
    return {
      text: traitorActive ? `Traitor · +25% rent, ${left} round${left === 1 ? "" : "s"} left` : "Traitor",
      tone: "traitor",
    };
  }
  return null;
}
