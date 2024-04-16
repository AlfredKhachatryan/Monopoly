import React, {Component} from 'react';
// import closeIcon from "../assets/icons/close.svg";
import * as ReactDOM from 'react-dom';
import {dynamic} from '../dynamic.js'
// суммирует кол-во статей и добавляет в All Categories
let categories = dynamic.sideBar.categories;
categories.at(-1).number = categories.map((categories) => categories.number).reduce((partialSum, a) => partialSum + a, 0)
// закончивается суммирование
function SideBar() {
  return (
    <div className="col-lg-3 widget-area sidebar-right ttm-col-bgcolor-yes ttm-bg ttm-right-span ttm-bgcolor-grey">
      <div className="ttm-col-wrapper-bg-layer ttm-bg-layer" />
      <aside className="widget widget-search">
        <form
          role="search"
          method="get"
          className="search-form  box-shadow"
          action="single-blog.html#"
        >
          <label>
            <span className="screen-reader-text">Search for:</span>
            <input
              type="search"
              className="input-text"
              placeholder="Search …"
              defaultValue=""
              name="s"
            />
          </label>
          <input
            type="submit"
            className="search-submit"
            defaultValue="Search"
          />
        </form>
      </aside>
      <aside className="widget widget-categories">
        <h3 className="widget-title">Categories</h3>
        <ul>
        {Object.values(dynamic['sideBar']['categories']).map((dynamic)=>

          <li>
            <a href="single-blog.html#">{dynamic.text}</a>
            <span>{dynamic.number}</span>
          </li>
        )}
        </ul>
      </aside>
      <aside className="widget widget-recent-post">
        <h3 className="widget-title">Popular News</h3>
        <ul className="widget-post ttm-recent-post-list">
          {Object.values(dynamic['global']['blog']).slice(0,3).map((dynamic)=>

          <li>
            <a href="single-blog.html">
              <img src={dynamic.img} alt="post-img" />
            </a>
            <span className="post-date">{dynamic.month+' ' + dynamic.day + ', ' +dynamic.year}</span>
            <a href="single-blog.html">
              {dynamic.title}
            </a>
          </li>
        )}
        </ul>
      </aside>


      <aside className="widget widget-text">
        <div className="ttm_info_widget">
          <div className="icon">
            <i className="themifyicon ti-headphone" />
          </div>
          <div className="title">
            <h3>Let's Help You!</h3>
          </div>
          <div className="content">
            14 Tottenham Court Road
            <br />
            Bulls Stadium, Califorina <br />
            1234, USA <br />
            <a href="mailto:info@example.com.com">info@example.com</a>
          </div>
          <br />
          <a className="view_more" href="single-blog.html#">
            View More
          </a>
        </div>
      </aside>

    </div>
)
}
export{SideBar}
