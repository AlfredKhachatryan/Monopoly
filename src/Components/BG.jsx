import styled, { keyframes } from "styled-components";
import image from "../Images/blob-scene-haikei.svg";
// Keyframes for background animation
const bgAnimation = keyframes`
  0% {
    transform: scale(1);
    background-position: 0%;
  }
  50% {
    transform: scale(1.2);
    background-position: 50%;
  }
  100% {
    transform: scale(1);
    background-position: 0%;
  }
`;

// Styled component for the outer container
const BgCont = styled.div`
  width: 100vw;
  height: 100vh;
  position: absolute;
  z-index: -1;
`;

// Styled component for the background
const Bg = styled.div`
  background-image: url(${image});
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  height: 100%;
  width: 100%;
  position: fixed;
  animation: ${bgAnimation} 15s infinite;
  transform-origin: center;
`;

// Styled component for the inner overlay with blur
const BgInner = styled.div`
  background-color: #20202062;
  width: 100%;
  height: 100%;
  position: absolute;
  padding: 5px;
  backdrop-filter: blur(15px);
  top: 0;
  left: 0;
`;

const BG = () => (
  <BgCont>
    <Bg />
    <BgInner />
  </BgCont>
);

export default BG;
