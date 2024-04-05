import React, { useEffect, useRef, useState, Component } from "react";
import { Link } from "react-router-dom";
import { Footer } from "../Components/Footer";
import { Header } from "../Components/Header";
import { IconCalendar } from "../Components/IconCalendar";
import { iconCalendarData } from "../mockData/testData/data";
import { CountDown } from "../Components/Timer";
import { Calendar } from "../Components/Calendar";
import { Player } from "@lordicon/react";
const backgroundColor = "#1d1b29";
const footerBackColor = "#aeb8fe";
const borderColor = "#aeb8fe";
const textColor = "#fff";

function Main() {
  return (
    <body
      style={{
        backgroundColor: backgroundColor,
        color: textColor,
      }}
    >
      {/* <Header></Header> */}
      <article className="page-container">
        <IconCalendar data={iconCalendarData}></IconCalendar>
        {/* <CountDown timeEnd={new Date('6 Apr 2024')}></CountDown> */}
        <Calendar
          dayName={"Sunday"} //ex. Sunday
          dateNumber={"24.12.24"} // ex. 24.12.24
          timeNumber={"16:30"} // ex. 16:30
          baseInfo={"At Bla Bla Bla "} // ex. At This Resturant
          borderColor={borderColor} // ex. #aeb8fe
        ></Calendar>
      </article>
      <Footer backgroundColor={footerBackColor}></Footer>
    </body>
  );
}
export { Main };
