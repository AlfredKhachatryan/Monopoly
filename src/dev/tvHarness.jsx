// Offline preview harness for the big-screen Board (dev only).
//
// Boots <Main/> (src/Pages/Board.jsx, exported as `Main`) against the mocked
// Supabase backend (src/dev/mockSupabase.js, swapped in for
// src/Hooks/supabase.jsx by mockSupabasePlugin in vite.config.js, active only
// for `npm run dev:mock`). Same idea as client-harness.html/clientHarness.jsx
// for the phone, but for the TV: every board state -- idle, mid-auction, a
// pending trade, game over, a worst-case fully-built board, no room at all --
// can be opened directly, with no Supabase project and no phones.
//
// Run:   npm run dev:mock
// Open:  http://localhost:3000/tv-harness.html
// Pick a starting point with the toolbar, or the URL: ?s=<scenario-name>
// (see TESTING.md's "Offline TV preview" section for the full list).
//
// Query params:
//   ?s=<name>       scenario (see src/dev/scenarios.js's TV_SCENARIO_NAMES)
//   ?chrome=0       hide the dev toolbar entirely (for clean screenshots)
//   ?phone=1        LINKED MODE: render the TV *and* the phone Client side by
//                   side, both driving one shared mock room (see below)
//   ?embed=1        internal: "I am the TV half of a linked pair" -- set by
//                   this file itself when it builds the linked layout's TV
//                   iframe src, never typed by hand
//
// This file, tv-harness.html, client-harness.html, mockSupabase.js and
// scenarios.js are never part of the production build: mockSupabasePlugin is
// only registered for `command === "serve"` with VITE_MOCK=1, so
// `npm run build` never sees any of it and Board.jsx keeps importing the real
// src/Hooks/supabase.jsx.
//
// --- Linked mode -----------------------------------------------------------
// `tv-harness.html?s=<scenario>&phone=1` renders two same-origin IFRAMES side
// by side: `tv-harness.html?s=…&chrome=0&embed=1` on the left and
// `client-harness.html?s=…&chrome=0&link=1` on the right, inside a 390x844
// phone frame, logged in as Afo. Two iframes, not one page with a div split,
// because the TV canvas scales itself to *the window* (`min(innerWidth/1920,
// innerHeight/1080)`, see design-reference/tv-board-reference.md) -- a
// same-page split would make it measure the whole outer window, including
// the phone's space, and scale wrong. An iframe has its own `window`, so
// Board's own scaling logic works unmodified no matter what this page's
// layout looks like.
//
// Each iframe gets its own JS module graph (and therefore its own copy of
// mockSupabase.js's module state), so "one shared game" only happens because
// mockSupabase.js's enableLinkBridge() copies rows across a BroadcastChannel
// (with a same-origin `storage`-event fallback). The phone iframe (`&link=1`)
// is always the AUTHORITY: it runs the one real, validated gameAction
// pipeline (including every bot), and publishes every row it produces. The
// TV iframe (`&embed=1`) is a FOLLOWER: it never mutates its own local room
// while linked, it only mirrors whatever the phone publishes, and forwards
// its own action attempts (the toolbar's Skip Turn / New Game, or anything
// Board.jsx itself calls) to the phone instead of applying them locally --
// see mockSupabase.js's `gameAction()` and `enableLinkBridge()`.
//
// Limits: both iframes must already agree on the scenario (?s=) at load --
// the toolbar in linked mode changes the outer URL and remounts both iframes
// from scratch (a full reload each), it does not hot-swap a running pair.
// The bridge only carries whole rows and action attempts, nothing else (no
// cursor/selection sync, no chat). If the phone iframe hasn't loaded yet, the
// TV iframe shows nothing until the phone's first published row arrives
// (typically well under 100ms after both have loaded); a `request_sync`
// message sent on connect covers the case where the phone loaded first.

import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { MemoryRouter } from "react-router-dom";

// Same globals main.jsx loads (see that file), plus the TV brand line's
// Unbounded font, which nothing else in index.html/main.jsx pulls in.
import "../CDN/bootstrap.min.css";
import "../styles/main.css";
import "../styles/tokens.css";

import { Main } from "../Pages/Board";
import { MotionProvider } from "../Components/Motion";
import { initialState } from "../Hooks/baseState";

import { mockDev, gameAction, createGame, useFetch, useRealtimeUpdates, enableLinkBridge } from "./mockSupabase";
import "./devToolbar.css";

