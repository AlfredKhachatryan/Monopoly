import React, { useEffect, useState, Component } from "react";
import { Link } from "react-router-dom";
import { Footer } from "../Components/Footer";
import { Header } from "../Components/Header";
import { IconCalendar } from "../Components/IconCalendar";
import { iconCalendarData } from "../mockData/testData/data";
import { CountDown } from "../Components/Timer";
import { Calendar } from "../Components/Calendar";
function Main() {
  return (
    <>
      <Header></Header>
      <article className="page-container">
        {/* <IconCalendar data={iconCalendarData}></IconCalendar> */}
        {/* <CountDown timeEnd={new Date('2 Apr 2024')}></CountDown> */}
        <Calendar
          monthName="August"
          dayName={"Sunday"}
          dayNumber={20}
          yearNumber={2024}
        ></Calendar>
      </article>
      <Footer></Footer>
    </>
  );
}
export { Main };
