// Offline preview harness for the phone Client screen (dev only).
//
// Boots <Client/> against a mocked Supabase backend (src/dev/mockSupabase.js,
// swapped in for src/Hooks/supabase.jsx by mockSupabasePlugin in
// vite.config.js, active only for `npm run dev:mock`). Lets every state of
// the client -- mid-roll, buying, jail, bankrupt, game over, a network
// error -- be opened directly, with no Supabase project and no other players.
//
// Run:   npm run dev:mock
// Open:  http://localhost:3000/client-harness.html
// Pick a starting point with the toolbar, or the URL: ?s=<scenario-name>
// (see TESTING.md's "Offline client preview" section for the full list).
//
// This file, client-harness.html, mockSupabase.js and scenarios.js are never
// part of the production build: mockSupabasePlugin is only registered for
// `command === "serve"` with VITE_MOCK=1, so `npm run build` never sees them
// and Client keeps importing the real src/Hooks/supabase.jsx.

import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";

// Same globals main.jsx loads, so the Client screen looks the same as it
// does inside the real app.
import "../CDN/bootstrap.min.css";
import "../styles/main.css";
import "../styles/tokens.css";

import { Client } from "../Client/ClientScreen";
import { MotionProvider } from "../Components/Motion";

import { mockDev, gameAction, enableLinkBridge } from "./mockSupabase";
import "./devToolbar.css";

// Exposed for headless verification only (see TESTING.md): a script driving
// this page in a browser can call window.mockDev.* / window.mockGameAction()
// directly instead of clicking toolbar buttons and DOM-scraping. Never
// reached by `npm run build` -- this whole file is a dev-only entry point
// client-harness.html loads on its own, not part of the index.html graph
// vite build bundles.
if (typeof window !== "undefined") {
  window.mockDev = mockDev;
  window.mockGameAction = gameAction;
}

// `?chrome=0` hides the dev toolbar entirely (for a clean screenshot, or as
// the right half of tv-harness.html's linked mode -- see that file's header
// comment). `?link=1` makes this page the AUTHORITY of the linked-mode
// bridge: it publishes every row it produces so a TV iframe (opened with
// `&embed=1`) can mirror it live. Behind these two flags so a normal,
// single-page `?s=<scenario>` run is completely unaffected.
function chromeVisible() {
  return new URLSearchParams(window.location.search).get("chrome") !== "0";
}
function isLinkAuthority() {
  return new URLSearchParams(window.location.search).get("link") === "1";
}

if (!import.meta.env.VITE_MOCK) {
  // Not fatal here -- but ClientScreen's import of the real supabase module
  // will throw on its own (missing VITE_SUPABASE_URL/KEY) if this page is
  // opened under plain `npm run dev`.
  // eslint-disable-next-line no-console
  console.warn(
    "[client-harness] VITE_MOCK is not set. Run `npm run dev:mock`, not `npm run dev`, " +
      "or the Client screen will try to load the real Supabase module.",
  );
}

function readScenarioFromUrl() {
  const s = new URLSearchParams(window.location.search).get("s");
  return s && mockDev.scenarios.some((sc) => sc.name === s) ? s : mockDev.defaultScenario;
}

function seedLocalStorage() {
  try {
    localStorage.setItem("playerInfo", JSON.stringify({ playerId: mockDev.mePlayerId, figure: mockDev.meFigure }));
    localStorage.setItem("roomId", mockDev.roomUuid);
  } catch {
    /* private browsing: the harness still works, it just won't survive a refresh */
  }
}

function DevToolbar({ scenario, onPick }) {
  const [open, setOpen] = useState(true);
  const current = mockDev.scenarios.find((sc) => sc.name === scenario);

  return (
    <div className={`devToolbar ${open ? "" : "devToolbar--collapsed"}`}>
      <button className="devToolbar__handle" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide dev panel ▴" : "Dev panel ▾"}
      </button>
      {open && (
        <div className="devToolbar__body">
          <div className="devToolbar__title">Offline client preview</div>

          <div className="devToolbar__group">
            <div className="devToolbar__label">Scenario (?s=)</div>
            <select className="devToolbar__select" value={scenario} onChange={(e) => onPick(e.target.value)}>
              {mockDev.scenarios.map((sc) => (
                <option key={sc.name} value={sc.name}>
                  {sc.name}
                </option>
              ))}
            </select>
            {current && <div className="devToolbar__hint">{current.describe}</div>}
          </div>

          <div className="devToolbar__group">
            <div className="devToolbar__label">Push a live event</div>
            <button className="devToolbar__btn" onClick={() => mockDev.forceOpponentRent()}>
              Opponent rolls &amp; pays me rent
            </button>
            <button className="devToolbar__btn" onClick={() => mockDev.forceOpponentBuy()}>
              Opponent buys
            </button>
            <button className="devToolbar__btn" onClick={() => mockDev.forceMyRoll()}>
              I roll (random)
            </button>
          </div>

          <div className="devToolbar__group">
            <div className="devToolbar__label">Auctions &amp; trading</div>
            <button className="devToolbar__btn" onClick={() => mockDev.botOffersMeATrade()}>
              Bot offers me a trade
            </button>
            <button className="devToolbar__btn" onClick={() => mockDev.botStartsAuction()}>
              Bot starts an auction
            </button>
            <button className="devToolbar__btn" onClick={() => mockDev.forceBotToMoveNow()}>
              Force bot to move now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Harness() {
  // The scenario has to be loaded into the mock room BEFORE <Client> ever
  // mounts, not in an effect after it: React runs child effects before
  // parent effects, so a plain `useEffect` here used to call
  // mockDev.loadScenario() *after* <Client>'s own first-fetch effect had
  // already run against whatever the room happened to be (nothing, for
  // ?s=loading and ?s=fetch-error, which was the whole point of picking
  // them). A lazy useState initialiser runs synchronously during this
  // component's own render, which always happens before React renders the
  // <Client> child below, so the room -- and the fetch mode for loading /
  // fetch-error -- is correct for <Client>'s very first paint.
  const [scenario, setScenario] = useState(() => {
    const initial = readScenarioFromUrl();
    seedLocalStorage();
    mockDev.loadScenario(initial);
    // Linked mode (see tv-harness.html?phone=1 / this file's header comment
    // update below): this half is the authority once, right after the
    // scenario it shares with the TV iframe is loaded, so the TV catches up
    // with a real row on its first `request_sync` rather than an empty one.
    if (isLinkAuthority()) enableLinkBridge("authority");
    return initial;
  });
  const first = useRef(true);
  const chrome = chromeVisible();

  useEffect(() => {
    // Skip the load the lazy initialiser above already did for the initial
    // scenario; only reload when the toolbar actually switches scenarios.
    if (first.current) {
      first.current = false;
    } else {
      seedLocalStorage();
      mockDev.loadScenario(scenario);
    }
    const url = new URL(window.location.href);
    url.searchParams.set("s", scenario);
    window.history.replaceState(null, "", url);
  }, [scenario]);

  return (
    <>
      {chrome && <DevToolbar scenario={scenario} onPick={setScenario} />}
      <div className="devPhoneFrame">
        <MemoryRouter initialEntries={["/Client"]}>
          {/* `key` remounts the screen on every scenario switch, so
              useGameRoom's seq guard and every bit of local UI state
              (dice, sheets, landedAt...) start clean instead of trying to
              reconcile a brand new mock room under old state. */}
          <Client key={scenario} />
        </MemoryRouter>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <MotionProvider>
    <Harness />
  </MotionProvider>,
);
