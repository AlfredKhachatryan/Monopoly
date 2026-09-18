// Groups board cells by colour, in the order the colour sets appear on the
// board (railroads / utilities, colour "#000", come last).
// Returns [[color, cells], ...].
export const groupByColor = (cells) => {
  const colorOrder = [
    "#D92650",
    "#eb75e7",
    "#F5786C",
    "#1F8F5D",
    "#1F8FFF",
    "#F56CC6",
    "#6F6CF5",
    "#DE951F",
    "#000",
  ];

  const grouped = {};
  for (const cell of cells || []) {
    (grouped[cell.color] ||= []).push(cell);
  }

  const known = colorOrder.filter((c) => grouped[c]).map((c) => [c, grouped[c]]);
  const rest = Object.keys(grouped)
    .filter((c) => !colorOrder.includes(c))
    .map((c) => [c, grouped[c]]);
  return [...known, ...rest];
};
