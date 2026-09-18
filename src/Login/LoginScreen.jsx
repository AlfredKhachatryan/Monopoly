// The login screen — the first screen of the same product as the phone
// controller.
//
// Same two halves as the controller: a tinted aura on top carrying the
// wordmark and the character you are about to be, and a white panel pinned to
// the floor with everything you press — the room code, your name, the four
// characters, and one big button. The aura's --tint follows the figure you
// pick, so the screen becomes "yours" the moment you choose, and the same
// colour carries through to the button you press to get in.
//
// The logic is the old src/Pages/Login.jsx's, moved, not rewritten: the room
// code is prefilled from ?room= or the last room this browser joined, the
// fetch + realtime subscription keep `players` live (so a figure someone else
// takes goes grey under your thumb), localStorage.playerInfo turns the screen
// into a rejoin, and the join itself is the one server call this page makes.
//
// The single deliberate change: the two alert() boxes are now an inline
// message above the button, in the controller's banner language. Everything
// they used to say, they still say, word for word.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ShortUniqueId from "short-unique-id";

import { gameAction, useFetch, useRealtimeUpdates } from "../Hooks/supabase";
import { FIG_COLORS, readableOn } from "../Hooks/rules";
import Figure from "../Client/Figure";
import Tok from "../Client/Tok";
import { m, AnimatePresence } from "../Components/Motion";

import FigurePicker from "./FigurePicker";
import { FIGS, FIGURE_ASPECT } from "./figureMeta";
import { useLoginChrome } from "./useLoginChrome";
import { useFitHeight, useViewport } from "./useViewport";
import s from "./login.module.css";

// The aura before you have picked anyone: the controller's own "special"
// slate, the colour it uses for a space with no colour of its own.
const NEUTRAL_TINT = "#5F6B7A";

const MAX_PLAYERS = 4; // the server's own limit — "Room is full" past this

function readStoredPlayer() {
  try {
    return JSON.parse(localStorage.getItem("playerInfo"));
  } catch {
    return null;
  }
}

