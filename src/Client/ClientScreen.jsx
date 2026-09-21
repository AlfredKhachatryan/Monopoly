// The phone screen — the "4D Split" controller.
//
// Two halves. The aura on top is what you read: a slim bar with your name, cash
// and whose turn it is, the space you are standing on as a large deed card, the
// one latest thing that happened, and a wash of that space's colour behind it
// all. The white panel at the bottom is what you press and nothing else: the dice
// and the one big action, and three panels behind a bottom nav.
//
// The turn flow is unchanged and still explicit: roll, see what happened, end
// the turn.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Trophy } from "lucide-react";

import { useGameRoom } from "../Hooks/useGameRoom";
import { useSound } from "../Hooks/useSound";
import ConnectionBadge from "../Components/ConnectionBadge";
import {
  accentFor,
  canBuild,
  cellKind,
  isProperty,
  nameOfFig,
  ownedBy,
  ownerOf,
  priceOf,
  readableOn,
  JAIL_FINE,
  JAIL_MAX_TURNS,
} from "../Hooks/rules";

import Aura from "./Aura";
import Ticket from "./Ticket";
import ActRow from "./ActRow";
import PayFx from "./PayFx";
import { useReveal, REVEAL } from "./useReveal";
import { announceBatch } from "./transfers";
import AuctionPanel from "./AuctionPanel";
import CasinoPanel from "./CasinoPanel";
import CasinoResult, { verdictAtMs } from "./CasinoResult";
import BottomNav from "./BottomNav";
import CardOverlay from "./CardOverlay";
import OfferOverlay from "./OfferOverlay";
import DiplomacyOverlay from "./DiplomacyOverlay";
import { fmt, jailLine } from "./format";
import { describeEvent } from "./EventView";
import MineSheet from "./sheets/MineSheet";
import PlayersSheet from "./sheets/PlayersSheet";
import GameSheet from "./sheets/GameSheet";
import TradeSheet from "./sheets/TradeSheet";
import { allyOf, isTraitorNow, warSides, warsOf } from "../Hooks/diplomacy";

import s from "./screen.module.css";

const DEBUG =
  import.meta.env.DEV || new URLSearchParams(window.location.search).has("debug");

function readPlayerInfo() {
  try {
    return JSON.parse(localStorage.getItem("playerInfo"));
  } catch {
    return null;
  }
}

// One sound per batch of events so a turn does not become a chord: the dice
// rattle at once, the consequence when the dice have landed.
const CUE_ORDER = ["win", "bankrupt", "jail", "buy", "build", "card", "moneyOut", "moneyIn", "land"];

// How long the cash count-up waits on a casino batch is no longer a constant
// here: it is verdictAtMs(game) from CasinoResult, the same function that times
// the verdict itself. The literal that used to live here (2550, sized for a
// 2400ms wheel) went stale when the wheel's spin grew to 5600ms, and the
// balance was quietly finishing its count three seconds before the wheel
// stopped. The casino frame is opaque, so nothing was spoiled — but the moment
// the frame closed, the number had long since settled instead of landing WITH
// the verdict, which is the whole point of holding it back.

// ---- the doubles run, as a beat -------------------------------------------
//
// Four kinds, escalating: "d1" the first double, "d2" the second, "d3" the
// third (which is a jailing), and "jail" for the two OTHER ways to end up
// inside — the Go To Jail cell and a card. "jail" is deliberately the quietest
// of the four: a busted run has to feel different from simply landing on a bad
// square, and the only way to buy that is to keep the ordinary one ordinary.
//
// How the stage is read. `game.doubles` is the server's own counter and it goes
// 0 -> 1 -> 2, but it NEVER reads 3: the batch that jails you for three doubles
// resets it to 0 in the same transaction, and its events are exactly
// ['roll','move','jail'] with reason 'doubles'. So the third is detected from
// that jail event, not from the counter — which is also why a phone that
// refetches mid-run cannot mistake a stale 2 for a bust.
//
// Every value here is under the 1.5s ceiling, and none of them gates a button:
// the primary is live again the moment the dice are down, whatever is still
// fading out on the tray.
const DICE_FX_MS = { d1: 900, d2: 1200, d3: 1500, jail: 1000 };

// Android only — iOS Safari has never implemented navigator.vibrate — and
// silenced along with the sound, because a phone buzzing in a pocket during a
// muted game is the same intrusion the mute was asked for.
const DICE_FX_VIBE = {
  d1: [16],
  d2: [26, 50, 26],
  d3: [60, 45, 60, 45, 180],
  jail: [30, 60, 30],
};

// Cue names handed to useSound. Unknown names are a documented no-op there, so
// these are safe to ship before the cues exist; see the report for the three I
// would like added.
const DICE_FX_CUE = { d1: "doubles", d2: "doublesHot", d3: "busted", jail: null };

// Browser chrome, for as long as the controller is on screen.
//
// index.html declares one dark theme-color because the Board and the Login page
// are dark pages. This one is not, so while it is mounted the meta takes the
// computed --ground of the client root (and follows a colour-scheme change),
// and <body> gets a class that paints it the same colour — otherwise an iOS
// overscroll bounce flashes main.css's dark purple under a white panel.
// Everything is put back on unmount.
function useClientChrome(rootRef) {
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;

    const head = document.head;
    const previous = Array.from(head.querySelectorAll('meta[name="theme-color"]')).map((node) => ({
      node,
      parent: node.parentNode,
      next: node.nextSibling,
    }));
    previous.forEach(({ node }) => node.remove());

    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    head.appendChild(meta);
    document.body.classList.add("client-active");

    const paint = () => {
      const ground = getComputedStyle(el).getPropertyValue("--ground").trim();
      if (ground) meta.setAttribute("content", ground);
    };
    paint();

    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    // one frame late, so the new token values have been applied
    const onScheme = () => requestAnimationFrame(paint);
    mq?.addEventListener?.("change", onScheme);

    return () => {
      mq?.removeEventListener?.("change", onScheme);
      meta.remove();
      previous.forEach(({ node, parent, next }) => parent?.insertBefore(node, next));
      document.body.classList.remove("client-active");
    };
  }, [rootRef]);
}

function cuesFor(events, meFig) {
  const found = new Set();
  for (const e of events) {
    const mine = e.figure === meFig;
    if (e.type === "roll" && mine) found.add("roll");
    else if (e.type === "collect" && mine) found.add("moneyIn");
    else if (e.type === "pay") {
      if (mine) found.add("moneyOut");
      else if (e.to === meFig) found.add("moneyIn");
    } else if (e.type === "card" && mine) found.add("card");
    else if (e.type === "buy" && mine) found.add("buy");
    // Winning an auction is a purchase and sounds like one. A bid, a drop and
    // somebody else's auction stay silent: an auction is four phones in a row,
    // and a cue per move would be a machine gun. The winner's `pay` is handled
    // by the branch above, so the money still lands.
    else if (e.type === "auction_won" && mine) found.add("buy");
    else if (e.type === "trade") {
      // An offer that needs MY answer is the one trade event worth a sound —
      // it is the only one that puts something on my screen to decide. A deal
      // that closed is money moving, so it takes the purchase cue.
      if ((e.status === "offered" || e.status === "countered") && e.to === meFig) found.add("card");
      else if (e.status === "accepted" && (mine || e.to === meFig)) found.add("buy");
    }
    else if (e.type === "build" && mine) found.add("build");
    else if (e.type === "jail" && mine) found.add("jail");
    else if (e.type === "bankrupt" && mine) found.add("bankrupt");
    else if (e.type === "win") found.add("win");
    else if (e.type === "land" && mine) found.add("land");
  }
  return { roll: found.has("roll"), main: CUE_ORDER.find((c) => found.has(c)) || null };
}

