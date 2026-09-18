// The four player figures (Imp, Cyclops, Specter, Yeti) — flat monster SVGs
// from design-reference/figures-manual.html, replacing the old mon_*.png
// characters. fig0..fig3 map to Imp/Cyclops/Specter/Yeti — the same mapping
// src/styles/main.css's --fig0..--fig3 tokens use — so a player's figure key
// always resolves to the same art and colour everywhere.
//
// Each figure ships three ways, all viewBox-aligned so they drop in at any
// size: a full body (160x200, its own baked-in ground-shadow ellipse as the
// first shape), a round token (64x64: colour disc + white inner ring + face,
// for Tok.jsx), and a one-colour silhouette (currentColor, unused today but
// exported for when something needs one).
//
// The `-full-noshadow` variants are the same full-body art with that first
// ground-shadow ellipse removed, so Figure.jsx can give `shadow={false}` an
// honest meaning instead of leaving a shadow the CSS can no longer strip.

import fig0Full from "../Images/figures/imp-full.svg";
import fig1Full from "../Images/figures/cyclops-full.svg";
import fig2Full from "../Images/figures/specter-full.svg";
import fig3Full from "../Images/figures/yeti-full.svg";

import fig0FullNoShadow from "../Images/figures/imp-full-noshadow.svg";
import fig1FullNoShadow from "../Images/figures/cyclops-full-noshadow.svg";
import fig2FullNoShadow from "../Images/figures/specter-full-noshadow.svg";
import fig3FullNoShadow from "../Images/figures/yeti-full-noshadow.svg";

import fig0Token from "../Images/figures/imp-token.svg";
import fig1Token from "../Images/figures/cyclops-token.svg";
import fig2Token from "../Images/figures/specter-token.svg";
import fig3Token from "../Images/figures/yeti-token.svg";

import fig0Silhouette from "../Images/figures/imp-silhouette.svg";
import fig1Silhouette from "../Images/figures/cyclops-silhouette.svg";
import fig2Silhouette from "../Images/figures/specter-silhouette.svg";
import fig3Silhouette from "../Images/figures/yeti-silhouette.svg";

export const FIGURE_NAME = {
  fig0: "Imp",
  fig1: "Cyclops",
  fig2: "Specter",
  fig3: "Yeti",
};

export const FIGURE_FULL = { fig0: fig0Full, fig1: fig1Full, fig2: fig2Full, fig3: fig3Full };

export const FIGURE_FULL_NOSHADOW = {
  fig0: fig0FullNoShadow,
  fig1: fig1FullNoShadow,
  fig2: fig2FullNoShadow,
  fig3: fig3FullNoShadow,
};

export const FIGURE_TOKEN = { fig0: fig0Token, fig1: fig1Token, fig2: fig2Token, fig3: fig3Token };

// Not rendered anywhere yet (board markers / loading screens / embossing are
// candidate future uses) — exported now so it's there when something needs
// it, keyed the same way as everything else here.
export const FIGURE_SILHOUETTE = {
  fig0: fig0Silhouette,
  fig1: fig1Silhouette,
  fig2: fig2Silhouette,
  fig3: fig3Silhouette,
};

// The full figure's own aspect ratio (viewBox 0 0 160 200), width:height.
export const FIGURE_ASPECT = 160 / 200;

// Compatibility alias: src/Board/TvTokens.jsx imports FIGURE_SIZE to derive
// the same width:height ratio for laying out board tokens. Kept so that file
// (owned by another agent) doesn't break; new value matches the real art's
// viewBox instead of the old PNGs' 250x337.
export const FIGURE_SIZE = { width: 160, height: 200 };
