import React, { useRef, useEffect } from "react";
import { Player } from "@lordicon/react";
import useCustomIcon from "../Hooks/useCustomIcon";
export const Icon = ({ size, icon, primary, secondary, loop }) => {
  const playerRef = useRef(null);

  const customIconRef = useCustomIcon({
    primary: primary, // changing primary color of icon
    secondary: secondary, // changing secondary color of icon
  });

  useEffect(() => {
    playerRef.current.playFromBeginning(); // playing icon animation on page load
  }, []);

  return (
    <div
      className="customIcon"
      onClick={() => playerRef.current.playFromBeginning()}
      ref={customIconRef}
    >
      <Player
        ref={playerRef}
        size={size}
        icon={icon}
        onComplete={() => {
          loop && playerRef.current?.playFromBeginning(); //if loop is true animation is looped
        }}
      ></Player>
    </div>
  );
};
