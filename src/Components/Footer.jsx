import React, { Component } from "react";
import { Link } from "react-router-dom";
import { m } from "./Motion";
function Footer() {
  return (
    <>
      <footer className="footerDef">
        <div className="footerBlur"></div>
        <div className="footerCont ">
          <div>
            <m.div className="footerNav" whileTap={{ scale: 0.92 }}>
              <i className="fa-duotone fa-house duotoneColor"></i>
              <span>Home</span>
            </m.div>
          </div>
          <div>
            <m.div className="footerNav" whileTap={{ scale: 0.92 }}>
              <i className="fa-duotone fa-gavel duotoneColor"></i>
              <span>Auction</span>
            </m.div>
          </div>
          <div>
            <m.div className="footerNav" whileTap={{ scale: 0.92 }}>
              <i className="fa-duotone fa-users duotoneColor "></i>
              <span>Players</span>
            </m.div>
          </div>
        </div>
      </footer>
    </>
  );
}
export { Footer };
