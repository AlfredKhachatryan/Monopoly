// The diplomacy banner on the board centre: a war declared, a peace signed,
// an alliance forming or breaking, and a backstab. Same machinery as
// TvAuction and TvTrade — a fixed-width panel that flies onto the centre and
// holds it for a few seconds (TvCenter's DIPLO_MS), never a control. TvCenter
// decides WHICH of these fired and builds the payload; this file only draws
// it.
//
// Every kind reduces to the same shape: two groups of figures either side of
// an icon (`left` vs `right`), a title, an optional status chip (the number
// that matters — "Double rent · 5 rounds", an amount paid or taken) and an
// optional sub-line. War and peace show WHOLE SIDES — a dragged-in ally rides
// along, per spec — everything else is a plain pair. A side TvCenter could not
// resolve (peace/expiry on a war from before this session, or one the state
// has already dropped — see the note on TvCenter's warCache) is simply an
// empty array, and the row of figures collapses rather than showing a dash.

import { Handshake, Link2, Skull, Swords, Unlink2 } from "lucide-react";
import { nameOfFig, playerByFig } from "../Hooks/rules";
import Tok from "../Client/Tok";
import c from "./tvCenter.module.css";

const ICON = {
  warDeclare: Swords,
  peace: Handshake,
  warEnd: Swords,
  allyForm: Link2,
  allyBreak: Unlink2,
  allyDissolve: Unlink2,
  backstab: Skull,
};

function Group({ figs, players, tag }) {
  const list = (figs || []).filter(Boolean);
  if (list.length === 0) return null;
  return (
    <span className={c.dipGroup}>
      {list.map((fig) => {
        const p = playerByFig(players, fig);
        return (
          <span className={c.dipMember} key={fig}>
            <Tok player={p || { name: fig, figure: fig }} size={56} />
            <span>{p?.name ?? nameOfFig(players, fig)}</span>
            {/* The TRAITOR brand, right under the figure it now applies to —
                complaint B asks the backstab moment to say so more loudly than
                the sub-line alone, the same way DiplomacyOverlay's phone alert
                does with its own header tag. */}
            {tag && <span className={c.traitorTag}>{tag}</span>}
          </span>
        );
      })}
    </span>
  );
}

export default function TvDiplo({ diplo, players }) {
  if (!diplo) return null;
  const { kind, title, sub, chip, tone, left, right } = diplo;
  const Icon = ICON[kind] || Swords;
  const hasSides = (left?.length || 0) > 0 || (right?.length || 0) > 0;
  // A backstab is the one diplomacy moment with a victim rather than two
  // mutual sides, and complaint B asks it to read as CLEARLY heavier than an
  // ordinary alliance break: its own weight class below (a red ring and a
  // bigger icon, `prefers-reduced-motion` already covered by the same
  // fallback every other panel here uses — see tvCenter.module.css), plus the
  // explicit TRAITOR tag under the figure who did it. Both figures and the
  // amount already ride on `left`/`right`/`chip` exactly like every other
  // kind, so nothing about the data this component reads needs to change.
  const isBackstab = kind === "backstab";

  return (
    <div className={`${c.dip} ${isBackstab ? c.dipBackstab : ""}`} data-kind={kind}>
      <div className={c.dipHead}>
        <Icon size={isBackstab ? 44 : 36} aria-hidden="true" />
        <strong>{title}</strong>
      </div>

      {hasSides && (
        <div className={c.dipSides}>
          <Group figs={left} players={players} tag={isBackstab ? "Traitor" : null} />
          <Icon size={26} className={c.dipVs} aria-hidden="true" />
          <Group figs={right} players={players} />
        </div>
      )}

      {chip && (
        <span
          className={`${c.status} ${tone === "pos" ? c.pos : tone === "neg" ? c.neg : ""}`}
        >
          {chip}
        </span>
      )}

      {sub && <span className={c.dipSub}>{sub}</span>}
    </div>
  );
}
