import React, { useRef, useEffect } from "react";
import { Player } from "@lordicon/react";
import useCustomIcon from "../Hooks/useCustomIcon";
export const Icon = ({ size, icon, primary, secondary }) => {
  const playerRef = useRef(null);
  const customIconRef = useCustomIcon({primary:primary,secondary:secondary});
  useEffect(() => {
    playerRef.current.playFromBeginning();
  }, []);
  return (
    <div
      className="customIcon"
      onClick={() => playerRef.current.playFromBeginning()}
      ref={customIconRef}
    >
      <Player ref={playerRef} size={size} icon={icon}></Player>
    </div>
  );
};
