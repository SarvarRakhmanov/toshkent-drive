// Free-look for the chase camera, via the Pointer Lock API.
//
// This REPLACES the earlier position-mapped hover design (cursor position on
// screen -> a bounded lean angle). That design always had an edge somewhere —
// tuning EDGE_MARGIN only moved where the ceiling was, it couldn't remove it,
// because it read the cursor's ABSOLUTE position and a monitor is finite.
// Akul's ask ("mouse should never touch the edge, should wrap around and keep
// going") has no solution in that model: the browser gives no API to teleport
// the OS cursor from one edge to the other (that would be a real security
// hole — a page silently warping your mouse). The only way to get unbounded,
// wrap-around rotation is to stop reading cursor POSITION at all and read
// relative MOVEMENT instead, which is exactly what Pointer Lock provides:
// the OS cursor is captured and hidden, and every event reports how far the
// mouse moved since the last one (movementX/Y), with no ceiling — so yaw
// just accumulates forever and is wrapped into -PI..PI for storage, which
// reads as a true 360° turn with no edge to ever reach.
//
// These are OFFSETS applied on top of whatever the chase camera was already
// doing, not a replacement for it: with both at 0 the camera behaves exactly
// as it did before pointer lock engages.
export const cameraLook = {
  yaw: 0, // radians, added to the chase camera's orbit angle (eased), wrapped to -PI..PI
  pitch: 0, // raises/lowers the camera and its look target (eased)
  targetYaw: 0,
  targetPitch: 0,
  locked: false, // pointer lock is currently engaged on the canvas
};

export const MAX_PITCH_UP = 0.85; // full mouse-up travel — camera lifts
export const MAX_PITCH_DOWN = -0.45; // full mouse-down travel — camera drops
// Radians of yaw / pitch-units added per pixel of raw mouse movement. Tuned
// so a comfortable few-inch mouse swipe covers a full spin.
export const YAW_SENSITIVITY = 0.0045;
export const PITCH_SENSITIVITY = 0.0035;
// Fraction of the remaining distance left per second — the easing that keeps
// the camera from snapping instantly to each new mouse delta.
export const EASE = 0.0008;

const TWO_PI = Math.PI * 2;
// Keeps the stored yaw in -PI..PI forever rather than growing without bound
// as the player spins in the same direction lap after lap — a float that
// only ever grows eventually loses precision, and lerping from a huge number
// toward a small one would spin the camera the long way round. Wrapping the
// STORED value is what actually delivers "goes right forever" — the target
// can be assigned +2.9, then next frame -2.9 + a bit more, and it still reads
// as one continuous turn once eased through the shortest-arc math below.
export function wrapAngle(a: number): number {
  return ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
}

export function resetCameraLook() {
  cameraLook.yaw = 0;
  cameraLook.pitch = 0;
  cameraLook.targetYaw = 0;
  cameraLook.targetPitch = 0;
  cameraLook.locked = false;
}
