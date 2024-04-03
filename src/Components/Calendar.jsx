import React, { Component } from "react";
import { Link } from "react-router-dom";

function Calendar(data) {
  const { dayName, timeNumber, dateNumber, baseInfo } = data;
  return (
    <>
      <div className="calendar-cont">
        <div className="calendar-item">
          <span>{dayName}</span>
          <br />
          <span style={{ fontSize: "32px" }}> {dateNumber}</span>
        </div>
        <div className="calendar-vertical-border"></div>
        <div className="calendar-item">
          <span style={{ fontSize: "32px" }}>{timeNumber}</span>
          <br />
          <span>{baseInfo}</span>
        </div>
      </div>
    </>
  );
}
export { Calendar };
