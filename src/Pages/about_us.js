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

function Main() {
  return (
    <div className="main-cont" style={mainContStyle}>
      <br />
      <article className="page-container">
        <br />
        <h3 className="mainText">
          LEDIGEY
          <span className="span-divider">and</span>
          VAZGENUSH
        </h3>
        <br />
        <Calendar
          dayName={"Sunday"} //ex. string:Sunday
          dateNumber={"24.12.24"} // ex. string:24.12.24
          timeNumber={"16:30"} // ex. string:16:30
          baseInfo={"At Bla Bla Bla "} // ex. string:At This Resturant
          borderColor={borderColor} // ex. string:#aeb8fe
        />
        <br />
        <h5>
          request the honor <br />
          of your presence <br />
          at their matrelog
        </h5>
        <b8r />
        <IconCalendar
          data={iconCalendarData} //ex. Object. For More info check component
          loop={true} //ex. boolean:true || false
        />
        <br />
        <CountDown
          timeEnd={new Date("12 Apr 2024")} //ex Date : new Date("12 Apr 2024"
        />
      </article>
      <br />
      <Footer backgroundColor={footerBackColor} />
    </div>
  );
}
export { Main };
