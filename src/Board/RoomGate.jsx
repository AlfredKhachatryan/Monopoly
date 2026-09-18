// What the TV shows before it has a room: type a code, or host a new game.
//
// Same two ways in as the old board's "no room yet" screen, same state and the
// same disabled rules — only the skin is new. It is deliberately NOT on the
// 1920x1080 canvas: the person doing this is standing at a keyboard, often on a
// laptop, not sitting in front of a TV, so it is a normal responsive page.

import s from "./tv.module.css";

export default function RoomGate({
  value,
  onChange,
  onOpen,
  onHost,
  hosting = false,
  hostError = null,
  rootRef,
}) {
  return (
    <div ref={rootRef} className={s.gate} data-client="">
      <form
        className={s.gateCard}
        onSubmit={(e) => {
          e.preventDefault();
          if (value) onOpen();
        }}
        aria-label="Open the board"
      >
        <div>
          <h1 className={s.gateTitle}>Monopoly board</h1>
          <p className={s.gateSub}>
            Open the room your players are in, or start a new one.
          </p>
        </div>
        <input
          className={s.input}
          placeholder="Room code"
          aria-label="Room code"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck="false"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
        />
        <div className={s.controls}>
          <button type="submit" className={s.btn} disabled={!value}>
            Open Board
          </button>
        </div>
        <p className={s.or}>or</p>
        <div className={s.controls}>
          <button type="button" className={s.btn} onClick={onHost} disabled={hosting}>
            {hosting ? "Creating…" : "Host New Game"}
          </button>
          {hostError ? (
            <p className={s.bad}>Could not create game: {hostError}</p>
          ) : null}
        </div>
      </form>
    </div>
  );
}
