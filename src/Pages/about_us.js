import React, { useEffect, useRef, useState, Component } from "react";
import { Link } from "react-router-dom";
import { Footer } from "../Components/Footer";
import { Header } from "../Components/Header";
import { IconCalendar } from "../Components/IconCalendar";
import { iconCalendarData } from "../mockData/testData/data";
import { CountDown } from "../Components/Timer";
import { Calendar } from "../Components/Calendar";
import medres from "../images/Medres.jpg";

const backgroundColor = "#1d1b29";
const footerBackColor = "#aeb8fe";
const borderColor = "#aeb8fe";
const textColor = "#000";

const mainContStyle = {
  backgroundColor: backgroundColor,
  color: textColor,
  fontWeight: 400,
  backgroundImage: `url(${medres})`,
  backgroundPosition: "center",
  backgroundSize: "cover",
  backgroundRepeat: "no-repeat",
};

{
  /* <CountDown timeEnd={new Date('6 Apr 2024')}></CountDown> */
}
function Main() {
  return (
    <div className="main-cont" style={mainContStyle}>
      <br />
      <article className="page-container">
        <h5>
          WITH GREAT <br /> JOY AND PRIDE
        </h5>

        <br />

        <Calendar
          dayName={"Sunday"} //ex. Sunday
          dateNumber={"24.12.24"} // ex. 24.12.24
          timeNumber={"16:30"} // ex. 16:30
          baseInfo={"At Bla Bla Bla "} // ex. At This Resturant
          borderColor={borderColor} // ex. #aeb8fe
        ></Calendar>

        <br />

        <h3>
          VAZGENUSH
          <span className="span-divider">and</span>
          LEDIGEY
        </h3>

        <br />

        <h5>
          request the honor <br />
          of your presence <br />
          at their matrelog
        </h5>
        <IconCalendar data={iconCalendarData}></IconCalendar>
      </article>
      <Footer backgroundColor={footerBackColor}></Footer>
    </div>
  );
}
export { Main };
