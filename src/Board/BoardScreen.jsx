// The shared big-screen board, route "/".
//
// This file is the old src/Pages/Board.jsx's logic, moved here unchanged: room
// code resolution, hosting, the Supabase fetch + realtime subscription, the
// board action wrapper, New Game with its confirm rule, Skip Turn, the error
// states and the "no room yet" screen. Nothing about WHEN anything happens is
// new — only what it looks like.
//
// The screen itself is one fixed 1920x1080 canvas (useTvScale) split into the
// 1024px board and a right column:
//
//   BoardGrid   40 memoised tiles + TvCenter (the board centre) + TvTokens
//   TvSide      room, players, money, properties, latest events, and the
//               controls node this file hands it
//
// --tint / --on-tint are written on the root from the tile in focus — the
// auctioned space while an auction runs, otherwise the tile the player whose
// turn it is stands on. Every rule downstream reads those two, so the centre
// glow and the ticket re-tint on a move with no component re-rendering for the
// colour's sake, exactly like the phone controller does.

import { useEffect, useMemo, useRef, useState } from "react";
import ShortUniqueId from "short-unique-id";
import { initialState } from "../Hooks/baseState";
import {
  useRealtimeUpdates,
  useFetch,
  gameAction,
  createGame,
} from "../Hooks/supabase";
import { useWalkingTokens } from "../Hooks/useWalkingTokens";
import { accentFor, nameOfFig, readableOn } from "../Hooks/rules";
import { useReveal, REVEAL } from "../Client/useReveal";
import { announceBatch } from "../Client/transfers";
import BoardGrid from "./BoardGrid";
import RoomGate from "./RoomGate";
import TvControls from "./TvControls";
import TvPayFx from "./TvPayFx";
import TvSide from "./TvSide";
import { useTvFeed } from "./TvFeed";
import useTvChrome from "./useTvChrome";
import useTvScale from "./useTvScale";
import s from "./tv.module.css";

const short = new ShortUniqueId({ length: 6 }); // room codes, e.g. "v6Pstf"

function readRoomId() {
  return (
    new URLSearchParams(window.location.search).get("room") ||
    localStorage.getItem("roomId") ||
    ""
  );
}

