// The eight player figures (Imp, Cyclops, Specter, Yeti, Bat, Mummy, Octo,
// Slime) — flat monster SVGs from design-reference/figures-manual.html,
// replacing the old mon_*.png characters. fig0..fig7 map to
// Imp/Cyclops/Specter/Yeti/Bat/Mummy/Octo/Slime — the same mapping
// FIG_COLORS in src/Hooks/rules.js uses — so a player's figure key always
// resolves to the same art and colour everywhere.
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
import fig4Full from "../Images/figures/bat-full.svg";
import fig5Full from "../Images/figures/mummy-full.svg";
import fig6Full from "../Images/figures/octo-full.svg";
import fig7Full from "../Images/figures/slime-full.svg";

import fig0FullNoShadow from "../Images/figures/imp-full-noshadow.svg";
import fig1FullNoShadow from "../Images/figures/cyclops-full-noshadow.svg";
import fig2FullNoShadow from "../Images/figures/specter-full-noshadow.svg";
import fig3FullNoShadow from "../Images/figures/yeti-full-noshadow.svg";
import fig4FullNoShadow from "../Images/figures/bat-full-noshadow.svg";
import fig5FullNoShadow from "../Images/figures/mummy-full-noshadow.svg";
import fig6FullNoShadow from "../Images/figures/octo-full-noshadow.svg";
import fig7FullNoShadow from "../Images/figures/slime-full-noshadow.svg";

import fig0Token from "../Images/figures/imp-token.svg";
import fig1Token from "../Images/figures/cyclops-token.svg";
import fig2Token from "../Images/figures/specter-token.svg";
import fig3Token from "../Images/figures/yeti-token.svg";
import fig4Token from "../Images/figures/bat-token.svg";
import fig5Token from "../Images/figures/mummy-token.svg";
import fig6Token from "../Images/figures/octo-token.svg";
import fig7Token from "../Images/figures/slime-token.svg";

import fig0Silhouette from "../Images/figures/imp-silhouette.svg";
import fig1Silhouette from "../Images/figures/cyclops-silhouette.svg";
import fig2Silhouette from "../Images/figures/specter-silhouette.svg";
import fig3Silhouette from "../Images/figures/yeti-silhouette.svg";
import fig4Silhouette from "../Images/figures/bat-silhouette.svg";
import fig5Silhouette from "../Images/figures/mummy-silhouette.svg";
import fig6Silhouette from "../Images/figures/octo-silhouette.svg";
import fig7Silhouette from "../Images/figures/slime-silhouette.svg";

export const FIGURE_NAME = {
  fig0: "Imp",
  fig1: "Cyclops",
  fig2: "Specter",
  fig3: "Yeti",
  fig4: "Bat",
  fig5: "Mummy",
  fig6: "Octo",
  fig7: "Slime",
};

export const FIGURE_FULL = {
  fig0: fig0Full,
  fig1: fig1Full,
  fig2: fig2Full,
  fig3: fig3Full,
  fig4: fig4Full,
  fig5: fig5Full,
  fig6: fig6Full,
  fig7: fig7Full,
};

export const FIGURE_FULL_NOSHADOW = {
  fig0: fig0FullNoShadow,
  fig1: fig1FullNoShadow,
  fig2: fig2FullNoShadow,
  fig3: fig3FullNoShadow,
  fig4: fig4FullNoShadow,
  fig5: fig5FullNoShadow,
  fig6: fig6FullNoShadow,
  fig7: fig7FullNoShadow,
};

export const FIGURE_TOKEN = {
  fig0: fig0Token,
  fig1: fig1Token,
  fig2: fig2Token,
  fig3: fig3Token,
  fig4: fig4Token,
  fig5: fig5Token,
  fig6: fig6Token,
  fig7: fig7Token,
};

// Not rendered anywhere yet (board markers / loading screens / embossing are
// candidate future uses) — exported now so it's there when something needs
// it, keyed the same way as everything else here.
export const FIGURE_SILHOUETTE = {
  fig0: fig0Silhouette,
  fig1: fig1Silhouette,
  fig2: fig2Silhouette,
  fig3: fig3Silhouette,
  fig4: fig4Silhouette,
  fig5: fig5Silhouette,
  fig6: fig6Silhouette,
  fig7: fig7Silhouette,
};

// The full figure's own aspect ratio (viewBox 0 0 160 200), width:height.
export const FIGURE_ASPECT = 160 / 200;

// Compatibility alias: src/Board/TvTokens.jsx imports FIGURE_SIZE to derive
// the same width:height ratio for laying out board tokens. Kept so that file
// (owned by another agent) doesn't break; new value matches the real art's
// viewBox instead of the old PNGs' 250x337.
export const FIGURE_SIZE = { width: 160, height: 200 };
