import { useState, useEffect, useRef } from "react";
import "../styles/dice.css";

// One 3D die. Kept outside DiceRoller so React reuses the same DOM node and
// the CSS transform transition can play between faces.
function Die({ side }) {
  return (
    <div>
      <div id="dice" data-side={side}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className={`sides side-${i + 1}`}>
            {[...Array(i + 1)].map((_, j) => (
              <span key={j} className={`dot dot-${j + 1}`} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Two dice. The values come from the server (game.dice); a new `rollId`
// plays the roll animation towards `values`.
function DiceRoller({ values = [1, 1], rollId = 0 }) {
  const [side1, setSide1] = useState(0);
  const [side2, setSide2] = useState(0);
  const lastRoll = useRef(0);
  const timer = useRef(null);

  useEffect(() => {
    if (!rollId || rollId === lastRoll.current) return;
    lastRoll.current = rollId;
    const [r1, r2] = values;

    // The CSS transition only plays when data-side changes, so a die that
    // shows the same face twice is nudged to a neighbour face first.
    const nudge = (v) => (v % 6) + 1;
    setSide1((s) => (s === r1 ? nudge(r1) : r1));
    setSide2((s) => (s === r2 ? nudge(r2) : r2));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSide1(r1);
      setSide2(r2);
    }, 500);
  }, [rollId, values]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <>
      <Die side={side1} />
      <Die side={side2} />
    </>
  );
}

export default DiceRoller;