export function Login() {
  const short = new ShortUniqueId({ length: 6 }); //generate uuid for user

  const [currentFig, setCurrenFig] = useState(null); //current figure ex.'fig0'

  // Room code comes from ?room=XXXX in the URL, or the last room this
  // browser joined, so the player only has to type it once.
  const [inp, setInp] = useState(() => ({
    uuid:
      new URLSearchParams(window.location.search).get("room") ||
      localStorage.getItem("roomId") ||
      "",
  })); //input state

  const { data, error, loading } = useFetch(inp.uuid); //data from db

  const [players, SetPlayers] = useState(data ? data.Players : null); //if there is data  from db then on init its equal to data.Players

  const [logged, setLogged] = useState(false); //state for check if player was before in game

  const navigate = useNavigate();

  function getLogged(Player) {
    if (localStorage.playerInfo !== undefined) {
      const playerId = JSON.parse(localStorage?.playerInfo).playerId;

      if (Player?.filter((e) => e.playerId == playerId).length == 1) {
        setLogged(true);
      } else {
        setLogged(false);
      }
    }
  }

  const handleInserts = (payload) => {
    SetPlayers(payload.new.Players);
    getLogged(payload.new?.Players);
  };

  useRealtimeUpdates(inp.uuid, handleInserts);

  useEffect(() => {
    SetPlayers(data?.Players);
    getLogged(data?.Players);
  }, [data]);

  const [joining, setJoining] = useState(false);

  // What the two alert() calls used to shout. Cleared the moment the player
  // changes anything that could make it untrue.
  const [message, setMessage] = useState(null);

  async function insert() {
    if (logged) {
      localStorage.setItem("roomId", inp.uuid);
      navigate("/Client");
      return;
    }
    if (!(inp.name && currentFig)) {
      setMessage("Pick a name and a figure");
      return;
    }

    const newPlayer = {
      name: inp.name,
      figure: currentFig,
      money: 2500,
      position: 0,
      playerId: localStorage.playerInfo
        ? JSON.parse(localStorage.playerInfo).playerId
        : short.rnd(), // keep the old id so a rejoin from this browser is recognised
    };

    // The server adds the player, assigns the turn order and puts the token
    // on Start under a row lock, so two people joining at once both get in.
    setJoining(true);
    const { error } = await gameAction(inp.uuid, "join", {
      name: newPlayer.name,
      figure: newPlayer.figure,
      playerId: newPlayer.playerId,
    });
    setJoining(false);

    if (error) {
      setMessage(error.message); // "Room v6Pstf not found", "Room is full", "Figure is already taken"
      return;
    }

    localStorage.setItem("roomId", inp.uuid);
    localStorage.playerInfo = JSON.stringify(newPlayer); //saving all in localStorage
    setCurrenFig(null);
    navigate("/Client");
  }

  // ---- presentation ------------------------------------------------------

  const rootRef = useRef(null);
  useLoginChrome(rootRef);
  const { vw, vh } = useViewport();
  const [heroRef, heroBox] = useFitHeight();

  // Who this browser is, for the rejoin state. Read once: the value only
  // changes when this very screen writes it, on its way out to /Client.
  const stored = useMemo(readStoredPlayer, []);
  const mePlayer = useMemo(
    () => (stored?.playerId ? (players || []).find((p) => p.playerId === stored.playerId) : null),
    [players, stored],
  );

  // The figure the screen is dressed as: your pick, or — when you are already
  // in this room — the one you are already playing.
  const heroFig = logged ? (mePlayer?.figure ?? stored?.figure ?? null) : currentFig;
  const tint = FIG_COLORS[heroFig] || NEUTRAL_TINT;
  const onTint = readableOn(tint);

  // Which figures are gone, and to whom. Live: `players` is fed by the
  // realtime subscription above, so this re-reads on every room update.
  const takenBy = useMemo(() => {
    const out = {};
    for (const p of players || []) if (p?.figure) out[p.figure] = p;
    return out;
  }, [players]);

  const count = (players || []).length;
  const code = (inp.uuid || "").trim();

  // The line under the room code, built from the fetch state that was already
  // there. Nothing here asks the server anything new.
  const status = (() => {
    if (!code) return null;
    if (loading) return { tone: "info", text: "Looking for the room…" };
    if (error) return { tone: "warn", text: "Could not reach the game" };
    if (!data) return { tone: "warn", text: "No room with that code" };
    if (count >= MAX_PLAYERS) return { tone: "warn", text: "Room is full" };
    return { tone: "good", text: `Room found · ${count} of ${MAX_PLAYERS} players`, faces: true };
  })();

  // The art is sized in JS, not in CSS: <Figure> writes real width/height
  // attributes on its <img> so nothing shifts while it loads, and a clamp()
  // cannot reach those. `heroBox` is the gap that is genuinely left between
  // the wordmark and the panel, so the character fills it and is never cut in
  // half by the panel on a short screen or behind the keyboard.
  const column = Math.min(vw, 440);
  const heroH = Math.min(200, Math.floor(heroBox));
  // Four across the aura, dimmed, before a pick. They stand shoulder to
  // shoulder with a slight overlap (a line-up, not four thumbnails), which is
  // what lets them be half again as tall in the same width as four separated
  // figures would be: 4w − 3·OVERLAP·w has to fit the column.
  const LINEUP_OVERLAP = 0.18;
  const rowH = Math.min(
    heroH,
    Math.floor((column - 40) / (4 - 3 * LINEUP_OVERLAP) / FIGURE_ASPECT),
  );
  const rowGap = -Math.round(rowH * FIGURE_ASPECT * LINEUP_OVERLAP);
  // Four cards across the panel. They give up height first on a short screen,
  // because the fields and the button below them may not.
  const pickH = Math.max(
    48,
    Math.min(vh < 700 ? 62 : 72, Math.floor((column - 72) / 4 / FIGURE_ASPECT)),
  );

  // Below this the hero is a sliver rather than a character; the wordmark
  // alone holds the aura.
  const heroHidden = heroH < 72;

  function edit(patch) {
    setMessage(null);
    setInp((cur) => ({ ...cur, ...patch }));
  }

  function pick(key) {
    setMessage(null);
    setCurrenFig(key);
  }

  const label = joining
    ? "Joining…"
    : logged
      ? `Rejoin as ${mePlayer?.name ?? stored?.name ?? "me"}`
      : "Join game";

  // Verbatim from the old page, including the second half of the || that the
  // first half already covers — except for the `!logged` guard, which is a
  // deliberate deviation.
  //
  // Why: the old rule asked for a figure. A returning player cannot give one —
  // `logged` disables all four, so `currentFig` is null forever — so the rule
  // held the ReJoin button disabled and locked returning players out of their
  // own game. `logged` needs neither a name nor a figure: insert()'s `logged`
  // branch saves the room id and navigates, and never calls join.
  const disabled =
    joining ||
    (!logged &&
      !(inp.name && inp.uuid && currentFig) &&
      !(inp.name !== "" && inp.uuid !== "" && currentFig));

  return (
    <div
      ref={rootRef}
      className={s.screen}
      data-client=""
      style={{ "--login-tint": tint, "--on-tint": onTint }}
    >
      <div className={s.app}>
        <section className={s.aura} aria-label="Monopoly">
          <header className={s.brand}>
            <h1 className={s.wordmark}>Monopoly</h1>
            <p className={s.sub}>Join the room on the big screen</p>
          </header>

          {/* Always in the tree, so it can be measured even while it is empty
              — the measurement is what decides whether anything goes in it. */}
          <div className={s.hero} ref={heroRef} aria-hidden="true">
            {!heroHidden && (
              <AnimatePresence mode="wait" initial={false}>
                {heroFig ? (
                  <m.div
                    key={heroFig}
                    className={s.heroOne}
                    initial={{ opacity: 0, scale: 0.72, y: 18 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, y: -8 }}
                    transition={{ type: "spring", stiffness: 420, damping: 24, mass: 0.7 }}
                  >
                    {/* The bob is its own element so the swap spring above and
                        the idle loop below never fight over one transform. */}
                    {/* Small on purpose: the Specter floats already, and a
                        big bob would fight the art rather than carry it. */}
                    <m.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <Figure player={{ figure: heroFig }} height={heroH} />
                    </m.div>
                  </m.div>
                ) : (
                  <m.div
                    key="all"
                    className={s.heroRow}
                    style={{ "--lap": `${rowGap}px` }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ duration: 0.25 }}
                  >
                    {FIGS.map((fig) => (
                      <Figure key={fig} player={{ figure: fig }} height={rowH} />
                    ))}
                  </m.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </section>

        <form
          className={s.panel}
          onSubmit={(e) => {
            e.preventDefault();
            insert();
          }}
        >
          <div className={s.field}>
            <label className={s.lab} htmlFor="login-room">
              Room code
            </label>
            <input
              id="login-room"
              className={`${s.input} ${s.code}`}
              type="text"
              value={inp.uuid}
              onChange={(e) => edit({ uuid: e.target.value.trim() })}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              inputMode="text"
              enterKeyHint="next"
              maxLength={16}
            />
            <p
              className={`${s.status} ${status ? s[status.tone] : ""}`}
              aria-live="polite"
              data-on={status ? "" : undefined}
            >
              {status ? (
                <>
                  <span className={s.statusText}>{status.text}</span>
                  {status.faces && count > 0 && (
                    <span className={s.faces}>
                      {(players || []).map((p) => (
                        <Tok key={p.playerId ?? p.figure} player={p} size={22} />
                      ))}
                    </span>
                  )}
                </>
              ) : null}
            </p>
          </div>

          <div className={s.field}>
            <label className={s.lab} htmlFor="login-name">
              Your name
            </label>
            <input
              id="login-name"
              className={s.input}
              type="text"
              value={logged ? (mePlayer?.name ?? stored?.name ?? "") : (inp.name ?? "")}
              onChange={(e) => edit({ name: e.target.value })}
              disabled={logged}
              autoComplete="nickname"
              autoCapitalize="words"
              enterKeyHint="go"
              maxLength={16}
            />
          </div>

          <div className={s.field}>
            <span className={s.lab} id="login-figure-label">
              Your character
            </span>
            <FigurePicker
              value={logged ? heroFig : currentFig}
              takenBy={takenBy}
              onPick={pick}
              size={pickH}
              labelId="login-figure-label"
              allDisabled={logged}
            />
          </div>

          <div className={s.foot}>
            {message && (
              <p className={s.msg} role="alert">
                {message}
              </p>
            )}
            <button type="submit" className={s.submit} disabled={disabled}>
              {label}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default Login;
