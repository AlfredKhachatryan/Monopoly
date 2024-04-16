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
import Carousel from "react-multi-carousel";
import "react-multi-carousel/lib/styles.css";
const backgroundColor = "#1d1b29";
const footerBackColor = "#aeb8fe";
const borderColor = "#aeb8fe";
const textColor = "#fff";

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
  const responsive = {
    superLargeDesktop: {
      // the naming can be any, depends on you.
      breakpoint: { max: 4000, min: 3000 },
      items: 5,
    },
    desktop: {
      breakpoint: { max: 3000, min: 1024 },
      items: 3,
    },
    tablet: {
      breakpoint: { max: 1024, min: 464 },
      items: 2,
    },
    mobile: {
      breakpoint: { max: 464, min: 0 },
      items: 1,
    },
  };

  return (
    <div className="main-cont" style={mainContStyle}>
      <br />
      {/* <article className="page-container">
      </article> */}
      {/* <Image
        src={medres} //ex. source of image !!important!!
        style={{ height: "100dvh" }} //ex. custom react styling
        img={true} //ex. img === true return img tag else div with background image
      ></Image> */}
      <article className="">
        <Carousel
          swipeable={false}
          draggable={false}
          showDots={true}
          arrows={false}
          responsive={responsive}
          infinite={true}
          autoPlay={true}
          autoPlaySpeed={3000}
          keyBoardControl={true}
          customTransition="all .5"
          transitionDuration={500}
          containerClass="carousel-container"
          dotListClass="custom-dot-list-style"
          itemClass="carousel-inner-item"
        >
          <div>Item 1</div>
          <div>Item 2</div>
          <div>Item 3</div>
          <div>Item 4</div>
        </Carousel>
      </article>
      <br />
      <Footer backgroundColor={footerBackColor}></Footer>
    </div>
  );
}
export { TestDesign };
