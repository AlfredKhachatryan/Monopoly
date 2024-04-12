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
        <Calendar
          dayName={"Sunday"} //ex. string:Sunday
          dateNumber={"12 24 24"} // ex. string:12 24 24(mm,dd,yr)
          timeNumber={"16:30"} // ex. string:16:30
          baseInfo={"At 2 Pm"} // ex. string:At This Resturant
          borderColor={borderColor} // ex. string:#aeb8fe
          alt={true}
          altSize={{
            dayNameSize: "24px",
            baseSize: "24px",
            monthSize: "20px",
            dayNumberSize: "36px",
            yearSize: "20px",
          }}
          color={"#fff"}
        />
        <br />
      </article>
      <br />
      <Footer backgroundColor={footerBackColor} />
    </div>
  );
}
export { Test };
