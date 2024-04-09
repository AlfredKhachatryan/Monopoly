import React, { useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";
function IconCalendar({ data, loop }) {
  // {
  //   icon: JSON : church, get from lordicon.com
  //   time: string: "14:00",
  //   value: string: "Church Bla Bla",
  //   primary: string:"#aeb8fe", primary color of icon
  //   secondary: string:"#1d1b29", secondary color of icon
  // }
  return (
    <>
      <article className="">
        <div className="content-wrap">
          {data?.map(({ icon, value, time, primary, secondary }, i) => (
            <>
              <div className="iconContainer">
                <div>
                  <Icon
                    size={64}
                    icon={icon}
                    primary={primary}
                    secondary={secondary}
                    loop={loop}
                  ></Icon>
                </div>
                <span>{time}</span>
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
