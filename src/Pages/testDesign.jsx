import React, { useEffect, useRef, useState, Component } from "react";
import { Link, useParams } from "react-router-dom";
import { Footer } from "../Components/Footer";
import { Header } from "../Components/Header";
import { IconCalendar } from "../Components/IconCalendar";
import { iconCalendarData } from "../mockData/testData/data";
import { CountDown } from "../Components/Timer";
import { Calendar } from "../Components/Calendar";
import medres from "../images/Medres.jpg";
import { Image } from "../Components/Image";
import { height } from "@fortawesome/free-solid-svg-icons/fa0";
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
      <Image
        src={medres} //ex. source of image !!important!!
        style={{ height: "100dvh" }} //ex. custom react styling
        img={true} //ex. img === true return img tag else div with background image
      ></Image>
      <article className=""></article>
      <br />
      <Footer backgroundColor={footerBackColor}></Footer>
    </div>
  );
}
export { TestDesign };
