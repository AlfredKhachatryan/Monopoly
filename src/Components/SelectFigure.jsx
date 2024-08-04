import { useEffect, useState } from "react";
import { useRealtimeUpdates } from "../Hooks/supabase";

export function SelectFigure({ setParentFig, disabledFig }) {
  const [currentFig, setCurrentFig] = useState(null);

  useEffect(() => {
    setNames(() => {
      const updatedFigureDef = disabledFig
        .map((player) => player.figure)
        .reduce(
          (acc, figure) => {
            acc[figure] = true;
            return acc;
          },
          { ...figureDef }
        );
      return updatedFigureDef;
    });
  }, [disabledFig]);

  const figureDef = {
    fig0: false,
    fig1: false,
    fig2: false,
    fig3: false,
  };

  const [figureNames, setNames] = useState(figureDef);

  return (
    <div>
      <div
        style={{
          width: "100%",
          display: "flex",
        }}
      >
        {Object.entries(figureNames).map(([key, value]) => (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
            className={value && "disabledFig"}
            onClick={() => {
              if (!value) {
                setCurrentFig(key);
                if (setParentFig) {
                  setParentFig(key);
                }
              }
            }}
            key={key}
          >
            {key}
            <div
              className={`fig ${key}`}
              key={key}
              style={{ width: "2.5em", height: "3em", margin: "10px" }}
            ></div>
          </div>
        ))}
      </div>
      <br />
      <div style={{ textAlign: "center" }}>
        <h1>You Have Selected</h1>
        <h3>{currentFig ? currentFig : null}</h3>
      </div>
    </div>
  );
}
