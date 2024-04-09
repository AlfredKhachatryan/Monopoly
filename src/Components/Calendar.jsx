import React, { Component } from "react";
import { Link } from "react-router-dom";

function Calendar(data) {
  const { dayName, timeNumber, dateNumber, baseInfo, borderColor } = data;
  // dayName="Sunday"//ex. string:Sunday
  // dateNumber="24.12.24" // ex. string:24.12.24
  // timeNumber="16:30" // ex. string:16:30
  // baseInfo="At Bla Bla Bla " // ex. string:At This Resturant
  // borderColor=borderColor // ex. hex color:#aeb8fe

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
