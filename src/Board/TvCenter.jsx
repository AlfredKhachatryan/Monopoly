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
// Overlay priority: game over > auction > card > trade
// ---------------------------------------------------------------------------
// One at a time, never two. A finished game outranks everything; a running
// auction outranks a card because the auction is what the room is waiting on;
// a card outranks a trade because it is the shorter of the two.

import { useEffect, useRef, useState } from "react";
import { Dices, Gift, Sparkles, Trophy } from "lucide-react";
import { JAIL_MAX_TURNS, accentFor, playerByFig, readableOn } from "../Hooks/rules";
import { fmt, fmtSigned, fmtText } from "../Client/format";
import { hasCyrillic } from "../Client/boardDisplay";
import Tok from "../Client/Tok";
import RollDice from "../Client/RollDice";
import { REVEAL } from "../Client/useReveal";
import TvAuction from "./TvAuction";
import TvFigure from "./TvFigure";
import TvTrade from "./TvTrade";
import { useTvFeed, useTvReduce } from "./TvFeed";
import c from "./tvCenter.module.css";

const CARD_MS = 4500;
const TRADE_END_MS = 2800;
const TRADE_DONE = ["accepted", "declined", "cancelled", "expired"];

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

function TvOver({ players, game }) {
  const winner = game?.winner ? playerByFig(players, game.winner) : null;
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

  return (
    <div className={c.over} data-many={many ? "" : undefined}>
      <div className={c.overHead}>
        {/* The one hero moment on this board, so the winner gets the full
            figure rather than a token — and keeps the art's own ground shadow,
            which is what makes it stand on the panel instead of float over
            it. */}
        {winner && (
          <span className={c.overFig}>
            <TvFigure player={winner} height={many ? 150 : 180} shadow />
          </span>
        )}
        <div className={c.overWho}>
          <span className={c.overCup}>
            <Trophy size={44} aria-hidden="true" />
          </span>
          <strong className={c.overTitle}>{winner ? `${winner.name} wins` : "Nobody left"}</strong>
        </div>
      </div>
      <span className={c.overSub}>Final standings</span>
      <ol className={c.overList}>
        {standings.map((p, i) => (
          <li
            key={p.playerId ?? p.figure ?? i}
            className={`${c.overRow} ${p.bankrupt ? c.isOut : ""} ${
              p.figure === game?.winner ? c.isWin : ""
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
  const cardTimer = useRef(null);
  const tradeTimer = useRef(null);
  const bustTimer = useRef(null);

  // One effect per batch. Whatever was transient is dropped first — "the next
  // action" is precisely what ends a card, and a stale "Deal accepted" sitting
  // over the next player's roll would be a lie.
  useEffect(() => {
    if (!feed) return;
    const events = Array.isArray(feed.events) ? feed.events : [];
    clearTimeout(cardTimer.current);
    clearTimeout(tradeTimer.current);
    clearTimeout(bustTimer.current);
    setCard(null);
    setTradeEnd(null);
    setBust(null);

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
  }, [feed]);

  useEffect(
    () => () => {
      clearTimeout(cardTimer.current);
      clearTimeout(tradeTimer.current);
      clearTimeout(bustTimer.current);
    },
    [],
  );

  const list = players || [];
  const empty = list.length === 0;
  const over = game?.phase === "over" || !!game?.winner;
  const auction = game?.auction || null;
  const trade = game?.trade || null;
  const winner = game?.winner ? playerByFig(list, game.winner) : null;
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
      subText = winner ? `${winner.name} wins` : "Nobody left";
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
    alt = winner ? `Game over. ${winner.name} wins.` : "Game over. Nobody left.";
  } else if (auction) {
    overlay = <TvAuction auction={auction} board={board} players={list} />;
    const lead = auction.leader ? playerByFig(list, auction.leader) : null;
    alt = `Auction for ${cellName(auction.cell)}. ${
      lead ? `High bid ${fmt(auction.bid)} by ${lead.name}.` : "No bids yet."
    }`;
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
