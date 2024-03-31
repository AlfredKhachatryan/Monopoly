import React, { useEffect, useState, Component } from "react";
import { Link } from "react-router-dom";
import { Footer } from "../Components/Footer";
import { Header } from "../Components/Header";
import { IconCalendar } from "../Components/IconCalendar";
import { iconCalendarData } from "../mockData/testData/data";
import { CountDown } from "../Components/Timer";
function Main() {
  return (
    <>
      <Header></Header>
      <article className="page-container">
        <IconCalendar data={iconCalendarData}></IconCalendar>
        <CountDown timeEnd={new Date('2 Apr 2024')}></CountDown>
      </article>
      <Footer></Footer>
    </>
  );
}
export { Main };
