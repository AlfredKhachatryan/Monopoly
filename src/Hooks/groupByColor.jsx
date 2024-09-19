export const groupByColor = (items) => {
  const colorOrder = [
    "#D92650",
    "#6F6CF5",
    "#F5786C",
    "#1F8F5D",
    "#1F8FFF",
    "#F56CC6",
    "#0942B3",
    "#DE951F",
  ];
  const grouped = items.reduce((acc, [key, value]) => {
    if (!acc[value.color]) {
      acc[value.color] = [];
    }
    acc[value.color].push([key, value]);
    return acc;
  }, {});
  return colorOrder.reduce((acc, color) => {
    if (grouped[color]) {
      acc[color] = grouped[color];
    }
    return acc;
  }, {});
};
