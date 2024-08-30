import { useState, useEffect } from "react";

export function FigureBox({ show, style }) {
  console.log(show);
  const figureDef = {
    fig0: false,
    fig1: false,
    fig2: false,
    fig3: false,
  };

  const [figureNames, setNames] = useState(
    Object.keys(figureDef)?.filter((key) => figureDef[key])
  );

  useEffect(() => {
    setNames(Object.keys(show).filter((key) => show[key]));
  }, [show]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        ...style,
      }}
    >
      {Object.entries(figureNames).map(
        (e) => e[0] && <div className={`fig ${e[1]}`} key={e[0]}></div>
      )}
    </div>
  );
}
