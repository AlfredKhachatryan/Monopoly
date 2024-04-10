import React, { Component } from "react";
import { Link } from "react-router-dom";

function Image({ src, style, img }) {
  const mainContStyle = {
    backgroundImage: `url(${src})`,
    backgroundPosition: "center",
    backgroundSize: "cover",
    backgroundRepeat: "no-repeat",
    ...style,
  };

  return (
    <>
      {img ? (
        <img src={src} style={mainContStyle}></img>
      ) : (
        <div style={mainContStyle}></div>
      )}
    </>
  );
}
export { Image };