function Main() {
  // Room code: /?room=XXXX wins, then the last room used in this browser.
  // The TV usually opens the URL with the code; players type it on /Login.
  const [uuid, setUuid] = useState(readRoomId);
  const [roomInput, setRoomInput] = useState("");
  const [hosting, setHosting] = useState(false);
  const [hostError, setHostError] = useState(null);
  const [boardError, setBoardError] = useState(null);

  useEffect(() => {
    if (!uuid) return;
    localStorage.setItem("roomId", uuid);
    // keep ?room= in the address bar so a refresh / bookmark keeps the room
    const url = new URL(window.location.href);
    if (url.searchParams.get("room") !== uuid) {
      url.searchParams.set("room", uuid);
      window.history.replaceState(null, "", url);
    }
  }, [uuid]);

  // Host: insert a fresh row with an empty board and open it here.
  async function hostGame() {
    setHosting(true);
    setHostError(null);
    const { uuid: newUuid, error } = await createGame(initialState(), () =>
      short.rnd(),
    );
    setHosting(false);
    if (error) {
      setHostError(error.message);
      return;
    }
    setPos(initialState());
    setUserData([]);
    setCurrentOrder(0);
    setGame({});
    setUuid(newUuid);
  }

  const [pos, setPos] = useState(initialState());
  const [userData, setUserData] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [game, setGame] = useState({});
  const { data, loading } = useFetch(uuid);

  // ---- the reveal buffer -------------------------------------------------
  // The row that carries a roll also carries everything the roll caused, and
  // the TV used to apply all of it the moment it arrived — pieces flew, cash
  // counted and the card was dealt while the dice were still in the air.
  //
  // So the screen reads a SNAPSHOT that may be held one beat behind: `view` is
  // the live state except while a roll is landing, when it is the state the
  // room was already looking at. useTvFeed is what makes that honest — it
  // adopts the first row it ever sees in silence, so a refresh replays
  // nothing and nothing is ever held on it.
  //
  // Everything downstream (TvCenter's card, TvSide's "Latest", the token
  // flight) keys off the held `game` / `pos`, so they all release together.
  // The dice are the one exception: they get `reveal.roll` directly, because
  // they are the thing everyone is waiting for.
  const tvFeed = useTvFeed(game);
  const snapshot = useMemo(
    () => ({ pos, userData, currentOrder, game }),
    [pos, userData, currentOrder, game],
  );
  const reveal = useReveal(snapshot, tvFeed);
  const view = reveal.view;
  const shownPos = view.pos;
  const shownPlayers = view.userData;
  const shownGame = view.game;

  // Tokens fly from their old tile to their DB position. They are drawn by
  // TvTokens on top of the grid, so the tiles themselves never re-render while
  // a token moves. Fed the HELD board, so a piece leaves its tile the instant
  // the dice come to rest and not a moment before.
  const shownTokens = useWalkingTokens(shownPos);

  // ---- what just moved ---------------------------------------------------
  const payItems = useMemo(
    () => announceBatch(reveal.feed?.events ?? []),
    [reveal.feed],
  );
  const payRolled = !!reveal.feed?.events?.some((e) => e?.type === "roll");
  // A card that caused the payment gets to speak first: the overlay is dealt at
  // REVEAL.CARD_MS and holds the centre, so the transfer waits behind it rather
  // than arguing with it. The banner then hangs along the bottom of the centre,
  // clear of the 440x540 card face above it.
  const payCard = !!reveal.feed?.events?.some((e) => e?.type === "card");
  const payDelay =
    (payRolled ? REVEAL.PIECE_MS : 60) +
    (payCard ? REVEAL.CARD_MS + REVEAL.CARD_CLEAR_MS : 0);
  // The cash numbers count as the coins arrive, not before: the count-up is
  // the coins landing, told in digits.
  const cashDelay =
    payItems.length > 0 ? payDelay + REVEAL.COIN_MS - REVEAL.CASH_LEAD : 0;

  function updatePos(pos, user, order, g) {
    if (pos) {
      setPos(pos);
    }
    setUserData(user);
    setCurrentOrder(order);
    setGame(g || {});
  }

  useEffect(() => {
    if (data) {
      updatePos(data.position, data.Players, data.current_order, data.game);
    }
  }, [data]);

  const handleInserts = (payload) => {
    updatePos(
      payload.new.position,
      payload.new.Players,
      payload.new.current_order,
      payload.new.game,
    );
  };

  useRealtimeUpdates(uuid, handleInserts); //when DB is updated he does some function

  async function boardAction(action, payload) {
    setBoardError(null);
    const { error } = await gameAction(uuid, action, payload);
    if (error) setBoardError(error.message);
  }

  // Full reset: board, money, positions, houses. Players keep their seats.
  function newGame() {
    if (
      userData?.length &&
      game.phase !== "over" &&
      !window.confirm(
        "Start a new game? Money, property and positions are reset for everyone.",
      )
    ) {
      return;
    }
    boardAction("new_game", { position: initialState() });
  }

  // For a player who closed their phone mid-turn.
  function skipTurn() {
    boardAction("skip_turn", {});
  }

  const over = shownGame.phase === "over";
  const auctionOn = shownGame.phase === "auction";

  // Whose turn it is, and the tile everything points at. During an auction that
  // is the space being sold, not where anybody is standing.
  const current =
    (shownPlayers || []).find((p) => p.order === view.currentOrder) ?? null;
  const auctionCell = auctionOn ? shownGame.auction?.cell : null;
  const focusCellId = auctionCell ?? current?.position ?? null;
  const focusCell = focusCellId != null ? shownPos?.[focusCellId] : null;
  const tint = accentFor(focusCell);

  // Who the room is waiting for. During the beat the centre says so out loud;
  // `reveal.roll.by` is the figure the roll event named, so it is right even
  // when the turn has already moved on underneath.
  const roller = reveal.rolling
    ? nameOfFig(shownPlayers || [], reveal.roll?.by) || current?.name || null
    : null;

  const rootRef = useRef(null);
  const scale = useTvScale();
  useTvChrome(rootRef);

  const controls = (
    <TvControls
      onNewGame={newGame}
      onSkipTurn={skipTurn}
      onHost={hostGame}
      hosting={hosting}
      skipDisabled={over || !userData?.length}
      auction={auctionOn}
      loading={loading}
      notFound={!loading && !data}
      hostError={hostError}
    />
  );

  // Everything above this line that is not the game (2026-09-19) — all of it
  // view timing, none of it a rule:
  //   `tvFeed` = useTvFeed(game)   live-vs-refresh detection, moved up here so
  //                                the whole screen shares one answer
  //   `snapshot` / `reveal`        the presentation buffer (Client/useReveal.js).
  //                                `view` is the live row EXCEPT while a roll is
  //                                landing, when it is the row already on screen
  //   `shownPos` / `shownPlayers` / `shownGame`
  //                                what every child is given instead of the raw
  //                                `pos` / `userData` / `game` — so the token
  //                                flight, the player cards, the Latest list and
  //                                the centre overlays all release together
  //   useWalkingTokens(shownPos)   the piece leaves its tile when the dice are
  //                                down, not when the row arrives
  //   `current` / `focusCellId` / `tint` / `over` / `auctionOn`
  //                                all read from the held view
  //   `roller`                     who the room is waiting for, for the centre
  //                                sub-line ("Afo is rolling…")
  //   `payItems` / `payRolled` / `payCard` / `payDelay` / `cashDelay`
  //                                the money choreography, derived during render
  //   BoardGrid `roll`/`roller`    passed straight through to TvCenter: the dice
  //                                are the one thing that moves during the hold
  //   TvSide `cashDelay`           the cash counts as the coins land
  //   <TvPayFx>                    NEW overlay child of the canvas
  // The fetch, the realtime subscription, boardAction, newGame, skipTurn,
  // hostGame and every payload are untouched.
  if (!uuid) {
    return (
      <RoomGate
        rootRef={rootRef}
        value={roomInput}
        onChange={setRoomInput}
        onOpen={() => setUuid(roomInput)}
        onHost={hostGame}
        hosting={hosting}
        hostError={hostError}
      />
    );
  }

  return (
    <div
      ref={rootRef}
      className={s.root}
      data-client=""
      style={{ "--tint": tint, "--on-tint": readableOn(tint) }}
    >
      <div
        className={s.screen}
        style={{ transform: `translate(-50%, -50%) scale(${scale})` }}
        role="region"
        aria-label="Shared game board"
      >
        <BoardGrid
          board={shownPos}
          players={shownPlayers ?? []}
          game={shownGame ?? {}}
          current={current}
          focusCellId={focusCellId}
          shown={shownTokens}
          roll={reveal.roll}
          roller={roller}
        />
        <TvSide
          roomId={uuid}
          board={shownPos}
          players={shownPlayers ?? []}
          game={shownGame ?? {}}
          current={current}
          controls={controls}
          error={boardError}
          cashDelay={cashDelay}
        />
        {/* The money layer: the transfer banner over the board centre and the
            coins crossing to the player cards. One absolutely positioned child
            of the canvas, so it can measure both ends in the same unscaled
            1920x1080 space, and `pointer-events: none` throughout. */}
        <TvPayFx
          items={payItems}
          token={reveal.releaseSeq}
          delay={payDelay}
          players={shownPlayers ?? []}
          board={shownPos}
          game={shownGame ?? {}}
        />
      </div>
    </div>
  );
}

export { Main };
export default Main;
