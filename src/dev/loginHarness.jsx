// Offline preview harness for the Login screen (dev only).
//
// Boots <Login/> (src/Login/LoginScreen.jsx, re-exported by src/Pages/Login)
// against the mocked Supabase backend (src/dev/mockSupabase.js, swapped in for
// src/Hooks/supabase.jsx by mockSupabasePlugin in vite.config.js, active only
// for `npm run dev:mock`). Same idea as client-harness.html for the phone and
// tv-harness.html for the board: every state the first screen of the product
// can be in -- an empty code, a room found with seats already taken, a code no
// room answers to, a full room, a returning player, a join the server refuses,
// and a figure going grey live under your thumb -- can be opened directly,
// with no Supabase project and no second phone.
//
// Run:   npm run dev:mock
// Open:  http://localhost:3000/login-harness.html
// Pick a starting point with the toolbar, or the URL: ?s=<scenario-name>
// (see TESTING.md's "Offline login preview" section for the full list).
//
// Query params:
//   ?s=<name>   scenario (src/dev/scenarios.js's LOGIN_SCENARIO_NAMES)
//   ?chrome=0   hide the dev toolbar entirely (for clean screenshots)
//
// A successful join navigates to /Client. This page answers that route with a
// stub rather than the real controller: what is being previewed here is the
// login screen, and mounting <Client/> would drag the whole game in behind it.
//
// This file, login-harness.html, mockSupabase.js and scenarios.js are never
// part of the production build: mockSupabasePlugin is only registered for
// `command === "serve"` with VITE_MOCK=1, so `npm run build` never sees them
// and the Login screen keeps importing the real src/Hooks/supabase.jsx.

import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Same globals main.jsx loads, so the screen looks the same as it does inside
// the real app (Bootstrap's reboot included -- the login CSS has to survive
// it, so the harness must not quietly omit it).
import "../CDN/bootstrap.min.css";
import "../styles/main.css";
import "../styles/tokens.css";

import { Login } from "../Pages/Login";
import { MotionProvider } from "../Components/Motion";

import { mockDev, gameAction } from "./mockSupabase";
import "./devToolbar.css";

// Exposed for headless verification only (see TESTING.md), exactly as the
// client harness does it: a script driving this page can reach the mock
// directly instead of DOM-scraping the toolbar.
if (typeof window !== "undefined") {
  window.mockDev = mockDev;
  window.mockGameAction = gameAction;
}

function chromeVisible() {
  return new URLSearchParams(window.location.search).get("chrome") !== "0";
}

if (!import.meta.env.VITE_MOCK) {
  // eslint-disable-next-line no-console
  console.warn(
    "[login-harness] VITE_MOCK is not set. Run `npm run dev:mock`, not `npm run dev`, " +
      "or the Login screen will try to load the real Supabase module.",
  );
}

function readScenarioFromUrl() {
  const s = new URLSearchParams(window.location.search).get("s");
  return s && mockDev.loginScenarios.some((sc) => sc.name === s)
    ? s
    : mockDev.defaultLoginScenario;
}

// The Login screen reads localStorage in a lazy useState initialiser and in
// its first effect, so the seed has to be in place BEFORE it ever renders --
// which is why this is called from the Harness component's own useState
// initialiser below, not from an effect.
function seedLocalStorage(name) {
  const meta = mockDev.loginScenarios.find((sc) => sc.name === name);
  const login = meta?.login ?? null;
  try {
    if (login?.roomCode) localStorage.setItem("roomId", login.roomCode);
    else localStorage.removeItem("roomId");
    if (login?.playerInfo) localStorage.setItem("playerInfo", JSON.stringify(login.playerInfo));
    else localStorage.removeItem("playerInfo");
  } catch {
    /* private browsing: the harness still works, it just won't survive a refresh */
  }
}

function DevToolbar({ scenario, onPick }) {
  const [open, setOpen] = useState(true);
  const current = mockDev.loginScenarios.find((sc) => sc.name === scenario);

  return (
    <div className={`devToolbar ${open ? "" : "devToolbar--collapsed"}`}>
      <button className="devToolbar__handle" onClick={() => setOpen((v) => !v)}>
        {open ? "Hide dev panel ▴" : "Dev panel ▾"}
      </button>
      {open && (
        <div className="devToolbar__body">
          <div className="devToolbar__title">Offline login preview</div>

          <div className="devToolbar__group">
            <div className="devToolbar__label">Scenario (?s=)</div>
            <select
              className="devToolbar__select"
              value={scenario}
              onChange={(e) => onPick(e.target.value)}
            >
              {mockDev.loginScenarios.map((sc) => (
                <option key={sc.name} value={sc.name}>
                  {sc.name}
                </option>
              ))}
            </select>
            {current && <div className="devToolbar__hint">{current.describe}</div>}
          </div>

          <div className="devToolbar__group">
            <div className="devToolbar__label">Push a live event</div>
            <button className="devToolbar__btn" onClick={() => mockDev.botJoinsNow()}>
              Another phone joins now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClientStub() {
  return (
    <div
      style={{
        height: "100dvh",
        display: "grid",
        placeItems: "center",
        background: "#0d0f13",
        color: "#eef1f5",
        font: "700 22px/1.3 system-ui, sans-serif",
      }}
    >
      → /Client
    </div>
  );
}

function Harness() {
  // Same reasoning as clientHarness.jsx: the scenario (and the localStorage it
  // implies) must be in place before <Login> renders for the first time, and a
  // lazy useState initialiser runs during this component's own render, which
  // always happens before React renders the child below.
  const [scenario, setScenario] = useState(() => {
    const initial = readScenarioFromUrl();
    seedLocalStorage(initial);
    mockDev.loadScenario(initial);
    return initial;
  });
  const first = useRef(true);
  const chrome = chromeVisible();

  useEffect(() => {
    if (first.current) {
      first.current = false;
    } else {
      seedLocalStorage(scenario);
      mockDev.loadScenario(scenario);
    }
    const url = new URL(window.location.href);
    url.searchParams.set("s", scenario);
    window.history.replaceState(null, "", url);
  }, [scenario]);

  return (
    <>
      {chrome && <DevToolbar scenario={scenario} onPick={setScenario} />}
      {/* `key` remounts the whole router on a scenario switch, so the screen
          re-reads localStorage and re-runs its first fetch against the new
          room instead of reconciling it under the old state. */}
      <MemoryRouter key={scenario} initialEntries={["/Login"]}>
        <Routes>
          <Route path="/Login" element={<Login />} />
          <Route path="/Client" element={<ClientStub />} />
        </Routes>
      </MemoryRouter>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <MotionProvider>
    <Harness />
  </MotionProvider>,
);
