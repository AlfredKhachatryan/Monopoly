import { useState } from "react";
import { LogOut, Volume2, VolumeX } from "lucide-react";
import Sheet from "../Sheet";
import EventRow from "../EventRow";
import sh from "../sheet.module.css";

// The log plus everything else about this session: sound, room code, leaving,
// and the debug jump when it is switched on.
export default function GameSheet({
  open,
  onClose,
  log,
  ctx,
  roomId,
  muted,
  onToggleSound,
  onLeave,
  debug,
  board,
  onJump,
  busy,
}) {
  const [cell, setCell] = useState(1);

  // One block per action, newest first: the actions themselves are reversed,
  // but the events inside a single action keep the order they happened in.
  const groups = [];
  for (const entry of log) {
    const last = groups[groups.length - 1];
    if (last && last.seq === entry.seq) last.events.push(entry);
    else groups.push({ seq: entry.seq, events: [entry] });
  }
  groups.reverse();
  const flat = groups.flatMap((g) => g.events);

  return (
    <Sheet open={open} title="This game" onClose={onClose}>
      {flat.length === 0 ? (
        <p className={sh.empty}>Nothing has happened yet.</p>
      ) : (
        <ul className={sh.log} style={{ "--ev-row-bg": "var(--sunk)" }} aria-label="Game log">
          {flat.map((ev, i) => (
            <EventRow key={`${ev.seq ?? "e"}-${i}`} event={ev} ctx={ctx} />
          ))}
        </ul>
      )}

      <div className={sh.section}>
        <div className={sh.sectionTitle}>Room</div>
        <div className={sh.settingRow}>
          Room code
          <span className={sh.settingValue}>{roomId}</span>
        </div>
        <button type="button" className={sh.settingRow} onClick={onToggleSound}>
          {muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          Sound and vibration
          <span className={sh.settingValue}>{muted ? "Off" : "On"}</span>
        </button>
        <button type="button" className={sh.leaveRow} onClick={onLeave} disabled={busy}>
          <LogOut size={17} />
          Leave the game
        </button>
      </div>

      {debug && board && (
        <div className={sh.section}>
          <div className={sh.sectionTitle}>Debug</div>
          <div className={sh.debugRow}>
            <select
              className={sh.select}
              value={cell}
              onChange={(e) => setCell(Number(e.target.value))}
              aria-label="Jump to cell"
            >
              {Object.values(board).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.id}. {x.header}
                  {x.info && x.info !== x.header ? ` (${x.info})` : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={sh.go}
              onClick={() => {
                onJump(cell);
                onClose();
              }}
              disabled={busy}
            >
              Go
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
