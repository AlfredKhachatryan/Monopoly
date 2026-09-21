// The middle of the board: the two decks, whose turn it is, the dice — and the
// one overlay that is allowed to cover them.
//
// Mounted by the shell inside the board grid (grid-area 2 / 2 / 11 / 11), so
// the root fills its cell and takes the centre glow from --tint.
//
// PROPS (contract with the shell): board players game current focusCellId
// roll roller silent
//
// ---------------------------------------------------------------------------
// Live vs refresh
// ---------------------------------------------------------------------------
// Nothing transient is ever driven by the state itself — not by `game.lastCard`
// and not by `game.dice`. Both survive a refresh, and a board that deals a card
// for something that happened three turns ago is worse than one that deals
// none. The trigger is `useTvFeed` (TvFeed.js): it adopts the first `game` it
// sees without a sound and only reports a batch once `game.seq` moves past it.
// So a card flies, a die tumbles and a panel lingers exactly when the room
// actually did something while this screen was watching.
//
// ---------------------------------------------------------------------------
// Overlay priority: game over > auction > diplomacy > card > trade
// ---------------------------------------------------------------------------
// One at a time, never two. A finished game outranks everything; a running
// auction outranks everything else because the auction is what the room is
// waiting on; a diplomacy moment (a war declared, a peace signed, an alliance
// forming or breaking, a backstab) outranks a card because it is the rarer
// and heavier of the two — and unlike a card it is never behind a roll (every
// diplomacy verb is its own turn action, so there is no dice tumble to wait
// out); a card outranks a trade because it is the shorter of the two.

import { useEffect, useRef, useState } from "react";
import { Dices, Gift, Handshake, Sparkles, Trophy } from "lucide-react";
import { JAIL_MAX_TURNS, accentFor, nameOfFig, playerByFig, readableOn } from "../Hooks/rules";
import { TRAITOR_ROUNDS, WAR_ROUNDS } from "../Hooks/diplomacy";
import { fmt, fmtSigned, fmtText } from "../Client/format";
import { hasCyrillic } from "../Client/boardDisplay";
import Tok from "../Client/Tok";
import RollDice from "../Client/RollDice";
import { REVEAL } from "../Client/useReveal";
import TvAuction from "./TvAuction";
import TvDiplo from "./TvDiplo";
import TvFigure from "./TvFigure";
import TvTrade from "./TvTrade";
import { useTvFeed, useTvReduce } from "./TvFeed";
import c from "./tvCenter.module.css";

const CARD_MS = 4500;
const TRADE_END_MS = 2800;
const TRADE_DONE = ["accepted", "declined", "cancelled", "expired"];
// Diplomacy moments carry two names (and, for a war, up to four), so they get
// a beat longer than a card's 4.5s to actually be read from a sofa.
const DIPLO_MS = 5500;

// Why an alliance dissolved without anyone choosing it (spec §1's three
// forced-dissolve reasons) — `ally break` (the voluntary kind) already says
// who ended it, in a full sentence, at the point it fires.
const DISSOLVE_REASON = {
  upkeep: "could not pay the round's upkeep",
  bankrupt: "a player went bankrupt",
  left: "a player left the game",
};
// A war can also just run its 5 rounds out with nobody asking for peace.
const WAR_END_REASON = { bankrupt: "a principal went bankrupt" };

