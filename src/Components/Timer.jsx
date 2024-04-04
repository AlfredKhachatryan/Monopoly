import React, { Component } from "react";
import { Link } from "react-router-dom";
import Countdown, { zeroPad } from "react-countdown";
function CountDown({ timeEnd }) {
  const renderer = ({ days, hours, minutes, seconds, completed }) => {
    if (completed) {
      // Render a completed state
      return <span>The event is over!</span>;
    } else {
      // Render a countdown
      return (
        <>
          <div className="countdown-cont">
            <span className="countdown-item-cont">
              {zeroPad(days)}
              <br />
              Days
            </span> :
            <span className="countdown-item-cont">
              {zeroPad(hours)}
              <br />
              Hours
            </span> :
            <span className="countdown-item-cont">
              {minutes}
              <br />
              Minutes
            </span> :
            <span className="countdown-item-cont">
              {seconds}
              <br />
              Seconds
            </span>
          </div>
        </>
      );
    }
  };
  return (
    <>
      <article className="">
        <div className="content-wrap">
          <Countdown date={timeEnd} renderer={renderer} />
        </div>
      </article>
    </>
  );
}
export { CountDown };
