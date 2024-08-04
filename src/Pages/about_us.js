import { useEffect, useState } from "react";
import { Card_Map } from "../Components/Card_Map";
import Button from "../Components/Button";
import ShortUniqueId from "short-unique-id";
import { FigureBox } from "../Components/FigureBox";
import { createClient } from "@supabase/supabase-js";
import { useRealtimeUpdates, useFetch, updateDB } from "../Hooks/supabase";

function initialState() {
  const obj = {
    1: {
      fig0: true,
      fig1: true,
      fig2: true,
      fig3: true,
      name: `itemCard${1}`,
    },
  };

  for (let i = 2; i < 37; i++) {
    obj[i] = {
      fig0: false,
      fig1: false,
      fig2: false,
      fig3: false,
      name: `itemCard${i}`,
    };
  }

  return obj;
}

function Main() {
  const short = new ShortUniqueId({ length: 10 });

  const uuid = "v6Pstf";

  const [pos, setPos] = useState(initialState());

  const { data, error, loading } = useFetch(uuid);

  useEffect(() => {
    if (data) {
      console.log(data);
      setPos(data.position);
    }
  }, [data]);

  const handleInserts = (payload) => {
    setPos(payload.new.position);
  };

  useEffect(() => {
    // console.log(pos);
  }, [pos]);

  useRealtimeUpdates(handleInserts);

  return (
    <div className="cont">
      <div className="parent">
        {Object.entries(pos).map(([key, value]) => (
          <Card_Map className={value.name} key={key}>
            <FigureBox
              show={Object.keys(value)
                .filter((key) => key !== "name")
                .reduce((obj, key) => {
                  obj[key] = value[key];
                  return obj;
                }, {})}
            ></FigureBox>
          </Card_Map>
        ))}
        <div className="ChanceOutline flexCent">Chance</div>
        <div className="BonusOutline flexCent">Bonus</div>
        <div className="PlayerInfo flexCent">Info</div>
        <div className="BaseInfo flexCent">{uuid}</div>
        <Button
          onClick={() => {
            updateDB(uuid, { position: initialState() });
          }}
        >
          Click
        </Button>
      </div>
    </div>
  );
}

export { Main };