// ---------------------------------------------------------------------------
// Doubles, and the wall at the end of them
// ---------------------------------------------------------------------------
// The server's contract (supabase/migrations, confirmed 2026-09-20):
//
//   game.doubles          consecutive doubles by the player whose turn it is.
//                         1 after the first, 2 after the second, and back to
//                         0 after the third, because the third does not earn
//                         another roll — it earns a cell in jail.
//   jail event            { type: 'jail', figure, reason: 'doubles'|'gtj'|'card' }
//
// So stage three is NOT readable from the counter: at the moment it matters the
// counter already says nothing happened. It is read from the `jail` event, and
// only the event, which is also what makes the beat land at the right time —
// events arrive in the released batch, one beat after the dice are down.
//
// The three stages are deliberately different in kind, not just in wording:
//   1  a light, positive chip: you got something
//   2  the same chip in the warning colours, and it breathes: you are exposed
//   3  the chip goes solid, the dice shake, and the piece flies to Jail on its
//      own (the server moved it, TvTokens arcs it there like any other move —
//      nothing teleports)
const BUST_MS = 3400; // how long the jail beat holds the centre's words
const JAIL_REASON = {
  doubles: "Third double in a row",
  gtj: "Sent straight there",
  card: "The card says so",
};

// What the card moved, summed over the card's own money events.
//
// The same rule the phone uses (ClientScreen.jsx), replicated here rather than
// imported because it lives inside that file's feed effect: the server sends a
// card's money as separate collect/pay events in the same batch, PLURAL — "pay
// each player 50$" is three pays, repairs is one pay with its own reason, and
// "collect 10$ from every player" is other people paying the drawer. Taking
// only the first match shows −50$ for a −150$ card.
function cardAmount(events, card) {
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
  return Number.isFinite(amount) ? amount : 0;
}

// "Koli is in jail · 2 turns left" — the same sentence the player card tells,
// because a player who cannot move is the reason the room is waiting.
function jailSub(p) {
  const served = Math.min(Math.max(Math.round(Number(p.jailTurns)) || 0, 0), JAIL_MAX_TURNS);
  const left = JAIL_MAX_TURNS - served;
  const cards = Math.round(Number(p.jailCards)) || 0;
  const tail = cards > 0 ? " · holds a get-out card" : left <= 1 ? " · last turn" : ` · ${left} turns left`;
  return `${p.name} is in jail${tail}`;
}

function TvCard({ card, players }) {
  const drew = playerByFig(players, card.figure);
  const who = drew?.name ?? "Somebody";
  const verdict = card.amount > 0 ? "Collected" : card.amount < 0 ? "Paid" : "—";
  return (
    <div className={c.gcard} data-deck={card.deck}>
      <div className={c.gcHead}>
        {card.deck === "chance" ? <Sparkles size={36} /> : <Gift size={36} />}
        {card.kind}
      </div>
      <div className={c.gcBody}>
        <p className={c.gcText} lang={hasCyrillic(card.text) ? "ru" : undefined}>
          {fmtText(card.text)}
        </p>
        {card.amount ? (
          <span className={`${c.gcAmt} ${card.amount > 0 ? c.pos : c.neg}`}>
            {fmtSigned(card.amount)}
          </span>
        ) : null}
      </div>
      <div className={c.gcFoot}>
        {drew && <Tok player={drew} size={40} />}
        <span className={c.gcWho}>{who} drew a card</span>
        <span className={c.gcVerdict}>{verdict}</span>
      </div>
    </div>
  );
}

// Shared win (spec §1): the game is over when every non-bankrupt player is
// one player or one allied PAIR, so `game.winners` may carry one figure or
// two. `game.winner` — the existing single-winner field — stays populated
// with the first of them for backward compatibility, so it is only the
// fallback here, never the primary read.
function winnersOf(game) {
  if (Array.isArray(game?.winners) && game.winners.length > 0) return game.winners;
  return game?.winner ? [game.winner] : [];
}

