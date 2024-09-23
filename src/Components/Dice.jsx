import React, { useState, useEffect, useRef } from "react";
import "../styles/dice.css";
function DiceRoller({ click, setResult, setIsReveal }) {
  const prevSide = useRef();
  const [side1, setSide1] = useState(0);
  const [side2, setSide2] = useState(0);
  const [isFirstRoll, setIsFirstRoll] = useState(true);

  useEffect(() => {
    prevSide.current = side1;
  }, [side1]);

  const uniformDis = () => {
    return Math.floor(Math.random() * 6) + 1;
  };

  const rollDice = () => {
    const result1 = uniformDis();
    const result2 = uniformDis();

    // For the first die
    if (prevSide.current === result1) {
      setSide1(result1 - 1);
      setTimeout(() => {
        setSide1(result1);
      }, 500);
    } else {
      setSide1(result1);
    }

    // For the second die
    setSide2(result2);

    // Pass the sum of both dice rolls to the parent component
    setResult(result1 + result2);
  };

  useEffect(() => {
    if (click > 0) {
      rollDice();
    }
  }, [click]);

  return (
    <>
      {/* First Dice */}
      <div>
        <div
          id="dice"
          data-side={side1}
          className={isFirstRoll ? "" : "reRoll"}
        >
          {[...Array(6)].map((_, i) => (
            <div key={i} className={`sides side-${i + 1}`}>
              {[...Array(i + 1)].map((_, j) => (
                <span key={j} className={`dot dot-${j + 1}`} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Second Dice */}
      <div>
        <div
          id="dice"
          data-side={side2}
          className={isFirstRoll ? "" : "reRoll"}
        >
          {[...Array(6)].map((_, i) => (
            <div key={i} className={`sides side-${i + 1}`}>
              {[...Array(i + 1)].map((_, j) => (
                <span key={j} className={`dot dot-${j + 1}`} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default DiceRoller;
