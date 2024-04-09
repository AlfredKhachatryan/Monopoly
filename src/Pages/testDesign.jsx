import React, { useEffect, useRef, useState, Component } from "react";
import { Link, useParams } from "react-router-dom";
import { Footer } from "../Components/Footer";
import { Header } from "../Components/Header";
import { IconCalendar } from "../Components/IconCalendar";
import { iconCalendarData } from "../mockData/testData/data";
import { CountDown } from "../Components/Timer";
import { Calendar } from "../Components/Calendar";
import medres from "../images/Medres.jpg";
const backgroundColor = "";
const footerBackColor = "#aeb8fe";
const borderColor = "#aeb8fe";
const textColor = "#000";

const mainContStyle = {
  backgroundColor: backgroundColor,
  color: textColor,
  fontWeight: 400,
//   backgroundImage: `url(${medres})`,
  backgroundPosition: "center",
  backgroundSize: "cover",
  backgroundRepeat: "no-repeat",
};

{
  /* <CountDown timeEnd={new Date('6 Apr 2024')}></CountDown> */
}
function TestDesign() {
  return (
    <div className="main-cont" style={mainContStyle}>
      <br />
      {/* <article className="page-container">
      </article> */}
      <article className=""></article>
      <br />
      <Footer backgroundColor={footerBackColor}></Footer>
    </div>
  );
}
export { TestDesign };