function TvOver({ players, game }) {
  const winners = winnersOf(game);
  const winnerPlayers = winners.map((fig) => playerByFig(players, fig)).filter(Boolean);
  const shared = winnerPlayers.length >= 2;
  // Standings: everyone still in, richest first; the bankrupt sit below them in
  // the order they went out (their money is 0 and says nothing).
  const standings = [...(players || [])].sort(
    (a, b) =>
      (a.bankrupt ? 1 : 0) - (b.bankrupt ? 1 : 0) ||
      (Number(b.money) || 0) - (Number(a.money) || 0) ||
      (Number(a.order) || 0) - (Number(b.order) || 0),
  );

  // Six standings rows at the full size do not fit the board centre; from five
  // up the panel tightens its rows and trims the figure. See .over[data-many].
  const many = standings.length >= 5;
  const title = shared
    ? `${winnerPlayers.map((p) => p.name).join(" & ")} win`
    : winnerPlayers[0]
      ? `${winnerPlayers[0].name} wins`
      : "Nobody left";

  return (
    <div className={c.over} data-many={many ? "" : undefined}>
      <div className={c.overHead}>
        {/* The one hero moment on this board, so a winner gets the full
            figure rather than a token — and keeps the art's own ground shadow,
            which is what makes it stand on the panel instead of float over
            it. A shared win is two figures at once, so each gives up some of
            the single winner's height to still fit the 700px panel. */}
        {shared ? (
          <span className={c.overFigPair}>
            <TvFigure player={winnerPlayers[0]} height={many ? 110 : 130} shadow />
            <Handshake size={28} className={c.overFigLink} aria-hidden="true" />
            <TvFigure player={winnerPlayers[1]} height={many ? 110 : 130} shadow />
          </span>
        ) : (
          winnerPlayers[0] && (
            <span className={c.overFig}>
              <TvFigure player={winnerPlayers[0]} height={many ? 150 : 180} shadow />
            </span>
          )
        )}
        <div className={c.overWho}>
          <span className={c.overCup}>
            <Trophy size={44} aria-hidden="true" />
          </span>
          <strong className={c.overTitle}>{title}</strong>
        </div>
      </div>
      <span className={c.overSub}>Final standings</span>
      <ol className={c.overList}>
        {standings.map((p, i) => (
          <li
            key={p.playerId ?? p.figure ?? i}
            className={`${c.overRow} ${p.bankrupt ? c.isOut : ""} ${
              winners.includes(p.figure) ? c.isWin : ""
            }`}
          >
            <span className={c.overRank}>{i + 1}</span>
            <Tok player={p} size={many ? 38 : 44} />
            <span className={c.overName}>{p.name}</span>
            <span className={c.overMoney}>{p.bankrupt ? "Out" : fmt(p.money)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function TvCenter({
  board,
  players,
  game,
  current,
  focusCellId,
  // The live roll beat, straight from the shell's reveal buffer. `game` here is
  // the HELD row, so its seq — and therefore everything below that keys off
  // `feed` — only moves once the dice are down.
  roll = null,
  roller = null,
  // From the shell (BoardScreen.jsx): true while `game` carries a resync's
  // seq. `game` here already snaps straight through on a resync (there is no
  // roll to hold it behind), so without this flag a reconnect that jumped the
  // seq forward would read as a brand new card/jail/trade beat for something
  // that happened while the screen was disconnected. See TvFeed.js.
  silent = false,
}) {
  const feed = useTvFeed(game, silent);
  const reduce = useTvReduce();

  const [card, setCard] = useState(null);
  const [tradeEnd, setTradeEnd] = useState(null);
  const [everRolled, setEverRolled] = useState(false);
  // { fig, reason } for as long as the going-to-jail beat owns the centre.
  const [bust, setBust] = useState(null);
  // { kind, title, sub, chip, tone, left, right } for as long as a war/
  // alliance/backstab moment owns the centre. See TvDiplo.jsx for the shape.
  const [diplo, setDiplo] = useState(null);
  const cardTimer = useRef(null);
  const tradeTimer = useRef(null);
  const bustTimer = useRef(null);
  const diploTimer = useRef(null);
  // A war's declare event carries its own sides (sideA/sideB) straight from
  // the spec, so the banner needs no lookup there — but the SPEC says the
  // server deletes an ended war from `game.wars` in the same action that ends
  // it (diplomacy.js's header comment), so by the time a `peace` or `expire`/
  // `end` event arrives the war it is about is already gone from the state
  // this component reads. Remembered here instead, keyed by the war's id, for
  // exactly as long as the war is live in THIS session — a peace/expiry on a
  // war declared before the TV loaded (or before a refresh) still shows the
  // banner, just without the two sides, rather than reading a stale cache.
  const warCache = useRef({});

  // One effect per batch. Whatever was transient is dropped first — "the next
  // action" is precisely what ends a card, and a stale "Deal accepted" sitting
  // over the next player's roll would be a lie.
  useEffect(() => {
    if (!feed) return;
    const events = Array.isArray(feed.events) ? feed.events : [];
    clearTimeout(cardTimer.current);
    clearTimeout(tradeTimer.current);
    clearTimeout(bustTimer.current);
    clearTimeout(diploTimer.current);
    setCard(null);
    setTradeEnd(null);
    setBust(null);
    setDiplo(null);

    const rolled = events.some((e) => e?.type === "roll");
    if (rolled) setEverRolled(true);

    // Going to jail, however it happened. No delay: this batch only arrives at
    // the moment the reveal buffer lets the new state through, which is the
    // same moment the piece starts its flight to the Jail corner. Waiting even
    // a beat here would put "Afo is in jail" on the screen BEFORE "Busted",
    // which tells the story backwards.
    const jailed = events.find((e) => e?.type === "jail");
    if (jailed) {
      setBust({ fig: jailed.figure, reason: jailed.reason || "gtj" });
      bustTimer.current = setTimeout(() => setBust(null), BUST_MS);
    }

    const drawn = events.find((e) => e?.type === "card");
    if (drawn) {
      const show = () => {
        setCard({
          deck: drawn.deck === "chance" ? "chance" : "chest",
          kind: drawn.deck === "chance" ? "Chance" : "Community Chest",
          text: drawn.text,
          figure: drawn.figure,
          amount: cardAmount(events, drawn),
        });
        cardTimer.current = setTimeout(() => setCard(null), CARD_MS);
      };
      // The card is drawn in the same batch as the roll that landed on the
      // deck — and this batch only arrives once the dice are already down, so
      // the 900ms that used to stand in for "the tumble is probably over" is
      // now just the time the piece needs to reach its tile.
      if (rolled) cardTimer.current = setTimeout(show, REVEAL.CARD_MS);
      else show();
    }

    const done = [...events]
      .reverse()
      .find((e) => e?.type === "trade" && TRADE_DONE.includes(e.status));
    if (done) {
      setTradeEnd({
        status: done.status,
        trade: {
          from: done.figure,
          to: done.to,
          give: done.give,
          get: done.get,
          counter: false,
        },
      });
      tradeTimer.current = setTimeout(() => setTradeEnd(null), TRADE_END_MS);
    }

    // Diplomacy moments (spec §4 of the brief). None of these ever share a
    // batch with a roll — every verb here is its own turn action ("own turn",
    // "any time"), never bundled with `roll` the way a card is — so there is
    // no dice tumble to wait out and the banner shows the instant the batch
    // does, exactly like the jail beat above. At most one fires per batch in
    // practice (one game_action, one set of events), so the order below is
    // only a tie-break, picked rarest/heaviest first.
    const warDeclare = events.find((e) => e?.type === "war" && e?.stage === "declare");
    const warPeace = events.find((e) => e?.type === "war" && e?.stage === "peace");
    const warEnd = events.find(
      (e) => e?.type === "war" && (e?.stage === "expire" || e?.stage === "end"),
    );
    const allyForm = events.find((e) => e?.type === "ally" && e?.stage === "form");
    const allyBreak = events.find((e) => e?.type === "ally" && e?.stage === "break");
    const allyDissolve = events.find((e) => e?.type === "ally" && e?.stage === "dissolve");
    const backstab = events.find((e) => e?.type === "backstab");

    let payload = null;
    if (warDeclare) {
      // The event already carries both whole sides (dragged-in allies
      // included), straight from the spec — no lookup needed. Cached anyway,
      // keyed by the state's own war id, so a LATER peace/expiry on this same
      // war can still show who was on it (see warCache above).
      const rec = (game?.wars || []).find(
        (w) => w?.declarer === warDeclare.declarer && w?.target === warDeclare.target,
      );
      if (rec?.id != null) {
        warCache.current[rec.id] = { a: warDeclare.sideA, b: warDeclare.sideB };
      }
      payload = {
        kind: "warDeclare",
        title: "War declared",
        sub: `${nameOfFig(players, warDeclare.declarer)} vs ${nameOfFig(players, warDeclare.target)}`,
        chip: `Double rent · ${WAR_ROUNDS} rounds`,
        tone: "neg",
        left: warDeclare.sideA,
        right: warDeclare.sideB,
      };
    } else if (warPeace) {
      const cached = warCache.current[warPeace.warId];
      delete warCache.current[warPeace.warId];
      const amount = Number(warPeace.amount) || 0;
      payload = {
        kind: "peace",
        title: "Peace signed",
        sub: null,
        chip: amount > 0 ? `${fmt(amount)} paid` : "No payment",
        tone: "pos",
        left: cached?.a ?? [],
        right: cached?.b ?? [],
      };
    } else if (warEnd) {
      const cached = warCache.current[warEnd.warId];
      delete warCache.current[warEnd.warId];
      payload = {
        kind: "warEnd",
        title: warEnd.reason === "bankrupt" ? "War ends" : "War expires",
        sub: WAR_END_REASON[warEnd.reason] ?? null,
        chip: null,
        tone: null,
        left: cached?.a ?? [],
        right: cached?.b ?? [],
      };
    } else if (allyForm) {
      payload = {
        kind: "allyForm",
        title: "Alliance formed",
        sub: null,
        chip: "No rent between allies",
        tone: "pos",
        left: [allyForm.a],
        right: [allyForm.b],
      };
    } else if (allyBreak) {
      payload = {
        kind: "allyBreak",
        title: "Alliance broken",
        sub: `${nameOfFig(players, allyBreak.figure)} ended it`,
        chip: null,
        tone: null,
        left: [allyBreak.figure],
        right: [allyBreak.other],
      };
    } else if (allyDissolve) {
      payload = {
        kind: "allyDissolve",
        title: "Alliance dissolved",
        sub: DISSOLVE_REASON[allyDissolve.reason] ?? null,
        chip: null,
        tone: null,
        left: [allyDissolve.a],
        right: [allyDissolve.b],
      };
    } else if (backstab) {
      payload = {
        kind: "backstab",
        title: "Backstab!",
        sub: `${nameOfFig(players, backstab.figure)} is branded TRAITOR — +25% rent, ${TRAITOR_ROUNDS} rounds`,
        chip: `${fmt(backstab.amount)} taken`,
        tone: "neg",
        left: [backstab.figure],
        right: [backstab.victim],
      };
    }
    if (payload) {
      setDiplo(payload);
      diploTimer.current = setTimeout(() => setDiplo(null), DIPLO_MS);
    }
  }, [feed]);

  useEffect(
    () => () => {
      clearTimeout(cardTimer.current);
      clearTimeout(tradeTimer.current);
      clearTimeout(bustTimer.current);
      clearTimeout(diploTimer.current);
    },
    [],
  );

  const list = players || [];
  const empty = list.length === 0;
  const winners = winnersOf(game);
  const over = game?.phase === "over" || !!game?.winner || winners.length > 0;
  const auction = game?.auction || null;
  const trade = game?.trade || null;
  // Kept for the single-winner sentences below (turn/sub text, the aria-live
  // announcement): a shared win's own two-name sentence is built where it is
  // used, from `winners`/TvOver, rather than forcing a plural in here too.
  const winner = game?.winner ? playerByFig(list, game.winner) : null;
  const sharedWinNames = winners.length >= 2
    ? winners.map((fig) => nameOfFig(list, fig)).join(" & ")
    : null;
  const cellName = (id) => board?.[id]?.header ?? "the board";
  const doubles = Number(game?.doubles) || 0;

  // ---- the doubles run ---------------------------------------------------
  // `stage` is what the chip under the dice says. 3 is the wall, and it only
  // ever comes from the jail event (see the note at the top of this file).
  const bustPlayer = bust ? playerByFig(list, bust.fig) : null;
  const bustDoubles = bust?.reason === "doubles";
  const stage = bustDoubles ? 3 : Math.min(doubles, 2);
  const runner = bustDoubles ? bustPlayer : current;
  const DOUBLE_TEXT = {
    1: "Doubles · roll again",
    2: "Doubles again · one more and it is jail",
    3: "Three doubles · straight to jail",
  };

  // ---- base layer text ---------------------------------------------------
  let turnText = "Waiting for players";
  let subText = "Nobody has joined yet";
  if (!empty) {
    if (bust) {
      // Louder than a turn line, and it outranks even a roll in progress: this
      // is the thing that just happened to somebody.
      turnText = bustDoubles ? "Busted" : "Go to jail";
      subText = `${bustPlayer?.name ?? "A player"} — ${
        JAIL_REASON[bust.reason] ?? JAIL_REASON.gtj
      }`;
    } else if (roller) {
      // The whole room is watching the dice: the title stays put (it is still
      // that player's turn) and the sub-line says what is happening.
      turnText = current ? `${current.name}’s turn` : turnText;
      subText = `${roller} is rolling…`;
    } else if (auction) {
      turnText = "Auction";
      subText = `${cellName(auction.cell)} is up for bids`;
    } else if (over) {
      turnText = "Game over";
      subText = sharedWinNames ? `${sharedWinNames} win` : winner ? `${winner.name} wins` : "Nobody left";
    } else if (current) {
      turnText = `${current.name}’s turn`;
      subText = current.inJail
        ? jailSub(current)
        : doubles > 0
          ? // The chip below the dice already shouts DOUBLES, so the sub-line
            // goes back to saying where the player actually is.
            `${current.name} is on ${cellName(current.position)}`
          : `${current.name} is on ${cellName(current.position)}`;
    } else {
      subText = "Waiting for the next turn";
    }
  }

  // ---- the one overlay ---------------------------------------------------
  let overlay = null;
  let alt = "";
  if (over) {
    overlay = <TvOver players={list} game={game} />;
    alt = sharedWinNames
      ? `Game over. ${sharedWinNames} win.`
      : winner
        ? `Game over. ${winner.name} wins.`
        : "Game over. Nobody left.";
  } else if (auction) {
    overlay = <TvAuction auction={auction} board={board} players={list} />;
    const lead = auction.leader ? playerByFig(list, auction.leader) : null;
    alt = `Auction for ${cellName(auction.cell)}. ${
      lead ? `High bid ${fmt(auction.bid)} by ${lead.name}.` : "No bids yet."
    }`;
  } else if (diplo) {
    overlay = <TvDiplo diplo={diplo} players={list} />;
    alt = [diplo.title, diplo.sub, diplo.chip].filter(Boolean).join(". ");
  } else if (card) {
    overlay = <TvCard card={card} players={list} />;
    const drew = playerByFig(list, card.figure);
    alt = `${drew?.name ?? "A player"} drew a ${card.kind} card: ${fmtText(card.text)}`;
  } else if (tradeEnd) {
    overlay = (
      <TvTrade trade={tradeEnd.trade} board={board} players={list} status={tradeEnd.status} />
    );
    alt = `Trade ${tradeEnd.status}.`;
  } else if (trade) {
    overlay = <TvTrade trade={trade} board={board} players={list} />;
    alt = `${playerByFig(list, trade.from)?.name ?? "A player"} offers ${
      playerByFig(list, trade.to)?.name ?? "another player"
    } a trade.`;
  }

  const drawing = overlay && card && !over && !auction ? card.deck : null;
  // Dice are hidden during an auction, and before the room has ever rolled:
  // `game.dice` is null on a fresh board, and a pair of ones nobody threw is a
  // small lie on a screen everybody is reading.
  const dice = Array.isArray(game?.dice) && game.dice.length >= 2 ? game.dice : null;
  const showDice = !auction && !empty && (dice != null || everRolled || roll != null);

  // The centre glow is the focus tile's colour. The shell already sets --tint /
  // --on-tint on the TV root from the same tile; restating them here for the
  // centre costs nothing, keeps the two in step when the shell is mid-update,
  // and lets this component look right wherever else it is mounted. When the
  // cell is unknown the inherited value is left alone.
  const focus = board?.[focusCellId] ?? null;
  const glow = focus
    ? { "--tint": accentFor(focus), "--on-tint": readableOn(accentFor(focus)) }
    : undefined;

  return (
    // `data-tv-center` is how the money layer (TvPayFx) finds this box in the
    // unscaled canvas: it puts its transfer banner along the bottom of it, so
    // the banner is in the middle of the board without ever covering a card.
    <div className={c.center} style={glow} data-tv-center="">
      <div className={c.base}>
        <div className={`${c.deck} ${c.chance} ${drawing === "chance" ? c.isDrawing : ""}`}>
          <Sparkles size={52} aria-hidden="true" />
          <span>Chance</span>
        </div>

        <div className={c.mid}>
          <strong className={c.turn}>{turnText}</strong>
          {subText && <span className={c.sub}>{subText}</span>}
          {showDice && (
            /* A wrapper this file owns, so the "busted" shake is written on
               something that is NOT the dice component (src/Client/RollDice,
               shared with the phone) and NOT any ancestor between its
               `perspective` and its cube faces — a transform in there would
               flatten the 3D. Only transform and opacity are ever animated. */
            <div
              className={c.diceBox}
              data-stage={stage > 0 ? stage : undefined}
              data-reduce={reduce ? "" : undefined}
            >
              <RollDice
                values={dice ?? [1, 1]}
                roll={roll}
                size={88}
                gap={20}
                /* 10px, not the 18 this used to ask for. `radius` is the one
                   knob the shared dice component (src/Client/RollDice) gives a
                   caller over its face geometry, and at 18 on an 88px face two
                   adjacent faces of the cube only meet across the middle 60% of
                   their shared edge — mid-tumble the cube stops reading as a
                   solid and looks like three loose cards. 10px is about what a
                   real die has and it keeps the corners honest. The rest of
                   that defect is not on this side of the fence; see the report
                   and the note on .diceBox in tvCenter.module.css. */
                radius={10}
                reduce={reduce}
              />
            </div>
          )}
          {/* The doubles run, escalating. Keyed by stage so each step is its
              own element and plays its own entrance rather than cross-fading
              into the last one's. */}
          {stage > 0 && !auction && !over && runner && (
            <span
              key={stage}
              className={c.dbl}
              data-stage={stage}
              data-reduce={reduce ? "" : undefined}
            >
              <Dices size={22} aria-hidden="true" />
              {DOUBLE_TEXT[stage]}
            </span>
          )}
        </div>

        <div className={`${c.deck} ${c.chest} ${drawing === "chest" ? c.isDrawing : ""}`}>
          <Gift size={52} aria-hidden="true" />
          <span>Community</span>
        </div>
      </div>

      <div className={c.ov} data-on={overlay ? "1" : undefined} aria-live="polite">
        {overlay}
        {overlay && <span className={c.sr}>{alt}</span>}
      </div>
    </div>
  );
}
