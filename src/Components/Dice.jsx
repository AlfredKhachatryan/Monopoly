import React, { useState, useEffect, useRef } from "react";
import "../styles/dice.css";
function DiceRoller({ click, setResult, setIsReveal }) {
  const prevSide = useRef();
  const [side, setSide] = useState(0);
  const [isFirstRoll, setIsFirstRoll] = useState(true);
  const [resultText, setResultText] = useState("Click to roll the dice!");

  useEffect(() => {
    prevSide.current = side;
  }, [side]);

  const uniformDis = () => {
    const fractNum = Math.floor(Math.random() * 6) + 1;
    let result;
    if (fractNum >= 0 && fractNum < 1) {
      result = 1;
    } else if (fractNum >= 1 && fractNum <= 2) {
      result = 2;
    } else if (fractNum > 2 && fractNum <= 3) {
      result = 3;
    } else if (fractNum > 3 && fractNum <= 4) {
      result = 4;
    } else if (fractNum > 4 && fractNum <= 5) {
      result = 5;
    } else {
      result = 6;
    }
    return result;
  };

  const rollDice = () => {
    const result = uniformDis();
    if (prevSide.current == result) {
      setSide(result - 1);
      setTimeout(() => {
        setSide(result);
      }, 500);
    } else {
      setSide(result);
    }
    setResult(result);
    setResultText(`You've got ${result}`);
  };
  useEffect(() => {
    if (click > 0) {
      rollDice();
    }
  }, [click]);
  return (
    <div>
      <div id="dice" data-side={side} className={isFirstRoll ? "" : "reRoll"}>
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

export default DiceRoller;