export function Client() {
  const playerId = readPlayerInfo()?.playerId;
  const uuid = localStorage.getItem("roomId");
  const navigate = useNavigate();
  const sound = useSound();

  const room = useGameRoom(uuid, playerId);
  const { loading, fetchError, busy, error, feed, run, conn, refetch } = room;

  // Only the two states that mean "your taps will not reach the server right
  // now" gate the UI — not "connecting" (the badge itself already swallows
  // that for the first 1.5s, and disabling every button the instant the page
  // loads would read as broken, not careful) and not a `conn` that is simply
  // undefined (older/mock room hooks that do not return one yet — the screen
  // must keep working exactly as it always did until they do).
  const disconnected = conn?.status === "reconnecting" || conn?.status === "offline";
  // Passed to every child that already takes `busy` to disable its own
  // buttons (the auction panel, the trade sheet, my-deeds' build button, the
  // game sheet's Leave) — reusing that existing wiring rather than teaching
  // each of them a second "disabled" reason.
  const busyOrDisconnected = busy || disconnected;

  // ---- the reveal buffer -------------------------------------------------
  // Everything below reads the game through `reveal.view`, which is the live
  // state EXCEPT while a roll is in the air — then it is the state the player
  // was already looking at, held until the dice come to rest. See useReveal.js
  // for the rules; nothing about which action is fired, or when, changes.
  const snapshot = useMemo(
    () => ({
      board: room.board,
      players: room.players,
      game: room.game,
      me: room.me,
      current: room.current,
      phase: room.phase,
      over: room.over,
      myTurn: room.myTurn,
      winner: room.winner,
      // The allied-pair win (SPEC-DIPLOMACY.md §1): one or two players, kept
      // alongside `winner` (still the first of them) rather than replacing
      // it, so nothing already reading the singular field below breaks.
      winners: room.winners,
      log: room.log,
    }),
    [
      room.board,
      room.players,
      room.game,
      room.me,
      room.current,
      room.phase,
      room.over,
      room.myTurn,
      room.winner,
      room.winners,
      room.log,
    ],
  );
  const reveal = useReveal(snapshot, feed, { meFig: room.me?.figure ?? null });
  const { board, players, game, me, current, phase, over, myTurn, winner, winners, log } = reveal.view;
  const rolling = reveal.rolling;

  const [sheet, setSheet] = useState(null);
  const [focusCard, setFocusCard] = useState(null);
  // What the trade sheet opens with: a prefill (from the Players sheet or from
  // Counter) and, when this is an answer to an offer, the offer being answered.
  const [tradeDraft, setTradeDraft] = useState(null);
  const [counterOf, setCounterOf] = useState(null);
  const [landedAt, setLandedAt] = useState(null);
  const [passed, setPassed] = useState(false);
  const [lastRoll, setLastRoll] = useState(null);
  const [deckCard, setDeckCard] = useState(null); // {kind, deck, text, amount}
  // A short-lived line in the aura for something that happened rather than
  // something that went wrong: an offer that no longer added up.
  const [notice, setNotice] = useState(null);
  // The one-shot beat on the dice tray: { id, kind }. See DICE_FX below.
  const [diceFx, setDiceFx] = useState(null);
  // The `<seq>#<n>` row the game sheet should open expanded, set by tapping a
  // row in the aura's preview. Null = open collapsed, which is every other way
  // in (the "Full log" button, the bottom nav).
  const [logFocus, setLogFocus] = useState(null);
  // The casino play being replayed over the screen: the server's own
  // `{type:'casino', stage:'result'}` event, held until CasinoResult has
  // finished landing the machine on it and dismissed itself. EVERY phone in
  // the room sets this, not only the one that bet — the spin and the swing are
  // the most interesting thing that happens all turn and the other five should
  // not be looking at a dead screen while it does.
  const [casinoFx, setCasinoFx] = useState(null);

  const seenFeed = useRef(0);
  const prevTurn = useRef(null);
  const cueTimer = useRef(null);
  const deckTimer = useRef(null);
  const noticeTimer = useRef(null);
  const fxSeq = useRef(0);
  const fxTimer = useRef(null);
  // The doubles counter as of the batch being reacted to. A ref, because the
  // effect that reads it is keyed on `reveal.feed` and must see the value from
  // the render that released that feed, not from whenever it last ran.
  const doublesRef = useRef(0);
  doublesRef.current = Number(game?.doubles) || 0;
  const rootRef = useRef(null);
  const stageRef = useRef(null);

  useClientChrome(rootRef);

  // The dice rattle at the START of the beat, where it belongs — the sound of
  // a throw, not of a result. `roll.mine` is true from the tap on my own phone
  // and false for everybody else's roll, which is exactly who used to hear it.
  const rollBeat = reveal.roll?.id ?? null;
  useEffect(() => {
    if (!rollBeat || !reveal.roll?.mine) return;
    sound.play("roll");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollBeat]);

  // ---- react to incoming events -----------------------------------------
  // `reveal.feed` is the same batch useGameRoom produced, handed over at the
  // moment the dice are down (immediately, for a batch with no roll in it). So
  // every line below fires in the same order it always did — just one beat
  // later, when there is something to look at.
  useEffect(() => {
    const feedNow = reveal.feed;
    if (!feedNow || feedNow.seq === seenFeed.current) return;
    seenFeed.current = feedNow.seq;
    const events = feedNow.events;
    if (events.length === 0) return;
    const mineFeed = feedNow.actor === playerId;

    const roll = events.find((e) => e.type === "roll");
    if (roll) {
      setLastRoll({ by: roll.figure, sum: roll.d1 + roll.d2, doubles: roll.doubles });
    }

    if (mineFeed) {
      const landed = [...events].reverse().find((e) => e.type === "land");
      if (landed) {
        setLandedAt(landed.cell);
        setPassed(false);
      }
      const card = events.find((e) => e.type === "card");
      if (card) {
        // The card face wants the amount it moved, and the server sends that as
        // its own collect/pay events in the same batch — plural. "Pay each
        // player 50$" is three pays, repairs is one pay with its own reason,
        // and "collect 10$ from every player" is other people paying me. Taking
        // only the first match showed −50$ for a −150$ card and nothing at all
        // for the other two, so everything the card moved is summed.
        let amount = 0;
        for (const e of events.slice(events.indexOf(card) + 1)) {
          if (e?.type === "card") break; // a second card in one batch is its own story
          const n = Number(e?.amount);
          if (!Number.isFinite(n)) continue;
          const byCard = e.reason === "card" || e.reason === "repairs";
          if (e.type === "collect" && e.figure === card.figure && byCard) amount += n;
          else if (e.type === "pay" && e.figure === card.figure && byCard) amount -= n;
          else if (e.type === "pay" && e.to === card.figure && e.reason === "card") amount += n;
        }
        if (!Number.isFinite(amount)) amount = 0;
        clearTimeout(deckTimer.current);
        // Flip the card once the dice are down AND the piece has arrived. This
        // used to be a flat 900ms from the moment the row landed, which was a
        // guess at "the dice are probably finished"; now the row itself only
        // arrives when they are, so the wait left is just the move.
        deckTimer.current = setTimeout(
          () =>
            setDeckCard({
              kind: card.deck === "chance" ? "Chance" : "Community Chest",
              deck: card.deck === "chance" ? "chance" : "chest",
              text: card.text,
              amount,
            }),
          roll ? REVEAL.CARD_MS : 0,
        );
      }
    }

    // ---- the casino, replayed -------------------------------------------
    // The server resolved the bet before this batch ever left it: the event
    // carries the reels / the pocket / the segment, the multiplier and the
    // payout. Nothing here rolls anything — it hands the finished result to
    // CasinoResult, which animates the machine INTO that answer and then takes
    // itself off the screen. `seq` is stamped on so the overlay can tell two
    // otherwise identical plays apart (same game, same bet, same outcome).
    //
    // Fired from the feed and only from the feed, exactly like the doubles
    // beat above: `reveal.feed` carries LIVE batches only, so a reload or a
    // silent resync never replays a spin for a bet that was settled minutes
    // ago. Everyone in the room gets it — there is no `mineFeed` guard.
    const casinoResult = events.find((e) => e.type === "casino" && e.stage === "result");
    if (casinoResult) setCasinoFx({ ...casinoResult, seq: feedNow.seq });

    // Free Parking paid out. The pot event only exists when there was money in
    // it (a pot of 0 emits nothing at all server-side), so this banner can
    // never say "you won nothing".
    const myPot = events.find((e) => e.type === "pot" && e.figure === me?.figure);
    if (myPot) {
      setNotice({ tone: "good", text: `Free Parking — you take the whole pot, ${fmt(myPot.amount)}` });
      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 5000);
    }

    // The farm paid its owner. Same shape, same reason: `amount` is 0 on a
    // `grow`, so only the harvest is worth a banner.
    const myHarvest = events.find(
      (e) => e.type === "farm" && e.stage === "harvest" && e.figure === me?.figure,
    );
    if (myHarvest && !myPot) {
      setNotice({
        tone: "good",
        text: `Harvest — the farm pays you ${fmt(myHarvest.amount)}`,
      });
      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 5000);
    }

    // Accepting an offer that no longer adds up is not an error — the server
    // takes the call, clears the offer and says why in an event. Without a word
    // on screen, pressing Accept would simply make the overlay vanish.
    const stale = events.find(
      (e) =>
        e.type === "trade" &&
        e.status === "expired" &&
        (e.figure === me?.figure || e.to === me?.figure),
    );
    if (stale) {
      // The server writes `reason` from the offerer's point of view ("They do
      // not have that much cash" makes sense to the one who asked for it, not
      // to the one who was asked). Only show it to `from`; `to` just learns
      // the offer is gone.
      const iAmFrom = stale.figure === me?.figure;
      setNotice({
        tone: "info",
        text:
          iAmFrom && stale.reason
            ? `That offer is no longer valid — ${stale.reason}`
            : "That offer is no longer valid",
      });
      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 5000);
    }

    // Being sent to jail always says why — by cell, by card, or by three
    // doubles in a row — as a banner on the main screen, not only as a line
    // in "Latest" that the next event can push out. `reason` values are the
    // server's own: "gtj" | "card" | "doubles" (see game_action's jail
    // event). The existing "jail" sound/haptic cue (cuesFor below) already
    // fires for all three; this is the words that go with it.
    const myJailing = events.find((e) => e.type === "jail" && e.figure === me?.figure);

    // ---- the doubles beat ------------------------------------------------
    // Fired here and nowhere else, which is what keeps it honest: `reveal.feed`
    // only ever carries LIVE batches (useGameRoom does not emit one for a first
    // load or a refetch), and `seenFeed` above already guarantees one pass per
    // seq. So a resync applies silently, a reload plays nothing, and a beat can
    // never be replayed for an event that already happened.
    //
    // Mine only. The copy is second-person ("roll again", "one more and it's
    // Jail") and the haptic is a tap on MY phone; somebody else's run is
    // reported by the heat pips and the log, which is the right volume for it.
    if (me?.figure) {
      const myRoll = roll && roll.figure === me.figure ? roll : null;
      let kind = null;
      if (myJailing?.reason === "doubles") kind = "d3";
      else if (myRoll?.doubles) kind = doublesRef.current >= 2 ? "d2" : "d1";
      else if (myJailing) kind = "jail";

      if (kind) {
        const id = (fxSeq.current += 1);
        setDiceFx({ id, kind });
        clearTimeout(fxTimer.current);
        fxTimer.current = setTimeout(() => setDiceFx(null), DICE_FX_MS[kind]);
        if (!sound.muted) {
          try {
            navigator.vibrate?.(DICE_FX_VIBE[kind]);
          } catch {
            /* a browser that declares vibrate and then refuses it */
          }
        }
        const cue = DICE_FX_CUE[kind];
        if (cue) sound.play(cue);
      }
    }

    if (myJailing) {
      const JAIL_SENT_TEXT = {
        gtj: "Sent to Jail",
        card: "A card sent you to Jail",
        doubles: "Busted — three doubles, go to Jail",
      };
      setNotice({
        tone: myJailing.reason === "doubles" ? "warn" : "info",
        text: JAIL_SENT_TEXT[myJailing.reason] || "Sent to Jail",
      });
      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), 5000);
    }

    // The roll cue has already played, at the start of the beat (the effect
    // above). What is left is the consequence, and its moment is NOW: the dice
    // are down, so the +950ms guess that used to stand in for "when they land"
    // is gone.
    const { main } = cuesFor(events, me?.figure);
    clearTimeout(cueTimer.current);
    if (main) sound.play(main);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal.feed, playerId, me?.figure, sound]);

  // ---- turn changes ------------------------------------------------------
  useEffect(() => {
    const now = current?.playerId ?? null;
    const before = prevTurn.current;
    prevTurn.current = now;
    if (before === null || now === before) return;
    if (now === playerId) sound.play("turn");
    if (before === playerId) {
      setLandedAt(null);
      setPassed(false);
    }
  }, [current?.playerId, playerId, sound]);

  useEffect(
    () => () => {
      clearTimeout(cueTimer.current);
      clearTimeout(fxTimer.current);
      clearTimeout(deckTimer.current);
      clearTimeout(noticeTimer.current);
    },
    [],
  );

  // ---- derived -----------------------------------------------------------

  // The server may send `auction: null`, omit the key entirely, or — for a room
  // written before the feature existed — send something half-shaped. Nothing
  // below may assume more than "an object with a cell".
  const auction = game?.auction ?? null;
  const auctionOn = phase === "auction" && !!auction && auction.cell != null;
  // The mandatory bet, read the same defensive way: `casino` may be null, may
  // be missing entirely (a room written before the rebalance), or may be half
  // shaped. `casinoOn` is the only thing anything below is allowed to test,
  // and it requires the phase AND the block AND the player it names — the
  // server itself falls back to phase 'act' when one is there without the
  // other, so the client must not render a panel it would then refuse.
  const casino = game?.casino ?? null;
  const casinoOn = phase === "casino" && !!casino && casino.figure != null;
  // The one phone that owes the house a bet. It gets a taller panel and, in
  // exchange, gives up the ticket — see the render.
  const myCasino = casinoOn && !!me && casino.figure === me.figure;
  // Every fine paid to the bank since the game started, waiting on cell 21.
  // A plain integer that is always present server-side; coerced anyway so a
  // pre-rebalance room shows 0 rather than NaN.
  const pot = Math.max(Math.round(Number(game?.pot) || 0), 0);
  const trade = game?.trade ?? null;
  const incomingOffer = !!trade && !!me && trade.to === me.figure ? trade : null;
  const outgoingOffer = !!trade && !!me && trade.from === me.figure ? trade : null;

  // ---- diplomacy: my own status, and anything waiting on my answer --------
  // Every derivation here goes through src/Hooks/diplomacy.js — the same
  // pure-function contract the Players sheet and the TV both read — so this
  // screen can never disagree with either of them about whether I am, right
  // now, allied / at war / a branded Traitor.
  const myAllyFig = me ? allyOf(game, me.figure) : null;
  const myWars = me ? warsOf(game, me.figure) : [];
  const myTraitorActive = me ? isTraitorNow(game, me) : false;

  // An alliance proposal addressed to me, or one I sent that is still
  // pending. `game.allyOffers` is an array (several players could each
  // propose to me before I answer any of them) — only the first is surfaced
  // as the blocking overlay below; the rest simply wait their turn, same as
  // a second trade offer would have to.
  const incomingAllyOffer = useMemo(() => {
    const offers = Array.isArray(game?.allyOffers) ? game.allyOffers : [];
    return (me && offers.find((o) => o?.to === me.figure)) || null;
  }, [game?.allyOffers, me]);
  const outgoingAllyOffer = useMemo(() => {
    const offers = Array.isArray(game?.allyOffers) ? game.allyOffers : [];
    return (me && offers.find((o) => o?.from === me.figure)) || null;
  }, [game?.allyOffers, me]);

  // A peace treaty the OTHER principal of one of my wars has put on the
  // table. Only principals ever see this — an ally dragged into the war has
  // nothing to answer, the two people who started it settle it.
  const incomingPeace = useMemo(() => {
    if (!me) return null;
    const wars = Array.isArray(game?.wars) ? game.wars : [];
    return (
      wars.find(
        (w) => w?.peace && w.peace.from !== me.figure && (w.declarer === me.figure || w.target === me.figure),
      ) || null
    );
  }, [game?.wars, me]);
  const outgoingPeace = useMemo(() => {
    if (!me) return null;
    const wars = Array.isArray(game?.wars) ? game.wars : [];
    return wars.find((w) => w?.peace && w.peace.from === me.figure) || null;
  }, [game?.wars, me]);

  // Peace is time-critical — double rent keeps running on every turn it sits
  // unanswered — so it is surfaced ahead of a fresh alliance proposal on the
  // rare occasion both are waiting on me at once.
  const diploOffer = incomingPeace
    ? { kind: "peace", war: incomingPeace }
    : incomingAllyOffer
      ? { kind: "ally", from: incomingAllyOffer.from }
      : null;

  // Compact status for the aura's second line (Aura.jsx's `diploStatus`): my
  // ally, my wars (opponent names for one, a count past that), my Traitor
  // brand. Built once here rather than inside Aura so the same derivation
  // this screen already did for `myAllyFig`/`myWars`/`myTraitorActive` is not
  // repeated.
  const diploStatus = useMemo(() => {
    if (!me) return [];
    const out = [];
    if (myAllyFig) out.push({ key: "ally", text: nameOfFig(players, myAllyFig) });
    if (myWars.length === 1) {
      const sides = warSides(game, myWars[0]);
      const mySide = sides.a.includes(me.figure) ? sides.a : sides.b;
      const opp = sides.a.includes(me.figure) ? sides.b : sides.a;
      out.push({
        key: "war",
        text: mySide.length > 1 ? `War · ${opp.map((f) => nameOfFig(players, f)).join(" & ")}` : `War · ${nameOfFig(players, opp[0])}`,
      });
    } else if (myWars.length > 1) {
      out.push({ key: "war", text: `${myWars.length} wars` });
    }
    if (me.traitor) {
      const left = Math.max((Number(me.traitorUntil) || 0) - (Number(game?.round) || 1), 0);
      out.push({ key: "traitor", text: myTraitorActive ? `Traitor · ${left}` : "Traitor" });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, myAllyFig, myWars, myTraitorActive, players, game?.round]);

  // If the offer I am answering goes away — cancelled, expired, or replaced by
  // a newer one — the half-written counter goes with it, rather than being sent
  // into a room that has moved on.
  useEffect(() => {
    if (!counterOf) return;
    if (trade && trade.id === counterOf.id) return;
    setCounterOf(null);
    setTradeDraft(null);
    setSheet((cur) => (cur === "trade" ? null : cur));
  }, [trade, counterOf]);

  // When it becomes MY move to bid, whatever was open — a sheet, a
  // half-written trade, the card overlay — has to get out of the way: the
  // auction panel lives inside the (possibly inert) stage, and is otherwise
  // unreachable. Transition-based on the deps below (auctionOn flipping on,
  // or `turn` landing on me), not a fight against reopening a sheet a moment
  // later while it is still my move.
  useEffect(() => {
    if (auctionOn && !!me && auction?.turn === me.figure) {
      closeTrade();
      setDeckCard(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auctionOn, auction?.turn, me?.figure]);

  // Same rule for the casino, and it is even less negotiable: while the house
  // is waiting the server refuses every other verb, so a sheet left open in
  // front of the panel is a screen full of buttons that can only bounce. The
  // panel lives inside the (possibly inert) stage and is otherwise
  // unreachable. Only for the player who owes the bet — the other five have
  // nothing to answer and keep whatever they had open.
  useEffect(() => {
    if (casinoOn && !!me && casino?.figure === me.figure) {
      closeTrade();
      setSheet(null);
      setDeckCard(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casinoOn, casino?.figure, me?.figure]);

  // An auction starting cancels any pending trade server-side — trading is
  // rejected outright while one runs. A trade sheet left open through that
  // transition (by the player who just passed, or anyone else composing one)
  // would go on drafting an offer that can only ever bounce. Only the trade
  // sheet: whoever else has Deeds/Players/Game open is untouched here — the
  // effect above is what clears the screen for the one player it is now the
  // move for.
  const prevAuctionOn = useRef(false);
  useEffect(() => {
    const was = prevAuctionOn.current;
    prevAuctionOn.current = auctionOn;
    if (!was && auctionOn && sheet === "trade") closeTrade();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auctionOn]);

  // An incoming offer is an alertdialog over the screen (see `showOffer`
  // below). A sheet sitting in front of it used to steal focus from behind an
  // invisible dialog; now that the overlay's z-index clears the sheets, this
  // just closes whatever non-trade sheet is in the way so the overlay is not
  // fighting a Tab trap underneath it. The trade sheet is left alone: it
  // steps aside on its own for THIS offer's own counter (`showOffer` below).
  const prevOfferId = useRef(null);
  useEffect(() => {
    const id = incomingOffer?.id ?? null;
    const was = prevOfferId.current;
    prevOfferId.current = id;
    if (id != null && id !== was && sheet && sheet !== "trade") setSheet(null);
  }, [incomingOffer?.id, sheet]);

  // Where I stand, and what the screen is about. They are the same thing except
  // during an auction, when the deed card and the tint both move to the
  // space being sold — every phone in the room is looking at that space, not at
  // whatever square its owner happens to be standing on.
  const standCell = board && me ? board[me.position] : null;
  const cell = (auctionOn ? (board?.[auction.cell] ?? null) : null) || standCell;
  const accent = accentFor(cell);
  const onAccent = readableOn(accent);

  // The tile tint also fills the primary button, and for three cell kinds
  // accentFor() answers the same neutral slate (#5f6b7a): Jail, Go To Jail and
  // Free Parking. So on those spaces a live "ROLL FOR DOUBLES" — the player's
  // own turn, the one thing on the screen to press — was painted grey, which is
  // the universal sign for "you cannot press this". It looked broken because
  // every other affordance on the phone says grey means off.
  //
  // The tile-tint idea survives; it just is not allowed to land on a neutral.
  // A neutral space borrows the deck indigo, which is a real colour, is nobody
  // else's group, and reads as ACTIVE. Everything paints from --cta now, and
  // --tint is left alone for the aura, the glow and the ticket, which are
  // descriptions of the space rather than invitations to press it.
  //
  // The other half of this is that a DISABLED button must not be able to look
  // like an active one: `.primary:disabled` is a flat --sunk plate with an
  // outline and no shadow, which no tint can produce.
  const CTA_NEUTRAL = "#5b55d6";
  const neutralTile = ["jail", "gtj", "parking"].includes(cellKind(cell));
  const cta = neutralTile ? CTA_NEUTRAL : accent;
  const onCta = readableOn(cta);
  const myProperty = useMemo(() => (me ? ownedBy(board, me.figure) : []), [board, me]);
  const ctx = useMemo(() => ({ players, board, meFig: me?.figure }), [players, board, me?.figure]);

  // May the Build pill on the ticket be pressed, for THE SPACE THE TICKET IS
  // SHOWING?
  //
  // This used to ask `canBuildAny` — do I own a finished colour set ANYWHERE —
  // which is why a Build button turned up on Free Parking, on Jail, and on a
  // street whose owner was "Free". The pill is attached to a space; it has to
  // mean something about that space. So: it must be a street, I must own it, I
  // must hold its whole colour set, and it must be this street's turn to take
  // the next house (canBuild enforces the even-build rule). Money is left out
  // on purpose — `Infinity` — because the pill opens the deeds sheet and that
  // is where affordability is decided and explained; being 20$ short is not a
  // reason to make the button vanish.
  //
  // Every other cell kind falls out of this for free: parking, jail, gtj, tax,
  // chance, chest, start, railroads and utilities are not streets, so they can
  // never show it. During an auction the ticket is showing the space being
  // sold, not mine, and the caller suppresses it there too.
  const buildHere = useMemo(() => {
    if (!me || !cell || cellKind(cell) !== "street") return false;
    if (ownerOf(cell) !== me.figure) return false;
    return canBuild(board, me.figure, cell.id, Infinity).ok;
  }, [board, me, cell]);

  // The three newest describable events, newest first. `key` is the index in
  // the log, which only ever grows, so it doubles as "how new is this".
  //
  // `logKey` is a different thing and is NOT interchangeable with it: it is the
  // `<seq>#<n>` identity GameSheet gives the same event, so tapping a preview
  // row can open the full log already expanded on it. It has to be built the
  // same way there and here — the action's seq plus the event's index within
  // that action — which is why `n` counts back to the start of the seq run
  // rather than using the position in the log.
  const recent = useMemo(() => {
    const out = [];
    for (let i = log.length - 1; i >= 0 && out.length < 3; i--) {
      if (!describeEvent(log[i], ctx)) continue;
      let n = 0;
      for (let j = i - 1; j >= 0 && log[j].seq === log[i].seq; j--) n++;
      out.push({ ev: log[i], key: i, logKey: `${log[i].seq ?? "e"}#${n}` });
    }
    return out;
  }, [log, ctx]);

  // Rows past the high-water mark animate in, and stay past it for as long as
  // the animation runs.
  //
  // This used to be a ref read during render while an effect in the same commit
  // advanced it: the very next re-render — setDice and setLastRoll guarantee
  // one — stripped the flag about a frame into a 240ms animation. The mark is
  // state now, and only moves 400ms after the rows arrive. `seeded` keeps the
  // first log the screen ever sees from animating: a refresh is not news.
  const [seen, setSeen] = useState({ top: -1, seeded: false });
  useEffect(() => {
    const top = log.length - 1;
    if (top < 0) return undefined;
    if (!seen.seeded) {
      setSeen({ top, seeded: true });
      return undefined;
    }
    if (top <= seen.top) return undefined;
    const t = setTimeout(() => setSeen({ top, seeded: true }), 400);
    return () => clearTimeout(t);
  }, [log.length, seen]);
  const freshAfter = seen.seeded ? seen.top : Infinity;

  // What the last card said, for the ticket note on a Chance / Chest space.
  const lastCardText = useMemo(() => {
    for (let i = log.length - 1; i >= 0; i--) if (log[i].type === "card") return log[i].text;
    return null;
  }, [log]);

  // The idle dice — shown resting whenever nobody's roll is in the air —
  // used to fall back to a hard-coded [1, 1] whenever `game.dice` itself was
  // empty. That reads as a real roll of double ones on a phone that was not
  // there for the last actual roll (a fresh load, a phone that just woke up),
  // while the TV in the same room — which keeps whatever it last drew from
  // the log — correctly still showed the true last roll. The log is the same
  // ground truth `describeEvent`'s "roll" case already reads, so the phone
  // can fall back to it too before ever reaching for a fake default.
  const lastRolledDice = useMemo(() => {
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.type === "roll") return [e.d1, e.d2];
    }
    return null;
  }, [log]);

  // The buy / build decision is about the space I am STANDING on, so it reads
  // standCell — `cell` is the auctioned space while an auction runs, and an
  // auction offers no choice of its own anyway.
  //
  // WHAT "I JUST LANDED HERE" IS ALLOWED TO BE READ FROM. This used to be
  // `landedAt` and nothing else — a piece of React state set from the live
  // `land` event and from no other source. Live events are exactly what a
  // phone does not get back after a reload: useGameRoom emits a feed only for
  // updates that arrive over the socket, never for the first fetch or a
  // resync (see `apply(..., { silent: true })` there). So a phone that was
  // reloaded — locked and discarded by iOS, tab restored, the room link
  // opened again, a crash — came back with `landedAt` null, and a player
  // standing mid-turn on a free space was shown "End turn" and nothing else.
  // The space could not be bought at all that turn, and the phone gave no
  // reason. That is the "I cannot buy this" report.
  //
  // The durable fact is in the row itself: phase "act" means this player has
  // rolled this turn and is standing where the roll left them — nothing moves
  // a token during "act". So that is the condition, and the server agrees
  // with it (game_action's `buy` takes any cell you stand on and nobody
  // owns). `landedAt` stays as the second way in, for the debug jump, which
  // resolves a landing without changing the phase.
  const landedHere = landedAt != null && me?.position === landedAt;

  // "I already declined this space" has to survive the same reload, or the
  // offer would come BACK after an auction that found no bidder — the one
  // case `passed` exists for. `passed` answers it inside a session; the log
  // answers it across a reload. Scan back from the newest entry: an
  // `auction_none` for the space I am standing on, with no later landing of
  // mine on it, means the offer is spent. (An auction somebody WON needs no
  // entry here — the space has an owner now, and ownerOf sees that.)
  const declinedHere = useMemo(() => {
    if (!me || me.position == null) return false;
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.type === "land" && e.figure === me.figure && e.cell === me.position) return false;
      if (e.type === "auction_none" && e.cell === me.position) return true;
    }
    return false;
  }, [log, me]);

  const choice = (() => {
    if (auctionOn) return null;
    // Nothing can be bought or built while the house is waiting — the server
    // answers "The casino is waiting" to both. Standing on cell 13 already
    // rules it out (the Casino is not ownable, so isProperty says no), but
    // this is stated rather than inferred: the buy/build offer is driven by
    // the PHASE now as much as by the cell, and an offer the server would
    // refuse must never reach a button.
    if (casinoOn) return null;
    if (!myTurn || passed || declinedHere || !standCell || !me) return null;
    if (phase !== "act" && !landedHere) return null;
    if (!isProperty(standCell)) return null;
    const owner = ownerOf(standCell);
    if (!owner) return { kind: "buy", price: priceOf(standCell) };
    if (owner === me.figure) {
      const b = canBuild(board, me.figure, standCell.id, me.money);
      if (b.ok) return { kind: "build", ...b };
    }
    return null;
  })();

  // ---- actions -----------------------------------------------------------
  // `startRoll` is presentation only: it opens the reveal buffer and puts the
  // dice in the air on the TAP, so the throw does not wait for the round trip.
  // The action, its payload and its conditions are exactly what they were; a
  // refusal calls failLocalRoll(), which settles the dice back onto the faces
  // they were showing and hands the untouched state straight back.
  async function startRoll() {
    reveal.beginLocalRoll();
    const res = await run("roll");
    if (res?.error) reveal.failLocalRoll();
    return res;
  }

  async function rollAgain() {
    reveal.beginLocalRoll();
    const res = await run("end_turn");
    if (res.error) {
      reveal.failLocalRoll();
      return;
    }
    const next = await run("roll");
    if (next?.error) reveal.failLocalRoll();
  }

  async function leave() {
    await run("leave");
    try {
      localStorage.removeItem("playerInfo");
      localStorage.removeItem("boughtCards");
    } catch {
      /* ignore */
    }
    navigate("/Login");
  }

  function openHand(cellId) {
    setFocusCard(cellId ?? null);
    setSheet("mine");
  }

  // Passing on a property now puts it up for auction. `passed` is set only once
  // the server has taken it, and it matters afterwards: when nobody bids, the
  // space is still unowned and I am still standing on it, and without this the
  // buy/auction choice would reappear for the space I just declined.
  async function startAuction(cellId) {
    const res = await run("auction_start", { cell: cellId });
    if (!res?.error) setPassed(true);
    return res;
  }

  function openTrade({ draft = null, counter = null } = {}) {
    setTradeDraft(draft);
    setCounterOf(counter);
    setSheet("trade");
  }

  function closeTrade() {
    setSheet(null);
    setTradeDraft(null);
    setCounterOf(null);
  }

  // A counter is the mirror of the offer I am looking at: what they asked me
  // for is what I now give, and what they put up is what I now get.
  function counterOffer() {
    if (!incomingOffer) return;
    openTrade({
      draft: {
        to: incomingOffer.from,
        give: incomingOffer.get ?? { cells: [], cash: 0 },
        get: incomingOffer.give ?? { cells: [], cash: 0 },
      },
      counter: incomingOffer,
    });
  }

  // Thin run() wrappers, nothing else: TradeSheet is the one that decides
  // whether to close, once it has seen whether the call came back with an
  // error, so closing here too would either double-close on success or (worse)
  // close over a rejection that left the composition worth keeping.
  async function sendTrade({ to, give, get }) {
    return run("trade_offer", { to, give, get });
  }

  async function sendCounter({ give, get }) {
    return run("trade_counter", { give, get });
  }

  // ---- what just moved ---------------------------------------------------
  // Derived during render from the released batch, not kept in state: the
  // money layer and the cash count-up have to know their timing in the SAME
  // commit the new balance arrives in, and a state update set from an effect
  // would always be one render late (a child's effects run before its
  // parent's, so <Money> would read the previous batch's delay).
  const payItems = useMemo(
    () => announceBatch(reveal.feed?.events ?? [], me?.figure ?? null),
    [reveal.feed, me?.figure],
  );
  const payRolled = !!reveal.feed?.events?.some((e) => e?.type === "roll");
  // The piece hops first, then the money speaks. A batch that did not come out
  // of a roll has nothing to wait for.
  const payDelay = payRolled ? REVEAL.PIECE_MS : 60;
  const myMoneyMoved = payItems.some((a) => a.involvesMe);
  // A casino play is the one batch whose money must NOT speak first. The whole
  // point of the reels is that nobody knows the answer until they stop, and a
  // cash number that has already counted up to the win has answered it. So on
  // a batch carrying a `casino` result the count-up waits for the machine
  // instead of for the piece — for everyone at the table, because the losing
  // bet leaves the same way for a spectator reading somebody else's swing.
  const casinoResult = reveal.feed?.events?.find(
    (e) => e?.type === "casino" && e.stage === "result",
  );
  const payCasino = !!casinoResult;
  const cashDelay = myMoneyMoved
    ? payCasino
      ? verdictAtMs(casinoResult.game)
      : payDelay + 260
    : 0;

  // ---- caption -----------------------------------------------------------
  const caption = lastRoll
    ? {
        text:
          lastRoll.by === me?.figure
            ? `You rolled ${lastRoll.sum}${lastRoll.doubles ? " · doubles" : ""}`
            : `${players.find((p) => p.figure === lastRoll.by)?.name ?? "Someone"} rolled ${lastRoll.sum}`,
        big: lastRoll.by === me?.figure,
      }
    : null;

  // ---- buttons -----------------------------------------------------------
  // Same conditions, same calls as before; only the shape of the descriptor
  // changed, so the button can put the verb and the amount on one baseline and
  // a hint line underneath.
  let primary = null;
  let secondary = [];

  if (loading) primary = { verb: "Loading", disabled: true, waiting: true };
  else if (!me)
    primary = { verb: "Waiting", hint: "You are not in this room", disabled: true, waiting: true };
  else if (over) primary = null;
  else if (me.bankrupt)
    primary = { verb: "Out", hint: "You are out of the game", disabled: true, waiting: true };
  else if (!myTurn)
    primary = {
      verb: "Waiting",
      hint: current
        ? rolling
          ? `${current.name} is rolling…`
          : `${current.name} is playing`
        : "Waiting for the table",
      disabled: true,
      waiting: true,
    };
  else if (phase === "roll" && me.inJail) {
    primary = {
      verb: rolling ? "Rolling" : "Roll for doubles",
      onClick: startRoll,
      disabled: busy || rolling,
      rolling,
    };
    secondary = [
      {
        key: "pay_jail",
        verb: "Pay",
        amount: fmt(JAIL_FINE),
        // Same "say why, don't just grey it out" rule Buy already follows.
        hint: me.money < JAIL_FINE ? "Not enough cash" : undefined,
        onClick: () => run("pay_jail"),
        disabled: busy || rolling || me.money < JAIL_FINE,
      },
      // Only offered when there is one to use — a disabled "Use jail card"
      // nobody can ever press would just be a dead button forever.
      ...(me.jailCards > 0
        ? [
            {
              key: "use_jail_card",
              verb: "Use jail card",
              onClick: () => run("use_jail_card"),
              disabled: busy || rolling,
            },
          ]
        : []),
    ];
  } else if (phase === "roll")
    primary = {
      verb: rolling ? "Rolling" : "Roll",
      hint: rolling ? undefined : "Roll the dice",
      onClick: startRoll,
      disabled: busy || rolling,
      rolling,
    };
  else if (game.doubles > 0)
    primary = {
      verb: rolling ? "Rolling" : "Roll again",
      onClick: rollAgain,
      disabled: busy || rolling,
      rolling,
    };
  else
    primary = {
      verb: "End turn",
      hint: caption?.text,
      onClick: () => run("end_turn"),
      disabled: busy || rolling,
    };

  if (choice?.kind === "buy") {
    secondary = [
      {
        key: "buy",
        verb: "Buy",
        amount: fmt(choice.price),
        // Same comparison the disabled flag below already makes — said out
        // loud, because a greyed-out price with no reason reads as a bug.
        hint: me.money < choice.price ? "Not enough cash" : undefined,
        onClick: () => run("buy", { cell: standCell.id }),
        disabled: busy || rolling || me.money < choice.price,
        accent: true,
      },
      // The same call under two labels: "Pass" when buying was a real option
      // and I am giving it up, "Auction" when it was not and this is the only
      // way the space can still change hands.
      {
        key: "pass",
        verb: me.money < choice.price ? "Auction" : "Pass",
        onClick: () => startAuction(standCell.id),
        disabled: busy || rolling,
      },
    ];
  } else if (choice?.kind === "build") {
    secondary = [
      {
        key: "build",
        verb: choice.hotel ? "Hotel" : "House",
        amount: fmt(choice.price),
        onClick: () => run("build", { cell: standCell.id }),
        disabled: busy || rolling,
        accent: true,
      },
      { key: "not_now", verb: "Not now", onClick: () => setPassed(true), disabled: busy || rolling },
    ];
  }

  // A button that still LOOKS pressable while the socket is down is worse
  // than one that is honestly greyed out — every action above is a server
  // call, and none of them can go anywhere right now. `over`/no-`me` states
  // build their own already-disabled `primary` and are left alone: "The game
  // is over" outranks "Reconnecting…" as an explanation.
  if (disconnected && me && !over) {
    if (primary && !primary.disabled) {
      primary = { ...primary, disabled: true, hint: "Reconnecting…" };
    }
    secondary = secondary.map((b) =>
      b.disabled ? b : { ...b, disabled: true, hint: b.hint || "Reconnecting…" },
    );
  }

  // ---- banner ------------------------------------------------------------
  let banner = null;
  if (me && !over) {
    if (me.bankrupt) banner = { text: "You are bankrupt. Watching the rest play out." };
    else if (myTurn && phase === "roll" && me.inJail) {
      // jailTurns is 0..2 failed rolls already served, so the attempt about
      // to be made is jailTurns + 1 of JAIL_MAX_TURNS (3) — and the LAST of
      // those (jailTurns already 2) is the one where a non-double takes the
      // fine and moves you regardless, which is worth saying plainly rather
      // than leaving "3 of 3" to speak for itself.
      banner = { text: jailLine(me, { full: true, fine: JAIL_FINE, max: JAIL_MAX_TURNS }) };
    }
    // "You roll again" is true but not yet: during an auction the roll is on
    // the other side of it, and the panel below is the only thing to answer.
    // Progressive by the server's own `game.doubles` counter: the first
    // double is a light "you again"; the second gets the warning colour
    // because one more roll like this is a trip to Jail (see the "doubles"
    // reason on the `jail` event, and the busted notice below it).
    // The same is true at the casino, and more so: the roll is on the far side
    // of a bet the player cannot decline, so "roll again" would be the screen
    // promising something the server will refuse until the bet is settled.
    else if (myTurn && !auctionOn && !casinoOn && game.doubles === 1)
      banner = { accent: true, text: "Doubles — roll again" };
    else if (myTurn && !auctionOn && !casinoOn && game.doubles >= 2)
      banner = { warn: true, text: "Doubles again — one more and it's Jail" };
  }

  const banners = [];
  if (error || fetchError)
    banners.push({
      key: "err",
      tone: "err",
      text: error || `Could not reach the game: ${fetchError}`,
    });
  if (banner)
    banners.push({
      key: banner.text,
      tone: banner.warn ? "warn" : banner.accent ? "good" : "info",
      text: banner.text,
    });
  // Neutral by default — nothing failed, an offer simply stopped adding up —
  // except a busted-by-doubles jailing, which sets its own "warn" tone above.
  if (notice) banners.push({ key: "notice", tone: notice.tone || "info", text: notice.text });
  // My own offer is the one thing that can sit on the table with nothing on my
  // screen to press, so it says so — and carries the one move it leaves me.
  if (outgoingOffer)
    banners.push({
      key: `trade-${outgoingOffer.id ?? "pending"}`,
      tone: "info",
      text: `Waiting for ${nameOfFig(players, outgoingOffer.to)} to answer your offer`,
      action: {
        text: "Cancel",
        label: `Cancel your offer to ${nameOfFig(players, outgoingOffer.to)}`,
        onClick: () => run("trade_cancel"),
        disabled: busy,
      },
    });
  // My own alliance proposal, sitting on the table exactly the way an
  // outgoing trade does — cancellable (ally_cancel is in the verb table), so
  // it gets the same banner shape.
  if (outgoingAllyOffer)
    banners.push({
      key: `ally-${outgoingAllyOffer.to}`,
      tone: "info",
      text: `Waiting for ${nameOfFig(players, outgoingAllyOffer.to)} to answer your alliance offer`,
      action: {
        text: "Cancel",
        label: `Cancel your alliance offer to ${nameOfFig(players, outgoingAllyOffer.to)}`,
        onClick: () => run("ally_cancel", { to: outgoingAllyOffer.to }),
        disabled: busy,
      },
    });
  // My own peace offer. No `peace_cancel` exists in the verb table (see
  // SPEC-DIPLOMACY.md) — a principal who changes their mind simply waits it
  // out or lets the other side decline — so this banner has no action.
  if (outgoingPeace) {
    const otherPrincipal =
      outgoingPeace.declarer === me?.figure ? outgoingPeace.target : outgoingPeace.declarer;
    banners.push({
      key: `peace-${outgoingPeace.id}`,
      tone: "info",
      text: `Waiting for ${nameOfFig(players, otherPrincipal)} to answer your peace offer`,
    });
  }

  // ---- layout decisions --------------------------------------------------
  // A buy / build decision takes over the act row, exactly as in the prototype.
  // The turn's own action keeps a button of its own in the outlined row above,
  // so nothing that can be pressed today becomes unreachable.
  const decideMode = choice?.kind === "buy" || choice?.kind === "build";
  const actPrimary = decideMode ? secondary[0] : primary;
  const actPass = decideMode ? secondary[1] : null;
  const alts = decideMode ? (primary ? [{ ...primary, key: "turn", hint: undefined }] : []) : secondary;

  // No "card": nothing styles [data-state="card"], and leaving it in made the
  // act row change size behind the overlay for no visible reason. "auction" is
  // styled by nothing either, and that is the point: none of the act row's
  // per-state type sizes should reach into the auction panel.
  const state = auctionOn
    ? "auction"
    : casinoOn
      ? "casino"
      : decideMode
        ? "decide"
        : primary?.waiting
          ? "waiting"
          : rolling || busy
            ? "rolling"
            : myTurn && phase === "roll"
              ? "roll"
              : "end";

  // On game over the headline in the aura already says who won; a second
  // "You win" in the turn slot was the same sentence twice. During an auction
  // whose turn it is stops being the point — the panel says who is to bid.
  const turnLabel = auctionOn
    ? "Auction"
    : casinoOn
      ? "Casino"
      : myTurn
        ? "Your turn"
        : current
          ? `${current.name}'s turn`
          : "Waiting";

  // May I put an offer on the table right now, and if not, why not? The sheet
  // shows the reason instead of a dead Send button. Answering an offer is
  // always allowed, so a counter ignores all of this (`counterOf`).
  //
  // `busy` is deliberately NOT part of this: it only decides whether the
  // composer or the explanation shows, and busy is a mid-flight blip, not a
  // reason a trade cannot be proposed — folding it in here made the sheet
  // flash "One moment…" whenever it happened to open while busy was still
  // true from the previous action. Send is disabled by `busy` directly.
  const canPropose =
    !!me &&
    !me.bankrupt &&
    !over &&
    myTurn &&
    !auctionOn &&
    // `phase === 'roll' || 'act'` already excludes 'casino', but the flag is
    // spelled out so the reason below has something to key off.
    !casinoOn &&
    !trade &&
    (phase === "roll" || phase === "act");
  let whyNot = null;
  if (!canPropose) {
    if (!me) whyNot = "You are not in this room";
    else if (over) whyNot = "The game is over";
    else if (me.bankrupt) whyNot = "You are out of the game";
    else if (auctionOn) whyNot = "An auction is running";
    // The server's own wording, so the sheet and a rejected call say the
    // same thing.
    else if (casinoOn) whyNot = "The casino is waiting";
    else if (outgoingOffer)
      whyNot = `Waiting for ${nameOfFig(players, outgoingOffer.to)} to answer`;
    else if (incomingOffer)
      whyNot = `Answer ${nameOfFig(players, incomingOffer.from)}'s offer first`;
    else if (trade) whyNot = "Another offer is on the table";
    else if (!myTurn) whyNot = "You can propose a trade on your turn";
    else whyNot = "One moment…";
  }

  // Richest first, everyone who went bankrupt after everyone who did not.
  const standings = useMemo(
    () =>
      over
        ? [...players].sort((a, b) =>
            !!a.bankrupt === !!b.bankrupt ? (b.money ?? 0) - (a.money ?? 0) : a.bankrupt ? 1 : -1,
          )
        : [],
    [over, players],
  );

  // The trophy line and the closing sentence, in one place: an allied pair
  // wins TOGETHER (SPEC-DIPLOMACY.md §1, `winners` — see useGameRoom.js),
  // which needs its own wording ("You and Ero win together") rather than the
  // singular `winner.name`. `winners` is [] until the game actually ends, so
  // this falls back to the single-winner phrasing (and then to "Game over")
  // exactly as before for every room that never formed an alliance.
  const iWon = (winners || []).some((p) => p.figure === me?.figure);
  const winTitle =
    winners && winners.length > 1
      ? iWon
        ? `You and ${winners.find((p) => p.figure !== me?.figure)?.name ?? "your ally"} win together!`
        : `${winners.map((p) => p.name).join(" and ")} win together`
      : winner
        ? winner.figure === me?.figure
          ? "You win!"
          : `${winner.name} wins`
        : "Game over";

  // Tab and a screen reader must not walk into the screen underneath an open
  // sheet or the card overlay.
  //
  // The two directions run in different phases on purpose, because setting
  // `inert` blurs whatever is inside it:
  //   ON  — a passive effect, which runs after the child dialog's own passive
  //         effect has recorded the element that opened it. Set it any earlier
  //         and the dialog records <body> and has nothing to give focus back to.
  //   OFF — a layout effect, which runs before passive cleanups, so the
  //         dialog's cleanup finds that element focusable again.
  // (React 18 does not know the `inert` attribute, hence the ref.)
  // The incoming offer is an alertdialog over the screen, exactly like the card
  // overlay, so it blocks the screen underneath the same way. The card wins
  // when both are up: it is the older news, it is already being read, and it
  // dismisses with one tap.
  // It also steps aside for its own Counter: the trade sheet opened from it is
  // the answer being written, and two dialogs about the same offer is one too
  // many. Close the sheet without sending and the offer is there again.
  // The casino replay is the third alertdialog, and it slots into the same
  // pecking order: the card is the oldest news and wins, then the spin (which
  // dismisses itself within a few seconds), then an offer, which will still be
  // there afterwards because nothing about it expires on a timer.
  const showCasinoFx = casinoFx != null && deckCard == null;
  const showOffer =
    !!incomingOffer && deckCard == null && !showCasinoFx && !(sheet === "trade" && counterOf);
  // A diplomacy proposal (alliance or peace) is the fourth alertdialog and
  // ranks just behind a trade offer: both are "someone needs my answer"
  // overlays reachable off-turn, and only one of the two can plausibly be
  // pending at once in practice, so losing a tie to the trade offer (the
  // older feature) costs nothing real.
  const showDiplomacyOffer = !!diploOffer && deckCard == null && !showCasinoFx && !showOffer;
  const blocked = sheet != null || deckCard != null || showOffer || showCasinoFx || showDiplomacyOffer;
  useLayoutEffect(() => {
    if (!blocked) stageRef.current?.removeAttribute("inert");
  }, [blocked]);
  useEffect(() => {
    if (blocked) stageRef.current?.setAttribute("inert", "");
  }, [blocked]);

  // Everything above this line that is not the game:
  //   useClientChrome()      browser theme-color + <body> class, view only
  //   deckCard `amount`      summed over the card's own money events
  //   `seen` / `freshAfter`  the row-entry animation's high-water mark
  //   `hint` on Buy          "Not enough cash", from the same comparison
  //   `state`                no "card" value (nothing styled it)
  //   `standings`            display order for the end-of-game panel
  //   `blocked` + inert      focus containment while a sheet/overlay is open
  //
  // And everything the auction and the trading added (2026-09-18):
  //   `auction` / `auctionOn`  game.auction, tolerated null / missing / partial
  //   `trade` + in/outgoing    game.trade, split by which side of it I am on
  //   `tradeDraft`/`counterOf` what the trade sheet opens with, plus an effect
  //                            that drops a counter whose offer has gone away
  //   startAuction / openTrade / closeTrade / counterOffer / sendTrade /
  //   sendCounter              the new run() wrappers, all of them thin
  //   `standCell` vs `cell`    the deed card and the tint move to the
  //                            auctioned space while an auction runs; `choice`,
  //                            Buy and Build keep reading the space I stand on
  //   `choice`                 returns null during an auction
  //   Pass                     now run("auction_start"), and `passed` is set
  //                            only after the server takes it; the label reads
  //                            "Auction" when Buy is unaffordable
  //   `primary` / `alts`       computed as before but NOT rendered during an
  //                            auction: the panel is the only move on offer
  //   `state`                  new "auction" value (styled by nothing)
  //   `turnLabel`              reads "Auction" during one
  //   doubles banner           suppressed during an auction (the roll is after)
  //   outgoing-offer banner    "Waiting for X to answer your offer" + Cancel
  //   `notice`                 a 5s neutral banner for the `trade` event with
  //                            status "expired": the server accepts that call
  //                            and reports it as news, never as an error
  //   `canPropose` / `whyNot`  for the trade sheet
  //   `showOffer` + `blocked`  the incoming offer blocks the screen like the
  //                            card overlay, and the card is shown first
  //   cuesFor()                auction_won → buy, an offer to me → card, a
  //                            closed deal → buy; no existing mapping changed
  //   Ticket `canBuild`        and MineSheet `busy`: no build while an auction
  //                            runs, because the server would reject it
  //
  // And everything the roll beat and the money layer added (2026-09-18) —
  // ALL of it presentation. No action, payload or ordering of calls changed:
  //   `room` + `snapshot`      useGameRoom's returns, gathered into one object
  //   `reveal` = useReveal()   the presentation buffer (useReveal.js). Every
  //                            game value below now comes from `reveal.view`,
  //                            which is the live state except while a roll is
  //                            in the air, when it is the state already on
  //                            screen. `busy` / `error` / `fetchError` /
  //                            `loading` / `run` still come straight from the
  //                            hook — they are not game state.
  //   `rolling`                reveal.rolling: the 1.5s beat is running
  //   roll-cue effect          NEW: plays `roll` once, at the START of the
  //                            beat, for the same player who heard it before
  //                            (roll.mine). The cue itself is unchanged.
  //   feed effect              now keyed on `reveal.feed` — the SAME batch,
  //                            handed over when the dice are down (instantly
  //                            for a batch with no roll). `setDice` is gone
  //                            (the dice are driven by reveal.roll);
  //                            `lastRoll`, `landedAt`, `passed`, `deckCard`,
  //                            `notice` are set exactly as before.
  //   card delay               900ms -> REVEAL.CARD_MS (450) measured from the
  //                            release instead of from the row's arrival
  //   consequence cue          +950ms -> the release moment
  //   startRoll()              NEW wrapper: reveal.beginLocalRoll() then the
  //                            same run("roll"); a refusal calls
  //                            reveal.failLocalRoll(), which settles the dice
  //                            back and releases the untouched state
  //   rollAgain()              same two calls in the same order, with the beat
  //                            opened at the tap
  //   `disabled`               every action gains `|| rolling` — today's
  //                            busy/rolling semantics, so nobody can act on a
  //                            state they have not been shown yet
  //   primary.verb/.rolling    "Rolling" + ellipsis + edge sweep for the beat;
  //                            the waiting hint reads "X is rolling…"
  //   `state`                  "rolling" while the beat runs, not only on busy
  //   `payItems` / `payRolled` / `payDelay` / `myMoneyMoved` / `cashDelay`
  //                            the money layer's choreography, derived during
  //                            render from the released batch
  //   Aura `payFx`/`cashDelay` the transfer toast, and the cash count-up held
  //                            until the coins would land
  //   ActRow                   takes `dice` (the values), `roll` and a size
  // The turn effect, every other run()/setPassed/navigate/sound.play and every
  // other `disabled` condition are untouched.
  //
  // And everything the Casino, the Weed Farm and the Free Parking pot added
  // (2026-09-20 — supabase/migrations/20260920170000_casino_farm_rebalance.sql):
  //   `casino` / `casinoOn`    game.casino, tolerated null / missing / partial,
  //                            paired with the server's new phase 'casino'
  //   `pot`                    game.pot, a plain integer, coerced for a room
  //                            written before it existed
  //   CasinoPanel              takes the act row exactly as AuctionPanel does,
  //                            for EVERY phone; one verb, casino_play, and no
  //                            decline — landing there is mandatory
  //   `casinoFx` + CasinoResult the server's own result event, replayed over
  //                            the screen on every phone. It ANIMATES INTO the
  //                            answer that already arrived; nothing local ever
  //                            decides an outcome. Set from `reveal.feed`, so
  //                            a reload or a silent resync never replays a spin
  //   `showCasinoFx`/`blocked` the third alertdialog, ranked behind the card
  //                            and ahead of an incoming offer
  //   `cashDelay`              holds the aura's count-up for the whole spin on
  //                            a casino batch, so the number cannot spoil it
  //   `choice` / `canBuild` / MineSheet `busy` / `canPropose`
  //                            all refuse while the house is waiting, with the
  //                            server's own wording where one is shown
  //   doubles banner           suppressed during a casino bet, same as during
  //                            an auction
  //   `state` / `turnLabel`    new "casino" value; the aura reads "Casino"
  //   pot / harvest notices    a 5s "good" banner when Free Parking or the
  //                            farm pays ME; neither can fire on a zero, the
  //                            server emits nothing in that case
  //   Aura `pot` / Ticket `pot` the standing pot in the aura and, on cell 21,
  //                            on the ticket itself
  if (!uuid || !playerId) return <Navigate to="/Login" replace />;

  return (
    <div
      ref={rootRef}
      className={s.screen}
      data-client=""
      style={{ "--tint": accent, "--on-tint": onAccent, "--cta": cta, "--on-cta": onCta }}
      onPointerDown={sound.unlock}
    >
      <div className={s.app} data-state={state} data-mine={myTurn ? "" : undefined}>
        {/* Floats over the top-right corner of the WHOLE screen, outside the
            aura's own `overflow: hidden` — a sibling of .stage, not a child,
            so it is never made `inert` along with the rest of the screen and
            never fights the aura's clipping. Positioned well clear of the
            panel/roll button at the floor of the screen. Renders nothing
            while the connection is fine (see the component itself). */}
        <ConnectionBadge conn={conn} variant="phone" className={s.connBadge} />
        {/* Everything readable and pressable, in one block that can be made
            inert. The overlay and the sheets are siblings of it, not children,
            so they stay reachable while it is switched off. */}
        <div ref={stageRef} className={s.stage}>
          <Aura
            me={me}
            players={players}
            current={current}
            winner={winner}
            turnLabel={over || loading ? null : turnLabel}
            placeholder="Not in this room"
            loading={loading}
            banners={banners}
            events={recent.map((r) => ({ ...r, fresh: r.key > freshAfter }))}
            ctx={ctx}
            onOpenLog={(logKey) => {
              setLogFocus(typeof logKey === "string" ? logKey : null);
              setSheet("game");
            }}
            cashDelay={cashDelay}
            pot={pot}
            diploStatus={diploStatus}
            /* The deed card, in the aura's flexible row. It steps aside for
               the one player who is betting, and for nobody else. The space it
               would describe is cell 13, and the casino panel below is the
               same description with the odds and the slider attached — two
               headers for one space, on the one screen that has the least room
               for them (the panel is ~312px against the act row's ~130).
               Everyone else keeps their card: it is showing the space THEY are
               standing on, which the panel says nothing about.

               During an auction `cell` is the space being SOLD, not the one
               under this player's token, and the label says so on the card's
               band. The path strip that used to refocus on that space is gone
               (see the panel below); the card is now the only thing that has
               to make the switch, and it is big enough to make it plainly. */
            card={
              !myCasino ? (
                <Ticket
                  cell={cell}
                  board={board}
                  players={players}
                  me={me}
                  game={game}
                  canBuild={buildHere && !auctionOn && !casinoOn}
                  onBuild={() => openHand(cell && ownerOf(cell) === me?.figure ? cell.id : null)}
                  lastCard={lastCardText}
                  /* Free Parking's headline is the live pot, so the card
                     needs the number. Every other space ignores it. */
                  pot={pot}
                  label={auctionOn ? "Up for auction" : undefined}
                />
              ) : null
            }
            payFx={
              <PayFx
                items={payItems}
                token={reveal.releaseSeq}
                delay={payDelay}
                /* The card, an incoming offer and the casino replay own the
                   screen while they are up; the toast waits its turn rather
                   than arguing with them. */
                blocked={deckCard != null || showOffer || showCasinoFx}
                players={players}
                meFig={me?.figure ?? null}
                vibrate={!sound.muted}
              />
            }
          >
            {over ? (
              <div className={s.over}>
                <Trophy size={44} color="var(--tint)" />
                <div className={s.overTitle}>{winTitle}</div>
              </div>
            ) : loading ? (
              /* Two children on purpose: the aura has a flexible row and a
                 bottom row, and these take one each — a card-shaped
                 placeholder where the card is about to be, and the words where
                 the latest line is about to be. */
              <>
                <span className={`${s.skel} ${s.skelTicket}`} aria-hidden="true" />
                <p className={s.loading}>Loading the game…</p>
              </>
            ) : null}
          </Aura>

          <section className={s.panel} aria-label="Your move">
            {/* Buttons only. The panel used to open with the path strip (seven
                dots: three spaces behind you, you, three ahead) and the ticket
                for the space you stand on. The strip is gone — what is NEAR you
                turned out to matter far less than what you are ON, and it was
                paid for with the height the ticket needed — and the ticket is
                now the deed card up in the aura. What is left is what you can
                press, so the panel is as short as the move on offer and the
                aura takes every pixel it gives back. (While the room loads
                that is the act row's own disabled "Loading" button, so the
                two placeholders that stood here for the strip and the ticket
                have nothing left to stand for; the card's is in the aura.) */}

            {/* The panel was a sliver above the nav once the game ended. It now
                carries the closing words and the table, from data already here —
                and no new move: the game is over. */}
            {over && (
              <div className={s.finals}>
                <p className={s.finalsBody}>
                  {iWon
                    ? winners.length > 1
                      ? "You and your ally are the last ones standing. Well played."
                      : "Everyone else went bankrupt. Well played."
                    : "Start another one from the board screen."}
                </p>
                <div>
                  <div className={s.finalsHead}>Final standings</div>
                  <ol className={s.finalsList}>
                    {standings.map((p, i) => (
                      <li key={p.playerId}>
                        <span className={s.finalsRank}>{i + 1}</span>
                        <span
                          className={`${s.finalsName} ${p.bankrupt ? s.finalsOut : ""}`}
                        >
                          {p.name}
                          {p.figure === me?.figure ? " (you)" : ""}
                        </span>
                        <span className={s.finalsMoney}>
                          {p.bankrupt ? "Out" : fmt(p.money ?? 0)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}

            {/* An auction takes the act row's place entirely — the dice, the
                turn's own action and the alternatives above it all go away,
                because until the auction resolves there is no other move in
                the room. Everyone sees it, not only the player whose turn it
                was. */}
            {auctionOn ? (
              <AuctionPanel
                auction={auction}
                board={board}
                players={players}
                me={me}
                busy={busyOrDisconnected}
                onBid={(amount) => run("auction_bid", { amount })}
                onDrop={() => run("auction_drop")}
              />
            ) : casinoOn ? (
              /* The casino takes the act row exactly the way an auction does,
                 and for the same reason: until the bet is settled the server
                 refuses every other verb, so there is no other move in the
                 room to offer. Everyone sees it — the player to place the bet,
                 and the other five as a statement of what is happening. There
                 is no decline: landing here is mandatory. */
              <CasinoPanel
                casino={casino}
                players={players}
                me={me}
                busy={busyOrDisconnected}
                onPlay={(payload) => run("casino_play", payload)}
              />
            ) : (
              (actPrimary || actPass) && (
                <ActRow
                  dice={game.dice ?? lastRolledDice ?? [1, 1]}
                  roll={reveal.roll}
                  fx={diceFx}
                  doubles={game.doubles || 0}
                  diceSize={decideMode ? 30 : 36}
                  diceLabel={caption?.text}
                  primary={actPrimary}
                  pass={actPass}
                  alts={alts}
                />
              )
            )}

            {/* Nothing behind the nav exists yet while the room is loading —
                that is how it was before the redesign. */}
            {!loading && (
              <BottomNav
                onOpen={(which) =>
                  which === "mine" ? openHand(null) : which === "trade" ? openTrade() : setSheet(which)
                }
                deeds={myProperty.length}
                playerCount={players.length}
              />
            )}
          </section>
        </div>

        <CardOverlay card={deckCard} onClose={() => setDeckCard(null)} />

        {/* The spin, on every phone in the room. It animates the result the
            server already returned and dismisses itself; `onClose` is the tap
            / Escape / auto-dismiss, and it is the only thing that clears it.
            Mounted unconditionally and handed a null event when there is
            nothing to show — exactly like CardOverlay above — because the exit
            animation lives inside its own AnimatePresence and unmounting the
            component would cut it off mid-fade. */}
        <CasinoResult
          event={showCasinoFx ? casinoFx : null}
          players={players}
          meFig={me?.figure ?? null}
          onClose={() => setCasinoFx(null)}
        />

        {/* An offer waits; a card does not. Both are alertdialogs, so only one
            of them may be up at a time. */}
        {showOffer && (
          <OfferOverlay
            trade={incomingOffer}
            board={board}
            players={players}
            me={me}
            busy={busyOrDisconnected}
            onAccept={() => run("trade_accept")}
            onDecline={() => run("trade_decline")}
            onCounter={counterOffer}
          />
        )}

        {/* An alliance proposed to me, or a peace treaty from the other
            principal of one of my wars — dealt the same way an incoming trade
            is, and reachable off-turn for the same reason (ally_accept/decline
            and peace_accept/decline are all "any time" verbs). */}
        {showDiplomacyOffer && (
          <DiplomacyOverlay
            offer={diploOffer}
            players={players}
            me={me}
            busy={busyOrDisconnected}
            onAccept={() =>
              diploOffer.kind === "ally"
                ? run("ally_accept", { from: diploOffer.from })
                : run("peace_accept", { warId: diploOffer.war.id })
            }
            onDecline={() =>
              diploOffer.kind === "ally"
                ? run("ally_decline", { from: diploOffer.from })
                : run("peace_decline", { warId: diploOffer.war.id })
            }
          />
        )}

        <MineSheet
          open={sheet === "mine"}
          onClose={() => setSheet(null)}
          board={board}
          me={me}
          players={players}
          focus={focusCard}
          /* No building while an auction runs, and none while the casino is
             waiting: the server rejects both, so the button must not be live
             either. */
          busy={busyOrDisconnected || auctionOn || casinoOn}
          onBuild={(id) => run("build", { cell: id })}
        />
        <PlayersSheet
          open={sheet === "players"}
          onClose={() => setSheet(null)}
          board={board}
          players={players}
          current={current}
          winner={winner}
          winners={winners}
          meFig={me?.figure}
          /* The pill hands back a figure; the trade sheet opens with that
             player already chosen. Whether an offer is allowed at all is the
             sheet's business (canPropose / whyNot), not the pill's. */
          onTrade={over || !me || me.bankrupt ? undefined : (fig) => openTrade({ draft: { to: fig } })}
          me={me}
          game={game}
          myTurn={myTurn}
          phase={phase}
          busy={busyOrDisconnected}
          /* Same "over or not seated or already out" gate as onTrade above —
             a read-only roster in every one of those states, same as before
             diplomacy existed. */
          onDiplomacy={over || !me || me.bankrupt ? undefined : (verb, payload) => run(verb, payload)}
        />
        <TradeSheet
          open={sheet === "trade"}
          onClose={closeTrade}
          board={board}
          players={players}
          me={me}
          canPropose={canPropose}
          whyNot={whyNot}
          draft={tradeDraft}
          counterOf={counterOf}
          busy={busyOrDisconnected}
          onSend={sendTrade}
          onCounter={sendCounter}
        />
        <GameSheet
          open={sheet === "game"}
          onClose={() => setSheet(null)}
          focusKey={logFocus}
          log={log}
          ctx={ctx}
          roomId={uuid}
          muted={sound.muted}
          onToggleSound={() => sound.setMuted((v) => !v)}
          onLeave={leave}
          // `conn.reconnect()` tears the channel down and rebuilds it (then
          // refetches) — the real fix for a socket that only LOOKS alive.
          // `refetch` alone is the fallback for wherever `conn` is not there
          // yet (an older room hook, the mock harness).
          onRefresh={() => (conn?.reconnect ? conn.reconnect() : refetch())}
          debug={DEBUG}
          board={board}
          busy={busyOrDisconnected}
          onJump={(id) => run("move", { to: id })}
        />
      </div>
    </div>
  );
}

export default Client;
