import React, { Component } from "react";
import { Link } from "react-router-dom";

function Footer({ backgroundColor }) {
  return (
    <>
      <footer
        style={{
          backgroundColor: backgroundColor,
        }}
        className=""
      >
        <div className="content-wrap">
          <span className="footer-span">&nbsp;MagicMemo</span>
        </div>
      </footer>
    </>
  );
}
export { Footer };
