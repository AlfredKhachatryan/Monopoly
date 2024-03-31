import React, { Component } from "react";
import { Link } from "react-router-dom";
import Countdown from "react-countdown";
function CountDown({ timeEnd }) {
  const renderer = ({ days,hours, minutes, seconds, completed }) => {
    if (completed) {
      // Render a completed state
      return <span>Hello World!</span>;
    } else {
      // Render a countdown
      return (
        <>
          <span>{days}:{hours}:{minutes}:{seconds}</span>
        </>
      );
    }
  };
  return (
    <>
      <article className="">
        <div className="content-wrap">
          <Countdown date={timeEnd}/>
        </div>
      </article>
    </>
  );
}
export { CountDown };
