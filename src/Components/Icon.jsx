import React, { useRef, useEffect } from "react";
import { Player } from "@lordicon/react";
import useCustomIcon from "../Hooks/useCustomIcon";
export const Icon = ({
  size,
  icon,
  primary,
  secondary,
  loop,
  delay,
  state,
  style,
}) => {
  const playerRef = useRef(null);
  const customIconRef = useCustomIcon({
    primary: primary, // changing primary color of icon
    secondary: secondary, // changing secondary color of icon
  });

  useEffect(() => {
    playerRef.current?.playFromBeginning(); // playing icon animation on page load
  }, []);

  const wait = (n) => new Promise((resolve) => setTimeout(resolve, n));

  async function Interval(intervalMs) {
    await wait(intervalMs);
    if (playerRef.current) {
      playerRef.current.playFromBeginning();
    }
  }
  // Cleanup interval on component unmount
  return (
    <>
      {icon && (
        <div
          className="customIcon"
          style={style}
          onClick={() => playerRef.current.playFromBeginning()}
          ref={customIconRef}
        >
          <Player
            ref={playerRef}
            size={size}
            icon={icon}
            state={state}
            onComplete={() => {
              loop && playerRef.current?.playFromBeginning(); //if loop is true animation is looped
              delay && Interval(delay);
            }}
          ></Player>
        </div>
      )}
    </>
  );
};
