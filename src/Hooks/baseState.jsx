import { FIGS } from "./rules";

// { fig0: false, fig1: false, ... } for every figure key, generated from
// FIGS so a fresh room's board never drifts out of sync with the figure
// list again.
function emptyFigFlags() {
  return Object.fromEntries(FIGS.map((f) => [f, false]));
}

// The eight street-group hexes below are the whole palette, evenly spread round
// the hue wheel, and a saturated hue on this board means "street group" and
// nothing else — railroads, tax, the decks and the two special cells all live on
// neutral/muted accents in rules.js (KIND_ACCENT) instead. The groups in board
// order are Crimson #e02749 (2,4), Teal #0fb5b5 (7,9,10), Orange #f2762a
// (12,14,15), Green #24a75a (17,19,20), Azure #2b7fff (22,24,25), Magenta
// #e451c4 (27,29,30), Gold #e8b224 (32,34,35), Indigo #7b5cff (38,40).
//
// Gold and Indigo are swapped relative to a naive "keep the old position"
// remap: Magenta/Indigo are hue neighbours and sat next to each other across
// Go To Jail, and Gold/Crimson are both warm and sit either side of Start. With
// the swap no two groups that are adjacent on the 40-cell loop are neighbours on
// the hue wheel, and the tightest adjacent pair is 71 degrees apart.
//
// These hexes are duplicated in src/Client/boardDisplay.jsx (GROUP_NAMES, keyed
// by the LOWER-CASED hex) and src/Hooks/groupByColor.jsx (colorOrder). Change
// one, change all three or the group names silently vanish.
function initialState() {
  const obj = {};
  const baseItems = [
    { header: "Старт", info: "Старт", color: "#000", start: true },
    {
      header: "Зайка",
      info: "Ownd By ''",
      color: "#e02749",
      price: 60,
    },
    { header: "Community", community: true, info: "Community", color: "#000" },
    {
      header: "Статуя Гая",
      info: "Ownd By ''",
      color: "#e02749",
      price: 60,
    },
    { header: "Tax", tax: true, info: "Tax", color: "#000", price: 200 },
    {
      header: "RailRoad",
      price: 200,
      road: true,
      info: "Support",
      color: "#000",
    },
    {
      header: "Фирмини",
      info: "Ownd By ''",
      color: "#0fb5b5",
      price: 100,
    },
    { header: "Chance", chance: true, info: "Chance", color: "#000" },
    {
      header: "Чинар",
      info: "Ownd By ''",
      color: "#0fb5b5",
      price: 100,
      name: "borderLeft",
    },
    {
      header: "Циран",
      info: "Ownd By ''",
      color: "#0fb5b5",
      price: 120,
    },
    { header: "Jail", jail: true, info: "Jail", color: "#000" },
    {
      header: "Дом Афо",
      info: "Ownd By ''",
      color: "#f2762a",
      price: 140,
    },
    // Cell 13 used to be the "Light" utility. The Casino replaces it: the BANK
    // is the house, so it has NO owner, no price and never reaches the auction
    // flow — omitting `price` is what keeps priceOf()/isProperty() from ever
    // offering it. `primary` is the felt green the tile reads as, `secondary`
    // the brass trim; both are deliberately off the street-group hue wheel so a
    // saturated hue keeps meaning "street group" and nothing else.
    {
      header: "Casino",
      casino: true,
      info: "Casino",
      color: "#000",
      primary: "#0d5c46",
      secondary: "#b8912f",
      state: "loop-charging",
    },
    {
      header: "Дом Эро",
      info: "Ownd By ''",
      color: "#f2762a",
      price: 140,
    },
    {
      header: "Дом Коли",
      info: "Ownd By ''",
      color: "#f2762a",
      price: 160,
      name: "borderBottom",
    },
    {
      header: "RailRoad",
      price: 200,
      road: true,
      info: "Offlane",
      color: "#000",
    },
    {
      header: "Далма Молл",
      info: "Ownd By ''",
      color: "#24a75a",
      price: 160,
    },
    { header: "Community", community: true, info: "Community", color: "#000" },
    {
      header: "Ереван Молл",
      info: "Ownd By ''",
      color: "#24a75a",
      price: 180,
    },
    {
      header: "Мега Молл",
      info: "Ownd By ''",
      color: "#24a75a",
      price: 200,
      name: "borderBottom",
    },
    { header: "Park", parking: true, info: "Free Park", color: "#000" },
    {
      header: "Minecraft",
      info: "Ownd By ''",
      color: "#2b7fff",
      price: 220,
    },
    { header: "Chance", chance: true, info: "Chance", color: "#000" },
    {
      header: "LOL",
      info: "Ownd By ''",
      color: "#2b7fff",
      price: 220,
    },
    {
      header: "For Honor",
      info: "Ownd By ''",
      color: "#2b7fff",
      price: 240,
      name: "borderLeft",
    },
    {
      header: "RailRoad",
      price: 200,
      road: true,
      info: "Midlane",
      color: "#000",
    },
    {
      header: "Ubisoft",
      info: "Ownd By ''",
      color: "#e451c4",
      price: 260,
    },
    // Cell 28 used to be the "Water" utility. The Weed Farm replaces it: it IS
    // ownable and goes through the normal auction/trade flow, so it keeps a
    // `price`. It stays at the $150 the utility it replaced carried, which is
    // what mono_price() falls back to server-side: cheap for this half of the
    // board on purpose, so a growing income counter is worth bidding up.
    // `income` is the live counter the owner
    // collects by landing on it themselves; it starts at $50 and grows $150
    // every time a NON-owner lands here (the server owns those mutations).
    // `primary` is the deep herbal green of the tile — darker and less chromatic
    // than the Green/Teal street groups on purpose.
    {
      header: "Weed Farm",
      farm: true,
      info: "Weed Farm",
      color: "#000",
      price: 150,
      income: 50,
      primary: "#33631c",
      secondary: "#8fb87a",
      state: "hover-pinch",
    },
    {
      header: "EGS",
      info: "Ownd By ''",
      color: "#e451c4",
      price: 260,
    },
    {
      header: "Steam",
      info: "Ownd By ''",
      color: "#e451c4",
      price: 280,
      name: "borderLeft",
    },
    { header: "Jail", GTJ: true, info: "Go To Jail", color: "#000" },
    {
      header: "Spotify",
      info: "Ownd By ''",
      color: "#e8b224",
      price: 300,
    },
    { header: "Community", community: true, info: "Community", color: "#000" },
    {
      header: "Discord",
      info: "Ownd By ''",
      color: "#e8b224",
      price: 300,
      name: "borderBottom",
    },
    {
      header: "Windows",
      info: "Ownd By ''",
      color: "#e8b224",
      price: 320,
    },
    {
      header: "RailRoad",
      price: 200,
      road: true,
      info: "Carry",
      color: "#000",
      name: "borderBottomLight",
    },
    { header: "Chance", chance: true, info: "Chance", color: "#000" },
    {
      header: "Rainbox 6 Siege",
      info: "Ownd By ''",
      color: "#7b5cff",
      price: 350,
    },
    {
      header: "Luxury Tax",
      tax: true,
      info: "Luxury Tax",
      color: "#000",
      price: 400,
    },
    {
      header: "Dota 2",
      info: "Ownd By ''",
      color: "#7b5cff",
      price: 400,
    },
  ];

  for (let i = 1; i <= baseItems.length; i++) {
    obj[i] = {
      ...emptyFigFlags(),
      name: `itemCard${i} `,
      id: i,
      bought: emptyFigFlags(),
      color: baseItems[i - 1].color,
      header: baseItems[i - 1].header,
      info: baseItems[i - 1].info,
      price: baseItems[i - 1].price,
      start: baseItems[i - 1].start,
      community: baseItems[i - 1].community,
      tax: baseItems[i - 1].tax,
      road: baseItems[i - 1].road,
      chance: baseItems[i - 1].chance,
      jail: baseItems[i - 1].jail,
      // `communal` is gone: both utilities were replaced (cell 13 Casino,
      // cell 28 Weed Farm). This copy list is exhaustive — a flag missing here
      // is silently dropped from the seeded board, so casino/farm/income have
      // to be listed or the two new cells arrive at Postgres as blank spaces.
      casino: baseItems[i - 1].casino,
      farm: baseItems[i - 1].farm,
      income: baseItems[i - 1].income,
      parking: baseItems[i - 1].parking,
      GTJ: baseItems[i - 1].GTJ,
      icon: baseItems[i - 1].icon,
      primary: baseItems[i - 1].primary,
      secondary: baseItems[i - 1].secondary,
      state: baseItems[i - 1].state,
    };
  }

  return obj;
}

export { initialState };
