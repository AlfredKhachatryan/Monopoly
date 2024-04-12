import React, { useEffect, useRef, useState, Component } from "react";
import { Link } from "react-router-dom";
import { Footer } from "../Components/Footer";
import { Header } from "../Components/Header";
import { IconCalendar } from "../Components/IconCalendar";
import { CountDown } from "../Components/Timer";
import { Calendar } from "../Components/Calendar";

import champagne from "../CDN/LordIcon/2237-champagne-flutes.json";
import church from "../CDN/LordIcon/482-church.json";
import plate from "../CDN/LordIcon/520-plate-fork-knife";

import medres from "../images/Medres.jpg";

const backgroundColor = "#1d1b29";
const footerBackColor = "#aeb8fe";
const borderColor = "#aeb8fe";
const textColor = "#fff";

const iconCalendarData = [
  {
    icon: church,
    time: "14:00",
    value: "Church Bla Bla",
    primary: "#aeb8fe",
    secondary: "#fff",
    iconSize: 128,
    timeSize: 32,
    textSize: 20,
  },
  {
    icon: champagne,
    time: "16:00",
    value: "Restaurant Bla Bla",
    primary: "#aeb8fe",
    secondary: "#fff",
  },
  {
    icon: plate,
    time: "18:00",
    value: "Restaurant Bla Bla",
    primary: "#aeb8fe",
    secondary: "#fff",
  },
];

const mainContStyle = {
  backgroundColor: backgroundColor,
  color: textColor,
  fontWeight: 400,
  //   backgroundImage: `url(${medres})`,
  backgroundPosition: "center",
  backgroundSize: "cover",
  backgroundRepeat: "no-repeat",
};

function Test() {
  return (
    <div className="main-cont" style={mainContStyle}>
      <br />
      <article>
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
        <br />
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
export { Test };
