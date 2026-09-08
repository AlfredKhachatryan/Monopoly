import { useEffect, useState } from "react";
import { useRealtimeUpdates } from "../Hooks/supabase";
import { m } from "./Motion";

export function SelectFigure({ setParentFig, disabledFig }) {
  const [currentFig, setCurrentFig] = useState(null);

  useEffect(() => {
    setNames(() => {
      const updatedFigureDef = disabledFig
        .map((player) => player.figure)
        .reduce(
          (acc, figure) => {
            acc[figure] = false;
            return acc;
          },
          { ...figureDef },
        );
      return updatedFigureDef;
    });
  }, [disabledFig]);

  const figureDef = {
    fig0: true,
    fig1: true,
    fig2: true,
    fig3: true,
  };

  const [figureNames, setNames] = useState(figureDef);

  function click({ value, key }) {
    if (value) {
      setCurrentFig(key);
      if (setParentFig) {
        setParentFig(key);
      }
    }
  }
  return (
    <div>
      <div
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        {Object.entries(figureNames).map(([key, value]) => (
          <m.div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
            className={!value ? "disabledFig" : null}
            onClick={() => {
              click({ value, key });
            }}
            key={key}
            whileTap={value ? { scale: 0.92 } : undefined}
          >
            <m.div
              className={`fig ${key}`}
              key={key}
              style={{
                width: "2.5em",
                height: "3em",
                margin: "10px",
                filter: "unset",
              }}
              animate={{
                scale: currentFig == key ? 1.1 : 1,
                y: currentFig == key ? -2 : 0,
              }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
            >
              <div
                className="selectedFig"
                style={
                  currentFig == key
                    ? {
                        backgroundColor: "#f5f5f560",
                      }
                    : {}
                }
              ></div>
            </m.div>
          </m.div>
        ))}
      </div>
      {/* <div style={{ textAlign: "center" }}>
        <h1>You Have Selected</h1>
        <h3>{currentFig ? currentFig : null}</h3>
      </div> */}
    </div>
  );
}
