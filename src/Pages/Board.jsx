// The TV board moved to src/Board/ (BoardScreen + the grid, tiles, tokens and
// the right column). This file stays as the route's entry point so
// src/main.jsx and the dev harnesses keep importing `Main` from the same path.

export { Main, default } from "../Board/BoardScreen";
