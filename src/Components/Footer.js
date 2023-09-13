import React, {Component} from 'react';
// import closeIcon from "../assets/icons/close.svg";
import {Link} from "react-router-dom";
import * as ReactDOM from 'react-dom';

function Footer() {
  return (
    <>

      <footer className="footer widget-footer clearfix">
    <div className="first-footer ttm-bgcolor-skincolor">
      <div className="container">
        <div className="row">
          <div className="widget-area col-xs-12 col-sm-12 col-md-6 col-lg-4">
            <aside className="widget widget-text">
              {/*featured-icon-box*/}
              <div className="featured-icon-box iconalign-before-heading">
                <div className="featured-icon">
                  <div className="ttm-icon ttm-icon_element-border ttm-icon_element-color-white ttm-icon_element-size-sm ttm-icon_element-style-square">
                    <i className="fa fa-phone" />
                  </div>
                </div>
                <div className="featured-title">
                  <h5>+123 456 78910 / 11</h5>
                  <h4>Have a question? call us now</h4>
                </div>
              </div>
              {/* featured-icon-box end*/}
            </aside>
          </div>
          <div className="widget-area col-xs-12 col-sm-12 col-md-6 col-lg-4">
            <aside className="widget widget-text">
              {/*featured-icon-box*/}
              <div className="featured-icon-box iconalign-before-heading">
                <div className="featured-icon">
                  <div className="ttm-icon ttm-icon_element-border ttm-icon_element-color-white ttm-icon_element-size-sm ttm-icon_element-style-square">
                    <i className="fa fa-envelope-o" />
                  </div>
                </div>
                <div className="featured-title">
                  <h5>info@domainname.com</h5>
                  <h4>Need support? Drop us an email</h4>
                </div>
              </div>
              {/* featured-icon-box end*/}
            </aside>
          </div>
          <div className="widget-area col-xs-12 col-sm-12 col-md-6 col-lg-4">
            <aside className="widget widget-text">
              {/*featured-icon-box*/}
              <div className="featured-icon-box iconalign-before-heading">
                <div className="featured-icon">
                  <div className="ttm-icon ttm-icon_element-border ttm-icon_element-color-white ttm-icon_element-size-sm ttm-icon_element-style-square">
                    <i className="fa fa-clock-o" />
                  </div>
                </div>
                <div className="featured-title">
                  <h5>Mon – Sat 07:00 – 21:00</h5>
                  <h4>We are open on</h4>
                </div>
              </div>
              {/* featured-icon-box end*/}
            </aside>
          </div>
        </div>
      </div>
    </div>
    <div className="bottom-footer-text ttm-textcolor-white">
      <div className="container">
        <div className="row copyright">
          <div className="col-md-12">
            <span>
              Copyright © 2019 Delmont Theme by{" "}
              <a href="../../index.html">ThemetechMount</a>
            </span>
          </div>
          <div className="col-md-12">
            <ul id="menu-footer-menu" className="footer-nav-menu">
              <li>
                <a href="aboutus-1.html#">About Us</a>
              </li>
              <li>
                <a href="aboutus-1.html#">Services</a>
              </li>
              <li>
                <a href="aboutus-1.html#">Privacy</a>
              </li>
            </ul>
          </div>
          <div className="col-md-12">
            <span>
              Imported to React by{" "}
              <a href="https://www.linkedin.com/in/alfred-khachatryan-3b6b0b253/">NeonCatRider</a>
            </span>
          </div>
        </div>
      </div>
    </div>
  </footer>
    <a id="totop" href="aboutus-1.html#top">
      <i className="fa fa-angle-up" />
    </a>
  </>
        )
}
export {
  Footer
};
