import React, { useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Icon } from "./Icon";
function IconCalendar({ data }) {
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
