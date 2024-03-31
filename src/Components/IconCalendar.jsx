import React, { Component } from "react";
import { Link } from "react-router-dom";

function IconCalendar({ data }) {
  return (
    <>
      <article className="">
        <div className="content-wrap">
          {data?.map(({ icon, value, time }) => (
            <>
              <div>
                <i className={"fa-regular " + icon}></i>
                <br />
                <span>{time}</span>
                <br />
                <span>{value}</span>
              </div>
              <br />
            </>
          ))}
        </div>
      </article>
    </>
  );
}
export { IconCalendar };
