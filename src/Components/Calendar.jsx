import React, { Component } from "react";
import { Link } from "react-router-dom";

function Calendar(data) {
  const { dayName, timeNumber, dateNumber, baseInfo, borderColor } = data;

  return (
    <>
      <div className="calendar-cont" style={{ borderColor: borderColor }}>
        <div className="calendar-item">
          <span>{dayName}</span>
          <br />
          <span style={{ fontSize: "32px" }}> {dateNumber}</span>
        </div>
        <div
          className="calendar-vertical-border"
          style={{ borderColor: borderColor }}
        ></div>
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
