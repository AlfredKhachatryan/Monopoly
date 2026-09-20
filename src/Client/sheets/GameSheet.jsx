import { useEffect, useMemo, useState } from "react";
import { LogOut, RefreshCw, Volume2, VolumeX } from "lucide-react";
import Sheet from "../Sheet";
import EventRow from "../EventRow";
import { describeEvent } from "../EventView";
import sh from "../sheet.module.css";

// How many rows the log opens with. A real six-player game runs to well past
// forty entries and the sheet opened on all of them, so "what just happened"
// meant scrolling. Six is a turn or two — enough to answer that question —
// and everything else is one button away.
const COLLAPSED = 6;

// The log plus everything else about this session: sound, room code, leaving,
// and the debug jump when it is switched on.
//
// `focusKey` is the row the sheet should open already expanded: tapping a row
// in the aura's three-deep preview opens the full log AT that row rather than
// making the player find it again. Its shape is the same `seq#n` key built
// below.
export default function GameSheet({
  open,
  focusKey = null,
  onClose,
  log,
  ctx,
  roomId,
  muted,
  onToggleSound,
  onLeave,
  onRefresh,
  debug,
  board,
  onJump,
  busy,
}) {
  const [cell, setCell] = useState(1);
  const [showAll, setShowAll] = useState(false);
  // Which row is open, by key. One at a time: two expanded five-line rows on a
  // 360px phone is most of the sheet.
  const [openRow, setOpenRow] = useState(null);

  // Collapsed again on every open, and pointed at the row the caller asked for.
  useEffect(() => {
    if (!open) return;
    setShowAll(false);
    setOpenRow(focusKey ?? null);
  }, [open, focusKey]);

  // One block per action, newest first: the actions themselves are reversed,
  // but the events inside a single action keep the order they happened in.
  //
  // The key is `<seq>#<n>` — the action's own sequence number and the event's
  // index WITHIN that action — the same scheme the TV feed uses, and for the
  // same reason: the old `${seq}-${indexInFlatList}` shifted for every row the
  // moment a new action arrived, so React remounted rows (losing the enter
  // animation) and, now that a row can be open, the expansion would have slid
  // onto a different event. This key belongs to the event, not to its position.
  const flat = useMemo(() => {
    const groups = [];
    for (const entry of log) {
      const last = groups[groups.length - 1];
      if (last && last.seq === entry.seq) last.events.push(entry);
      else groups.push({ seq: entry.seq, events: [entry] });
    }
    groups.reverse();
    return groups
      .flatMap((g) => g.events.map((ev, n) => ({ ev, key: `${g.seq ?? "e"}#${n}` })))
      // EventRow renders nothing for an event it cannot describe (turn
      // dividers, bare `land`s, …). Counting those would make "the last 6" mean
      // "the last 6 entries, four of which you can see" — which is what it did
      // on the first pass — and would put a wrong number in "Show all (N)".
      // `n` is still the index within the whole action, so the keys are
      // unchanged and a row's expanded state is unaffected by the filter.
      .filter(({ ev }) => describeEvent(ev, ctx));
  }, [log, ctx]);

  const hidden = Math.max(0, flat.length - COLLAPSED);
  // Newest first, so the first COLLAPSED rows ARE the most recent ones.
  const rows = showAll ? flat : flat.slice(0, COLLAPSED);

  return (
    <Sheet open={open} title="This game" onClose={onClose}>
      {flat.length === 0 ? (
        <p className={sh.empty}>Nothing has happened yet.</p>
      ) : (
        <>
          {/* Sticky, and ABOVE the rows. The list is newest-first and can be
              forty rows long, so a "Show less" parked under it would be a
              scroll to the far end away — exactly the thing being complained
              about. Here it is one thumb from wherever you are. */}
          {hidden > 0 && (
            <div className={sh.logBar}>
              <span className={sh.logBarLab}>Game log</span>
              <button
                type="button"
                className={sh.logToggle}
                aria-expanded={showAll}
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? "Show less" : `Show all (${flat.length})`}
              </button>
            </div>
          )}
          <ul className={sh.log} style={{ "--ev-row-bg": "var(--sunk)" }} aria-label="Game log">
            {rows.map(({ ev, key }) => (
              <EventRow
                key={key}
                event={ev}
                ctx={ctx}
                wrap
                expandable
                expanded={openRow === key}
                onToggle={() => setOpenRow((cur) => (cur === key ? null : key))}
              />
            ))}
          </ul>
        </>
      )}

      <div className={sh.section}>
        <div className={sh.sectionTitle}>Room</div>
        <div className={sh.settingRow}>
          Room code
          <span className={sh.settingValue}>{roomId}</span>
        </div>
        {/* Not gated by `busy`/disconnected on purpose: this is the one button
            whose entire job is to work when nothing else does — a manual
            resync for a socket the connection badge has given up on, or just
            a player who wants to make sure. `onRefresh` is useGameRoom's own
            `refetch`, the same resync the badge's own Reconnect button and
            the visibility/online listeners already call; nothing here fires a
            new server ACTION, so there is nothing for `busy` to protect. */}
        {onRefresh && (
          <button type="button" className={sh.settingRow} onClick={onRefresh}>
            <RefreshCw size={17} />
            Reconnect / refresh state
          </button>
        )}
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
