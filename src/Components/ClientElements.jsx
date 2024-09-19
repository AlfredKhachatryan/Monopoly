import styled from "styled-components";
import Button from "../Components/Button";

const MainContainer = styled.div`
  padding-top: 1em;
  display: flex;
  flex-direction: column;
  /* justify-content: space-between; */
  min-height: 100dvh;
`;

const RelativeDiv = styled.div`
  position: relative;
  height: 10em;
  width: 100%;
`;

const FlexColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2em;
`;

const FlexRow = styled.div`
  display: flex;
  gap: 1em;
`;

const Sidebar = styled.div`
  position: absolute;
  width: 1.5em;
  height: 10em;
  border-radius: 0px 5px 5px 0px;
  background-color: #d92650;
  /* background-color: #4F8C5F; */
  color: white;
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  z-index: 1;
  transition: 0.35s ease-in-out;
  left: 0;
  &.sideBarRight {
    left: 85vw;
    z-index: 7;
    box-shadow: 0 0 15px 5px #00000063;
  }
`;

const ClientMoneyContainer = styled.div`
  display: flex;
  color: white;
  align-items: center;
  font-size: 14px;
  font-weight: 500;
  align-self: end;
  min-width: 5em;
  height: 2rem;
  background-color: #d92650;
  position: absolute;
  right: 0;
  z-index: 1;
  border-radius: 5px 0px 0px 5px;
  padding: 0px 5px;
  display: grid;
  grid-template-columns: 1fr 2px 1em;
  grid-template-rows: 1fr;
  grid-column-gap: 10px;
  grid-row-gap: 10px;
  justify-items: center;
  align-items: center;
  z-index: 5;
  box-shadow: 0 0 15px 5px #00000052;
`;

const DiceContainer = styled.div`
  display: flex;
  justify-content: space-between;
  width: calc(180px + 2em);
`;

const CenteredContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 60%;
  align-self: center;
`;

const Divider = styled.div`
  border: 1px solid white;
  height: 100%;
`;

const SidebarCard = styled(Sidebar)`
  left: unset;
  right: 0;
  height: 7em;
  bottom: 0;
  border-radius: 5px 0px 0px 5px;
`;

const ButtonStyled = styled(Button)`
  /* You can move Button styles here */
`;

export {
  MainContainer,
  RelativeDiv,
  FlexColumn,
  FlexRow,
  Sidebar,
  ClientMoneyContainer,
  DiceContainer,
  CenteredContent,
  Divider,
  SidebarCard,
  ButtonStyled,
};
