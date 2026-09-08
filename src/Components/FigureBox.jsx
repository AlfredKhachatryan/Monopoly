import { m, AnimatePresence, pop } from "./Motion";

const FIGS = ["fig0", "fig1", "fig2", "fig3"];

// Renders the tokens whose flag is true in `show` ({ fig0: true, ... }).
export function FigureBox({ show, style }) {
  const figures = FIGS.filter((f) => show && show[f]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        ...style,
      }}
    >
      {/* tokens pop in / out when a player lands on or leaves this cell */}
      <AnimatePresence initial={false}>
        {figures.map((fig) => (
          <m.div
            className={`fig ${fig}`}
            key={fig}
            style={{ transformOrigin: "50% 100%" }}
            variants={pop}
            initial="hidden"
            animate="show"
            exit="exit"
          >
            <div
              className="selectedFig"
              style={{
                backgroundColor: "#f5f5f580",
              }}
            ></div>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
