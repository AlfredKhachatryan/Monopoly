import React, { Component } from "react";
import { Link } from "react-router-dom";
function Footer() {
  return (
    <>
      <footer className="footerDef">
        <div className="footerBlur"></div>
        <div className="footerCont ">
          <div>
            <div className="footerNav">
              <i className="fa-duotone fa-house duotoneColor"></i>
              <span>Home</span>
            </div>
          </div>
          <div>
            <div className="footerNav">
              <i className="fa-duotone fa-gavel duotoneColor"></i>
              <span>Auction</span>
            </div>
          </div>
          <div>
            <div className="footerNav">
              <i className="fa-duotone fa-users duotoneColor "></i>
              <span>Players</span>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
export { Footer };
