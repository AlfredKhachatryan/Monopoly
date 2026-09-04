import * as mod from "react-animated-numbers";

// react-animated-numbers ships a webpack UMD build that sets __esModule and
// exports { default: Component }. Depending on the bundler's CommonJS interop
// the default import is either the component itself or that wrapper object.
// The component is React.memo(...), which is an object with $$typeof, not a
// function, so both shapes have to be accepted.
const isComponent = (c) =>
  typeof c === "function" || (c !== null && typeof c === "object" && "$$typeof" in c);

const candidates = [mod, mod.default, mod.default && mod.default.default];
const AnimatedNumbers = candidates.find(isComponent);

if (!AnimatedNumbers) {
  throw new Error("react-animated-numbers: could not resolve component export");
}

export default AnimatedNumbers;
