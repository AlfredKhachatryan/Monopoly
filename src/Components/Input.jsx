import React from "react";
import styled from "styled-components";

const Input = styled.input`
  color: ${({ disabled }) => (disabled ? "gray" : "#fff")};
  font-size: 0.9rem;
  background-color: #14141463;
  width: 100%;
  box-sizing: border-box;
  padding-inline: 0.5em;
  padding-block: 0.7em;
  border: none;
  border-bottom: var(--border-height) solid var(--border-before-color);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  outline: none;

  &:focus + .input-border {
    width: 100%;
  }
  &::placeholder {
    color: ${({ disabled }) => (disabled ? "gray" : "#fff")};
    opacity: 0.9 !important;
  }
`;

// Styled input border component
const InputBorder = styled.span`
  position: absolute;
  background: var(--border-after-color);
  width: 0%;
  height: 2px;
  bottom: 0;
  left: 0;
  transition: width 0.3s cubic-bezier(0.6, -0.28, 0.735, 0.045);
`;

// Styled form control container
const FormControl = styled.div`
  position: relative;
  width: 100%;
`;

// Alternate styled input component
const InputAlt = styled(Input)`
  font-size: 1.2rem;
  padding-inline: 1em;
  padding-block: 0.8em;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
`;

const InputBorderAlt = styled(InputBorder)`
  height: 3px;
  background: ${({ disabled }) =>
    disabled ? "gray" : "linear-gradient(90deg, #ff6464 0%, #ff4655 100%)"};
  width: ${({ disabled }) => (disabled ? "100%" : "0%")};
  transition: width 0.25s cubic-bezier(0.42, 0, 0.58, 1);
`;

const FormInput = ({ alt, disabled, ...props }) => (
  <FormControl>
    <InputAlt {...props} disabled={disabled} />
    <InputBorderAlt className="input-border" disabled={disabled} />
  </FormControl>
);

export default FormInput;
