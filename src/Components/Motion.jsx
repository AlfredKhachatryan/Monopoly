// Shared framer-motion setup.
//
// - LazyMotion + `m` loads the "domMax" feature set: the Client's hand of
//   cards is dragged, which needs the gesture engine. (~15 KB over domAnimation.)
// - MotionConfig reducedMotion="user" disables the motion for people who
//   have "reduce motion" switched on in their OS.
// - Every variant below only animates opacity / transform, which the
//   browser composites on the GPU, so nothing here triggers layout.
import {
  LazyMotion,
  MotionConfig,
  domMax,
  m,
  AnimatePresence,
} from "framer-motion";

const ease = [0.22, 1, 0.36, 1]; // ease-out, feels snappy without bouncing

// Simple fade, used for overlays and labels.
const fade = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.22, ease } },
  exit: { opacity: 0, transition: { duration: 0.15, ease } },
};

// Fade + a few px lift, used for form fields, list rows and cards.
const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease } },
  exit: { opacity: 0, y: 4, transition: { duration: 0.15, ease } },
};

// Parent that staggers its fadeUp children.
const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
  exit: {},
};

// Small scale pop for tokens / icons appearing.
const pop = {
  hidden: { opacity: 0, scale: 0.6 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 500, damping: 30, mass: 0.6 },
  },
  exit: { opacity: 0, scale: 0.6, transition: { duration: 0.12, ease } },
};

// Press feedback for anything clickable.
const tap = { scale: 0.97 };

function MotionProvider({ children }) {
  return (
    <LazyMotion features={domMax}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

export {
  MotionProvider,
  m,
  AnimatePresence,
  ease,
  fade,
  fadeUp,
  stagger,
  pop,
  tap,
};
