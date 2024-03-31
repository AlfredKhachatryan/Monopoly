import React, { Component } from "react";
import { Link } from "react-router-dom";

function Calendar(data) {
  const { monthName, dayName, dayNumber, yearNumber } = data;
  return (
    <>
      <div className="calendar-wrap">
        <div className="calender-item calendar-grid-1">{monthName}</div>
        <div className="calender-item calendar-grid-2">{dayName}</div>
        <div className="calender-item calendar-grid-3">{dayNumber}</div>
        {/* <div className="calender-item calendar-grid-4">06</div>  */}
        <div className="calender-item calendar-grid-5">{yearNumber}</div>
      </div>
    </>
  );
}
export { Calendar };
