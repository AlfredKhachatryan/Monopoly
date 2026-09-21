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
import ConnectionBadge from "../Components/ConnectionBadge";
import ThemeControl from "../Components/ThemeControl";
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
    seqRef.current = -1; // a different room, so the old room's seq means nothing
    setUuid(newUuid);
  }

  const [pos, setPos] = useState(initialState());
  const [userData, setUserData] = useState(null);
  const [currentOrder, setCurrentOrder] = useState(null);
  const [game, setGame] = useState({});
  // `refetch` is what repairs the screen after a drop; it goes to
  // useRealtimeUpdates below, which calls it on every resync trigger
  // (resubscribe, tab visible, pageshow, online, focus, heartbeat).
  const { data, loading, refetch } = useFetch(uuid);

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
  // ---- resync -------------------------------------------------------------
  // A row that arrives because the TV asked for it again is NOT news. It is the
  // present, and the TV may well have missed three turns getting to it. So a
  // refetched row is applied SILENTLY: `silentSeq` marks the seq that arrived
  // that way, useTvFeed is told not to announce it (so no card, no dice, no
  // doubles chip, no jail beat, no coins, no "fresh" event rows), and the
  // pieces snap to where everybody now is instead of flying a route nobody
  // took. Whatever happened while the screen was deaf happened; the board's job
  // on coming back is to be correct, not to perform.
  const [silentSeq, setSilentSeq] = useState(-1);
  const [snapKey, setSnapKey] = useState(0);
  const liveSeq = Number(game?.seq) || 0;
  const silent = silentSeq >= 0 && liveSeq === silentSeq;

  const tvFeed = useTvFeed(game, silent);
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

  // `game.seq` is monotonic across every action, new_game included, so it is
  // the one honest answer to "is this row older than what I already have?". A
  // resync and a Realtime push can cross on the wire — the refetch was sent
  // before the push arrived and lands after it — and without this the board
  // would visibly step backwards a turn. Equal seqs are allowed through: the
  // same row read twice writes the same thing.
  const seqRef = useRef(-1);

  function updatePos(pos, user, order, g, fromResync = false) {
    const next = Number(g?.seq) || 0;
    if (next < seqRef.current) return;
    seqRef.current = next;
    if (pos) {
      setPos(pos);
    }
    setUserData(user);
    setCurrentOrder(order);
    setGame(g || {});
    // Both of these are set in the same batch as `setGame`, so the flag and the
    // row it describes reach the render together.
    setSilentSeq(fromResync ? next : -1);
    if (fromResync) setSnapKey((k) => k + 1);
  }

  // The first read of a room is a resync by the same argument: nothing on it
  // just happened, the TV is only catching up with a room that already exists.
  // (useTvFeed adopts its first seq silently anyway; this makes it explicit and
  // covers the refetches that follow.)
  useEffect(() => {
    if (data) {
      updatePos(data.position, data.Players, data.current_order, data.game, true);
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

  // …and what it hands back is the connection's own state: "live" almost
  // always, "reconnecting" while the channel is being rebuilt, "offline" when
  // it has given up. <ConnectionBadge> draws nothing at all unless it is one of
  // the last two, so the room only ever hears about the network when the
  // network is the reason nothing is happening. Written defensively — the
  // offline harness's mock returns nothing at all, and a board on a wall must
  // not go blank over a missing status object.
  const conn = useRealtimeUpdates(uuid, handleInserts, refetch); //when DB is updated he does some function
  const connection = useMemo(
    () =>
      uuid && conn?.status
        ? { status: conn.status, since: conn.since, reconnect: conn.reconnect }
        : undefined,
    [uuid, conn?.status, conn?.since, conn?.reconnect],
  );

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
      /* The board reads the [data-client] token vocabulary like the phone does,
         but it is not the phone: it is a shared screen across a room, so it is
         PINNED dark rather than following the operating system. Everything that
         makes that true lives in the [data-tv] block in styles/tokens.css — the
         palette, the color-scheme and the one selector that still lets the
         ThemeControl below force light. This attribute is the whole hook. */
      data-tv=""
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
          /* Bumped on a resync: the pieces are put where they are now rather
             than flown there, because nobody in the room watched them move. */
          snapKey={snapKey}
          roll={reveal.roll}
          roller={roller}
          /* This render's `shownGame` may carry a seq that just moved (a
             resync snaps straight through, see the note above `silentSeq`)
             without it being NEWS — TvCenter keeps its own useTvFeed to time
             its card/jail/trade beats, and without this flag it has no way to
             tell "just caught up" from "just happened" and replays a card for
             something that happened while the screen was deaf. */
          silent={silent}
        />
        <TvSide
          roomId={uuid}
          board={shownPos}
          players={shownPlayers ?? []}
          game={shownGame ?? {}}
          current={current}
          controls={controls}
          /* Same reason as BoardGrid's: TvSide's own useTvFeed only marks a
             row "fresh" (the slide-in) for a batch that arrived live. */
          silent={silent}
          /* Beside the room code: the one place on this screen that already
             talks about the connection rather than about the game. Renders
             nothing while the room is live. */
          badge={<ConnectionBadge conn={connection} variant="tv" />}
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
      {/* Light / Dark / System for the room (spec §10). A sibling of .screen,
          not a child of it: the canvas is a fixed 1920x1080 box under a scale
          transform, so anything inside it shrinks with the board on a small
          window, and every square of it is already spoken for by the grid or
          the right column. Out here it keeps its real size at any scale and
          sits in the letterbox, faded back until somebody reaches for it.
          It shares the store and the localStorage key with the phone's control
          — the same browser, so a TV that is also somebody's phone agrees with
          itself — but the TV and the phones are different browsers and each
          answers this question for itself. */}
      <ThemeControl variant="tv" label="Board theme" />
    </div>
  );
}

export { Main };
export default Main;
