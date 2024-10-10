// src/Button.js
import React, { useRef, useState } from "react";
import styled, { keyframes } from "styled-components";
// 'ff4655'
// '0f1923'

const ButtonContainer = styled.button`
  --main-color: #ff4655;
  --sec-color: #0f1923;
  width: 100%;
  -moz-appearance: none;
  -webkit-appearance: none;
  appearance: none;
  border: none;
  background: none;
  color: var(--accent);
  cursor: pointer;
  position: relative;
  text-transform: uppercase;
  font-weight: bold;
  font-size: 14px;
  transition: all 0.3s ease;

  &:active,
  &:focus {
    outline: none;
  }

  &:hover {
    color: var(--accent);
  }

  ${
    "" /* &:hover .button_sl {
    width: calc(100% + 15px);
  } */
  }

  &:hover .button_lg:after {
    background-color: #fff;
  }
`;

const ButtonLarge = styled.span`
  position: relative;
  display: block;
  padding: 15px 20px;
  color: #fff;
  background-color: var(--accent);
  overflow: hidden;
  box-shadow: inset 0px 0px 0px 1px transparent;
  border-radius: 5px;
  transition: all 0.3s ease;
`;

const ButtonSlide = styled.span`
  display: block;
  position: absolute;
  top: 0;
  bottom: -1px;
  left: -8px;
  width: ${(props) => props.width}px;
  background-color: var(--sec-color);
  transform: skew(-15deg);
  transition: all ${(props) => props.time || 300}ms ease;
`;

const ButtonText = styled.span`
  position: relative;
`;
const Button = ({
  children,
  onClick,
  right,
  btnCont,
  btnLg,
  time,
  disabled,
}) => {
  const [buttonWidth, setButtonWidth] = useState(0);
  const myRef = useRef(null);
  // Function to change the width of the button
  const changeWidth = (newWidth) => {
    setButtonWidth(myRef.current.offsetWidth + 15);
    setTimeout(() => {
      setButtonWidth(0);
    }, time || 300);
  };

  return (
    <ButtonContainer
      className="button"
      onClick={() => {
        changeWidth();
        onClick && onClick();
      }}
      ref={myRef}
      style={disabled ? { ...btnCont, "--accent": "gray" } : { ...btnCont }}
      disabled={disabled}
    >
      <ButtonLarge className="button_lg" style={btnLg}>
        <ButtonSlide
          className="button_sl"
          width={buttonWidth}
          time={time}
          style={right && { right: "-8px", left: "unset" }}
        />
        <ButtonText className="button_text">{children}</ButtonText>
      </ButtonLarge>
    </ButtonContainer>
  );
};

export default Button;
