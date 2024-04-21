import React, {useEffect, Component} from 'react';
// import closeIcon from "../assets/icons/close.svg";
import {Link} from "react-router-dom";
import * as ReactDOM from 'react-dom';
import {dynamic} from '../dynamic.js'
function Header(props) {
  //   useEffect(()=>{
  //     let navbar = document.getElementsByClassName("bottomNavBar")[0];
  //     let navOffset = navbar.offsetTop;
  //     window.addEventListener("scroll", () => {
  //       (window.scrollY >= navOffset) ? navbar.classList.add("sticky") : navbar.classList.remove("sticky")
  //     });
  // }, [])
  // var headerCards = [
  //   {id: 1,title: "Number 1 Hospital",body:'In United States',class:'cardsLogoHos'},
  //   {id: 2,title: "Personal Cabinet",body:'Qualified Staff',class:'cardsLogoDoc'},
  //   {id: 3,title: "Get Result Online",body:'Satisfied Patients',class:'cardsLogoLike'},
  // ]
  useEffect(() => {
    const script = document.createElement('script');
    script.src = "../revolution/js/slider.js";
    script.async = true;
    const script1 = document.createElement('script');
    script1.src = "../js/main.js";
    script1.async = true;
    // const script2 = document.createElement('script');
    // script2.src = "../js/jquery.min.js";
    // script2.async = true;
    document.body.appendChild(script);
    document.body.appendChild(script1);
    window.scrollTo(0, 0);
  return () => {
      document.body.removeChild(script);
      document.body.removeChild(script1);
    }
  }, []);
  return (<header id="masthead" className="header ttm-header-style-classicinfo">
    {/* ttm-fbar-main-w */}
    <div className="ttm-fbar-main-w ttm-fbar-position-right">
      <div className="ttm-fbar-box-w ttm-textcolor-white ttm-bgcolor-darkgrey ttm-bg ttm-bgimage-yes">
        <span className="ttm-fbar-btn">
          <a href="javascript:void(0)" className="ttm-fbar-btn-link">
            <span className="ttm-fbar-open-icon">
              <i className="fa fa-bars"/>
            </span>
            <span className="ttm-fbar-close-icon">
              <i className="fa fa-times"/>
            </span>
          </a>
        </span>
        <div className="ttm-fbar-bg-layer ttm-bg-layer"/> {/* ttm-fbar-content-wrapper */}
        <div className="ttm-fbar-content-wrapper">
          <div className="ttm-fbar-box">
            {/* ttm_widget_team_search-2 */}
            <aside id="ttm_widget_team_search-2" className="widget-even widget-4 widget ttm_widget_team_search">
              <div className="team-search-form-w">
                <form method="get" className="team-search-form " action="index.html#">
                  <div className="ttm-team-search-title">
                    <h2>GET AN APPOINTMENT!</h2>
                  </div>
                  <div className="team-search-form-before-text">
                    We provide the most full medical services, so every person could have the opportunity
                  </div>
                  <div className="ttm-fbar-input">
                    <div className="search_field by_name">
                      <i className="fa fa-user-md"/>
                      <input type="text" placeholder="Full Name" name="s" defaultValue=""/>
                    </div>
                  </div>
                  <div className="ttm-fbar-input">
                    <div className="search_field by_name">
                      <i className="fa fa-envelope-o"/>
                      <input type="text" placeholder="eMail" name="s" defaultValue=""/>
                    </div>
                  </div>
                  <div className="ttm-fbar-input">
                    <div className="search_field by_name">
                      <i className="fa fa-phone"/>
                      <input type="text" placeholder="Phone Number" name="s" defaultValue=""/>
                    </div>
                  </div>
                  <div className="submit_field">
                    <button type="submit">GET AN APPOINTMENT</button>
                  </div>
                </form>
              </div>
            </aside>
            {/* ttm_widget_team_search-2 end */}
            {/* enhanced-text-widget */}
            <aside id="enhancedtextwidget-10" className="widget-odd widget-5 widget widget_text enhanced-text-widget">
              <h3 className="widget-title">Opening Hours:</h3>
              <div className="textwidget widget-text">
                These are our normal opening hours. When we are closed can be found here.
                <br/>
                <div className="ttm-pricelistbox-wrapper ">
                  <ul className="ttm-pricelist-block">
                    <li>
                      Monday - Saturday
                      <span className="service-price">8.30 – 17.00</span>
                    </li>
                    <li>
                      Sunday
                      <span className="service-price">
                        <strong>Closed</strong>
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </aside>
            {/* enhanced-text-widget end */}
            <aside id="enhancedtextwidget-11" className="widget-even widget-6 widget widget_text enhanced-text-widget">
              <div className="textwidget widget-text">
                <div className="featured-icon-box left-icon icon-align-top">
                  <div className="featured-icon">
                    <div className="ttm-icon ttm-icon_element-border ttm-icon_element-color-white ttm-icon_element-size-sm ttm-icon_element-style-square">
                      <i className="fa fa-phone"/>
                    </div>
                  </div>
                  <div className="featured-content">
                    <div className="featured-title">
                      <h5>+123 456 78910 / 11</h5>
                    </div>
                    <div className="featured-desc">
                      <p>Have a question? call us now</p>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
            {/* enhanced-text-widget end */}
          </div>
        </div>
        {/* ttm-fbar-content-wrapper end */}
      </div>
    </div>
    {/* ttm-fbar-main-w end */}
    {/* ttm-topbar-wrapper */}
    <div className="ttm-topbar-wrapper ttm-bgcolor-darkgrey ttm-textcolor-white clearfix">
      <div className="container">
        <div className="ttm-topbar-content">
          <ul className="top-contact text-left">
            <li>
              <i className="themifyicon ti-location-pin"/>
              234 Triumph, Los Angeles, California, US
            </li>
            <li>
              <i className="themifyicon ti-timer"/>
              Mon - Sat 8.00 - 18.00. Sunday CLOSED
            </li>
          </ul>
          <div className="topbar-right text-right">
            <div className="ttm-social-links-wrapper list-inline">
              <ul className="social-icons">
                <li>
                  <a href="aboutus-1.html#">
                    <i className="fa fa-facebook"/>
                  </a>
                </li>
                <li>
                  <a href="aboutus-1.html#">
                    <i className="fa fa-twitter"/>
                  </a>
                </li>
                <li>
                  <a href="aboutus-1.html#">
                    <i className="fa fa-pinterest-p"/>
                  </a>
                </li>
                <li>
                  <a href="aboutus-1.html#">
                    <i className="fa fa-linkedin"/>
                  </a>
                </li>
              </ul>
            </div>
            <a className="ttm-btn ttm-btn-size-md ttm-btn-shape-square ttm-btn-style-fill ttm-btn-color-skincolor open-menu" id="appointment" href="javascript:void(0)">
              GET A APPOINTMENT!
            </a>
          </div>
        </div>
      </div>
    </div>
    {/* ttm-topbar-wrapper end */}
    {/* ttm-header-wrap */}
    <div className="ttm-header-wrap">
      {/* ttm-stickable-header-w */}
      <div id="ttm-stickable-header-w" className="ttm-stickable-header-w ttm-bgcolor-white clearfix">
        <div id="site-header-menu" className="site-header-menu">
          <div className="site-header-menu-inner ttm-stickable-header">
            <div className="container">
              {/* site-branding */}
              <div className="site-branding">
                <a className="home-link" href="index.html" title="Delmont" rel="home">
                  <img id="logo-img" className="img-center" src="images/logo-img.png" alt="logo-img"/>
                </a>
              </div>
              {/* site-branding end */}
              {/* site-navigation */}
              <div id="site-navigation" className="site-navigation">

                <div className="ttm-menu-toggle">
                  <input type="checkbox" id="menu-toggle-form"/>
                  <label htmlFor="menu-toggle-form" className="ttm-menu-toggle-block">
                    <span className="toggle-block toggle-blocks-1"/>
                    <span className="toggle-block toggle-blocks-2"/>
                    <span className="toggle-block toggle-blocks-3"/>
                  </label>
                </div>
                <nav id="menu" className="menu">
                  <ul className="dropdown">
                    {
                      Object.values(dynamic['global']['header']).map((dynamic) => <li className={dynamic.link == window.location.pathname &&  "active"}>
                        <Link to={dynamic.link}>{dynamic.title}</Link>
                      </li>)
                    }
                  </ul>
                </nav>
              </div>
              {/* site-navigation end */}
            </div>
          </div>
        </div>
      </div>
      {/* ttm-stickable-header-w end */}
    </div>
    {/* ttm-header-wrap end */}
    <div className="ttm-content-wrapper">
      <div className="container">
        <div className="row">
          <div className="col-lg-12">
            {/* ttm-info-widget */}
            <div className="ttm-info-widget">
              <div className="header-widget">
                <div className="header-icon">
                  <i className="fa fa-hospital-o"/>
                </div>
                <div className="header-content">
                  <h3>Number 1 Hospital</h3>
                  <p>In United States</p>
                </div>
              </div>
              <div className="header-widget">
                <div className="header-icon">
                  <i className="fa fa-user-md"/>
                </div>
                <div className="header-content">
                  <h3>Personal Cabinet</h3>
                  <p>Qualified Staff</p>
                </div>
              </div>
              <div className="header-widget">
                <div className="header-icon">
                  <i className="fa fa-thumbs-o-up"/>
                </div>
                <div className="header-content">
                  <h3>Get Result Online</h3>
                  <p>Satisfied Patients</p>
                </div>
              </div>
            </div>
            {/* ttm-info-widget end */}
            <div className="ttm-contact">
              <span className="icon">
                <i className="fa fa-phone"/>
              </span>
              Toll Free : 1 123 456 78910
            </div>
          </div>
        </div>
      </div>
    </div>
  </header>)

}

export {
  Header
};
