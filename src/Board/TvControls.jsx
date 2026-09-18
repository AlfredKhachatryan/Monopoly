// The three things the person standing at the TV can do. BoardScreen owns the
// behaviour and passes this whole node to TvSide, which decides where in the
// right column it sits.
//
// Same three actions, same rules, as the old board's .BoardControls:
//   New Game     full reset; confirms first while a game is still running
//                (newGame() in BoardScreen has the rule, unchanged). Outlined
//                rather than filled: it is the one destructive button here.
//   Skip Turn    for a player who closed their phone mid-turn. During an
//                auction the server's skip_turn drops the current BIDDER, so
//                the label says so.
//   Host New Game  a fresh room, exactly as on the "no room yet" screen.
//
// The room status the old board printed next to the code ("Loading" /
// "not found") lives here too, since this is the only block on the TV that
// talks about the room rather than about the game.

import s from "./tv.module.css";

export default function TvControls({
  onNewGame,
  onSkipTurn,
  onHost,
  hosting = false,
  skipDisabled = false,
  auction = false,
  loading = false,
  notFound = false,
  hostError = null,
}) {
  return (
    <div className={s.controls}>
      <div className={s.ctlRow}>
        <button type="button" className={`${s.btn} ${s.danger}`} onClick={onNewGame}>
          New Game
        </button>
        <button
          type="button"
          className={s.btn}
          onClick={onSkipTurn}
          disabled={skipDisabled}
        >
          {auction ? "Skip bidder" : "Skip Turn"}
        </button>
        <button type="button" className={s.btn} onClick={onHost} disabled={hosting}>
          {hosting ? "Creating…" : "Host New Game"}
        </button>
      </div>
      {loading ? <p className={s.note}>Loading the room…</p> : null}
      {!loading && notFound ? <p className={s.bad}>Room not found</p> : null}
      {hostError ? <p className={s.bad}>Could not create game: {hostError}</p> : null}
    </div>
  );
}
