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

const CardRenderer = ({ pos }) => {
  return (
    <>
      {Object.entries(pos).map(([key, value]) => {
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
        } = value;

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
        return (
          <Component
            className={name}
            key={key}
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
            <FigureBox
              show={figures} // in each cell there is {fig0:false,fig1:false ...etc}
              style={{ height: "30px", position: "absolute", zIndex: 2 }}
            />
          </Component>
        );
      })}
    </>
  );
};

export default CardRenderer;
