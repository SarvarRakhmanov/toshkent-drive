// Two known-harmless deprecation notices printed by third-party code on every
// load, not by the game: three r185's "THREE.Clock … use THREE.Timer" (React
// Three Fiber still constructs a Clock internally) and Rapier's "deprecated
// parameters for the initialization function" (@react-three/rapier calls
// RAPIER.init() the old way). They can't be fixed from here, and on phones
// every console line is main-thread work, so exactly those two strings are
// dropped. Every other warning/error passes through untouched.
const MUTED = [
  "THREE.Clock: This module has been deprecated",
  "using deprecated parameters for the initialization function",
];
let installed = false;
export function installConsoleFilter() {
  if (installed || typeof console === "undefined") return;
  installed = true;
  const orig = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (MUTED.some((m) => first.includes(m))) return;
    orig(...args);
  };
}
if (typeof window !== "undefined") installConsoleFilter();
