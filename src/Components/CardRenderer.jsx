import { memo } from "react";
import {
  Card_Map,
  Start_Card,
  Community_Card,
  Tax_Card,
  RailRoad_Card,
  Chance_Card,
  Jail_Card,
  Communal_Card,
  Park_Card,
  GTJ_Card,
} from "../Components/Card_Map";
import { FigureBox } from "./FigureBox";

// One board cell. Memoised so the board does not re-render while tokens walk.
// `showTokens={false}` leaves the in-cell tokens out (the Board draws them in
// a TokenLayer overlay instead so they can animate between cells).
const Cell = memo(function Cell({ cell, showTokens }) {
  const {
    name,
    color,
    header,
    info,
    price,
    start,
    community,
    tax,
    road,
    chance,
    jail,
    communal,
    parking,
    GTJ,
    icon,
    primary,
    secondary,
    state,
    id,
    bought,
    ...figures
  } = cell;

  const getComponent = () => {
    if (start) return Start_Card;
    if (community) return Community_Card;
    if (tax) return Tax_Card;
    if (road) return RailRoad_Card;
    if (chance) return Chance_Card;
    if (jail) return Jail_Card;
    if (communal) return Communal_Card;
    if (parking) return Park_Card;
    if (GTJ) return GTJ_Card;
    return Card_Map; // Fallback in case none of the above matches
  };

  const Component = getComponent();
  console.log(showTokens);
  return (
    <Component
      className={name}
      color={color}
      header={header}
      info={info}
      price={price}
      icon={icon}
      primary={primary} // colors for icon
      secondary={secondary} // colors for icon
      state={state} // animation for icon
      bought={bought}
    >
      {showTokens && (
        <FigureBox
          show={figures} // in each cell there is {fig0:false,fig1:false ...etc}
          style={{ height: "30px", position: "absolute", zIndex: 1 }}
        />
      )}
    </Component>
  );
});

const CardRenderer = ({ pos, showTokens = true }) => {
  return (
    <>
      {Object.entries(pos).map(([key, value]) => (
        <Cell key={key} cell={value} showTokens={showTokens} />
      ))}
    </>
  );
};

export default CardRenderer;