// Exposed for headless verification only (see TESTING.md): a script driving
// this page can call window.mockDev.* / window.mockGameAction() /
// window.mockCreateGame() directly, and read window.__tvRow (kept current by
// <TvRowProbe> below) instead of scraping the DOM. Never reached by
// `npm run build`.
if (typeof window !== "undefined") {
  window.mockDev = mockDev;
  window.mockGameAction = gameAction;
  window.mockCreateGame = createGame;
}

if (!import.meta.env.VITE_MOCK) {
  // eslint-disable-next-line no-console
  console.warn(
    "[tv-harness] VITE_MOCK is not set. Run `npm run dev:mock`, not `npm run dev`, " +
      "or the Board will try to load the real Supabase module.",
  );
}

function params() {
  return new URLSearchParams(window.location.search);
}

function isEmbed() {
  return params().get("embed") === "1";
}

function isLinkedOuter() {
  return params().get("phone") === "1" && !isEmbed();
}

function chromeVisible() {
  return params().get("chrome") !== "0";
}

function scenarioMeta(name) {
  return mockDev.tvScenarios.find((sc) => sc.name === name);
}

function readScenarioFromUrl() {
  const s = params().get("s");
  return s && mockDev.tvScenarios.some((sc) => sc.name === s) ? s : mockDev.defaultTvScenario;
}

function seedRoom() {
  try {
    localStorage.setItem("roomId", mockDev.roomUuid);
  } catch {
    /* private browsing: the harness still works, it just won't survive a refresh */
  }
  const url = new URL(window.location.href);
  if (url.searchParams.get("room") !== mockDev.roomUuid) {
    url.searchParams.set("room", mockDev.roomUuid);
    window.history.replaceState(null, "", url);
  }
}

function clearRoomSeed() {
  try {
    localStorage.removeItem("roomId");
  } catch {
    /* nothing to clear */
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has("room")) {
    url.searchParams.delete("room");
    window.history.replaceState(null, "", url);
  }
}

// Loads one TV scenario into the mock room -- or, for the one scenario
// flagged `noRoom` (tv-no-room), makes sure NO room id exists anywhere
// (URL, localStorage) so Board.jsx's own `readRoomId()` finds nothing and
// falls to its enter-code / Host New Game screen. Called before first
// render (see the lazy useState initialiser in <TvHarness>, below) so there
// is no first-paint race against Board's own first-fetch effect -- same fix
// clientHarness.jsx already needed for `?s=loading` / `?s=fetch-error`.
function loadTv(name) {
  const meta = scenarioMeta(name);
  if (meta?.noRoom) {
    clearRoomSeed();
    return;
  }
  seedRoom();
  mockDev.loadScenario(name);
}

// Debug hook (see TESTING.md "Offline TV preview" / this file's header
// comment): keeps `window.__tvRow` equal to whatever row Board.jsx itself is
// currently receiving, via the exact same useFetch/useRealtimeUpdates path,
// without needing to reach into Board's internals (which are mid-rewrite by
// other agents and not this file's to touch). Renders nothing.
function TvRowProbe({ uuid }) {
  const { data } = useFetch(uuid);
  useEffect(() => {
    if (data) window.__tvRow = data;
  }, [data]);
  useRealtimeUpdates(uuid, (payload) => {
    window.__tvRow = payload.new;
  });
  return null;
}

