// The Light / Dark / System control, in two sizes (spec §10).
//
// One component for both screens on purpose: the phone's Game sheet and the TV
// board are the same three choices writing the same localStorage key through
// the same store (src/Hooks/useTheme.js), so a second implementation would only
// be a second thing to keep in step.
//
//   variant="sheet"  the phone. Full width, three labelled segments, sized and
//                    weighted like the sheet's own .settingRow / .logToggle.
//   variant="tv"     the board. Icons only, parked in the letterbox corner and
//                    held at low opacity until somebody actually goes for it —
//                    a room watching a game does not want a settings widget
//                    glowing at them for three hours.
//
// System is not a third look, it is "ask the OS", so its button says which way
// the OS is currently pointing rather than pretending to be a colour of its
// own.

import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_LABELS, THEME_MODES, useTheme } from "../Hooks/useTheme";
import s from "./themeControl.module.css";

const ICONS = { light: Sun, dark: Moon, system: Monitor };

export default function ThemeControl({ variant = "sheet", label = "Theme" }) {
  const { theme, resolved, setTheme } = useTheme();
  const compact = variant === "tv";

  return (
    <div
      className={`${s.seg} ${compact ? s.tv : s.sheet}`}
      role="radiogroup"
      aria-label={label}
    >
      {THEME_MODES.map((mode) => {
        const Icon = ICONS[mode];
        const on = theme === mode;
        // "System (currently dark)" — the only one of the three whose name does
        // not tell you what you are going to get.
        const name =
          mode === "system"
            ? `${THEME_LABELS.system} (currently ${resolved})`
            : THEME_LABELS[mode];
        return (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={on}
            className={s.opt}
            onClick={() => setTheme(mode)}
            title={name}
            aria-label={compact ? name : undefined}
          >
            <Icon size={compact ? 22 : 17} aria-hidden="true" />
            {compact ? null : <span className={s.lab}>{THEME_LABELS[mode]}</span>}
          </button>
        );
      })}
    </div>
  );
}
