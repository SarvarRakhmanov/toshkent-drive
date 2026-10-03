// One-shot teleport request, same mutable-singleton pattern as worldState —
// Car.tsx/Bike.tsx poll this in useFrame and consume it when they're the
// active vehicle (the club door is the only thing that ever calls this).
export const teleportRequest = { pending: false, x: 0, z: 0, h: 0 };

export function requestTeleport(x: number, z: number, h: number) {
  teleportRequest.pending = true;
  teleportRequest.x = x;
  teleportRequest.z = z;
  teleportRequest.h = h;
}