function TvDevToolbar({ mode, scenario, onPick }) {
  const [open, setOpen] = useState(true);
  const list = mockDev.tvScenarios;
  const current = list.find((sc) => sc.name === scenario);
  const linkedUrl = (() => {
    const url = new URL(window.location.href);
    url.searchParams.set("phone", "1");
    url.searchParams.set("s", scenario);
    return url.toString();
  })();
  const aloneUrl = (() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("phone");
    url.searchParams.set("s", scenario);
    return url.toString();
  })();

  return (
    <div className={`devToolbar ${open ? "" : "devToolbar--collapsed"}`}>
      <button className="devToolbar__handle" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide dev panel ▴" : "Dev panel ▾"}
      </button>
      {open && (
        <div className="devToolbar__body">
          <div className="devToolbar__title">Offline TV preview{mode === "linked" ? " (linked)" : ""}</div>

          <div className="devToolbar__group">
            <div className="devToolbar__label">Scenario (?s=)</div>
            <select className="devToolbar__select" value={scenario} onChange={(e) => onPick(e.target.value)}>
              {list.map((sc) => (
                <option key={sc.name} value={sc.name}>
                  {sc.name}
                </option>
              ))}
            </select>
            {current && <div className="devToolbar__hint">{current.describe}</div>}
          </div>

          {mode === "tv" && (
            <div className="devToolbar__group">
              <div className="devToolbar__label">Board controls</div>
              <button
                className="devToolbar__btn"
                onClick={() => gameAction(mockDev.roomUuid, "new_game", { position: initialState() })}
              >
                New Game
              </button>
              <button className="devToolbar__btn" onClick={() => gameAction(mockDev.roomUuid, "skip_turn", {})}>
                Skip Turn
              </button>
              <button
                className="devToolbar__btn"
                onClick={() => createGame(initialState(), () => Math.random().toString(36).slice(2, 8).toUpperCase())}
              >
                Host New Game (new code)
              </button>
            </div>
          )}

          <div className="devToolbar__group">
            <div className="devToolbar__label">Linked mode</div>
            {mode === "tv" ? (
              <a className="devToolbar__btn" href={linkedUrl} style={{ display: "block", textDecoration: "none" }}>
                Open TV + phone (linked) ↗
              </a>
            ) : (
              <a className="devToolbar__btn" href={aloneUrl} style={{ display: "block", textDecoration: "none" }}>
                Back to TV alone ↗
              </a>
            )}
            <div className="devToolbar__hint">
              Linked: the phone iframe is the authority. Its actions drive this TV live over a BroadcastChannel
              bridge; New Game / Skip Turn here (single-TV mode only) call the mock directly.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The two-iframe layout for `?phone=1`. Both iframes load the SAME scenario
// (`?s=`) fresh -- switching scenarios in the outer toolbar remounts this
// whole component (see the `key={scenario}` below), which reloads both
// frames from scratch rather than trying to hot-swap a running pair.
function LinkedLayout({ scenario }) {
  const s = encodeURIComponent(scenario);
  const tvSrc = `./tv-harness.html?s=${s}&chrome=0&embed=1`;
  const phoneSrc = `./client-harness.html?s=${s}&chrome=0&link=1`;
  return (
    <div className="tvLinkedLayout">
      <div className="tvLinkedTv">
        <iframe title="TV (follower)" src={tvSrc} className="tvLinkedTvFrame" />
      </div>
      <div className="tvLinkedPhone">
        <div className="tvLinkedPhoneFrame">
          <iframe title="Phone: Afo (authority)" src={phoneSrc} className="tvLinkedPhoneIframe" />
        </div>
      </div>
    </div>
  );
}

function TvHarness() {
  const embed = isEmbed();
  const linked = isLinkedOuter();
  const chrome = chromeVisible();

  const [scenario, setScenario] = useState(() => {
    const initial = readScenarioFromUrl();
    if (linked) {
      // The outer linked page never touches this iframe's own mock room --
      // both halves are iframes with their own module instance; this
      // document only ever renders the picker + the two <iframe>s.
      return initial;
    }
    if (embed) {
      // TV half of a linked pair: never load a local scenario. Become a
      // follower and wait for the phone (the authority) to publish rows.
      // Still seed the room id/`?room=` so Board.jsx's readRoomId() finds a
      // uuid to subscribe to once the first synced row arrives.
      enableLinkBridge("follower");
      seedRoom();
    } else {
      loadTv(initial);
    }
    return initial;
  });
  const first = useRef(true);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("s", scenario);
    window.history.replaceState(null, "", url);
    if (first.current) {
      first.current = false;
      return;
    }
    if (!linked && !embed) loadTv(scenario);
  }, [scenario, linked, embed]);

  if (linked) {
    return (
      <>
        {chrome && <TvDevToolbar mode="linked" scenario={scenario} onPick={setScenario} />}
        <LinkedLayout key={scenario} scenario={scenario} />
      </>
    );
  }

  return (
    <MemoryRouter initialEntries={["/"]}>
      {chrome && !embed && <TvDevToolbar mode="tv" scenario={scenario} onPick={setScenario} />}
      <TvRowProbe uuid={mockDev.roomUuid} />
      {/* `key` remounts the Board on every scenario switch, same reason
          clientHarness.jsx remounts <Client>: any local component state
          (dice, overlays...) should start clean against the new room rather
          than reconcile against a brand new mock room under old state. The
          embed/follower half never switches scenarios locally, so it never
          needs to remount for that reason -- only ever for a full page load. */}
      <Main key={embed ? "embed" : scenario} />
    </MemoryRouter>
  );
}

createRoot(document.getElementById("root")).render(
  <MotionProvider>
    <TvHarness />
  </MotionProvider>,
);
