import { useState, useEffect } from "react";

export function FigureBox({ show }) {
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
      }}
    >
      {!show
        ? null
        : figureNames?.map((e) => <div className={`fig ${e}`} key={e}></div>)}
    </div>
  );
}
