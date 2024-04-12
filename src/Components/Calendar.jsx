import React, { Component } from "react";
import { Link } from "react-router-dom";

function Calendar(data) {
  const {
    dayName,
    timeNumber,
    dateNumber,
    baseInfo,
    borderColor,
    alt,
    altSize,
    color,
  } = data;
  const { dayNameSize, baseSize, monthSize, dayNumberSize, yearSize } = altSize;

  // dayName="Sunday"//ex. string:Sunday
  // dateNumber="12 24 24" // ex. string:12 24 24
  // timeNumber="16:30" // ex. string:16:30
  // baseInfo="At Bla Bla Bla " // ex. string:At This Resturant
  // borderColor=borderColor // ex. hex color:#aeb8fe
  // alt = false ///ex. boolean:true || false
  if (alt) {
    return (
      <>
        <div className="calendar-base calendar-alt-design" style={{ color: color }}>
          <div
            className="calender-item calendar-grid-1"
            style={{
              fontSize: dayNameSize || "initial",
              borderColor: borderColor,
            }}
          >
            {dayName}
          </div>
          <div
            className="calender-item calendar-grid-2"
            style={{
              fontSize: baseSize || "initial",
              borderColor: borderColor,
            }}
          >
            {baseInfo}
          </div>
          <div
            className="calender-item calendar-grid-3"
            style={{ fontSize: monthSize || "initial" }}
          >
            {new Date(dateNumber).toLocaleString("en", { month: "long" })}
          </div>
          <div
            className="calender-item calendar-grid-4"
            style={{ fontSize: dayNumberSize || "initial" }}
          >
            {new Date(dateNumber).getDate()}
          </div>
          <div
            className="calender-item calendar-grid-5"
            style={{ fontSize: yearSize || "initial" }}
          >
            {new Date(dateNumber).getFullYear()}
          </div>
        </div>
      </>
    );
  } else {
    return (
      <>
        <div className="calendar-base calendar-cont" style={{ borderColor: borderColor }}>
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
}
export { Calendar };
