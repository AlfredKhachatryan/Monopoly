// Temporary visual harness for TokenLayer (no Supabase). Opened via /harness.html
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import "../CDN/bootstrap.min.css";
import "../styles/main.css";
import { initialState } from "../Hooks/baseState";
import CardRenderer from "../Components/CardRenderer";
import { TokenLayer } from "../Components/TokenLayer";
import { MotionProvider } from "../Components/Motion";
import { useWalkingTokens } from "../Hooks/useWalkingTokens";

function Harness() {
  const [pos, setPos] = useState(() => {
    const p = initialState();
    p[5].fig0 = true;
    p[5].fig1 = true;
    p[38].fig2 = true;
    return p;
  });
  const shown = useWalkingTokens(pos);
  window.__shown = shown;

  useEffect(() => {
    const t = setTimeout(() => {
      setPos((p) => ({
        ...p,
        5: { ...p[5], fig0: false },
        12: { ...p[12], fig0: true },
        38: { ...p[38], fig2: false },
        3: { ...p[3], fig2: true },
      }));
    }, 1500);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <div className="boardBG"></div>
      <div className="cont">
        <div className="parent">
          <div className="innerBoard"></div>
          <CardRenderer pos={pos} showTokens={false}></CardRenderer>
          <TokenLayer shown={shown} />
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <MotionProvider>
    <Harness />
  </MotionProvider>,
);
