/**
 * Keeps people from walking through each other.
 *
 * Walkers follow their routes without knowing about anyone else, so on its own two of them would
 * overlap as if they were ghosts. After every walker has moved, this pass finds pairs that stand
 * closer than their two bodies allow and nudges them apart. The nudge is a `shove`: an offset on
 * top of where the route puts the walker. It fades once they are clear, so everyone drifts back to
 * their route, and it never pushes anyone onto ground they could not walk on.
 *
 * A walker the player steers is anchored: it never gives way, and everyone else steps aside.
 */

export interface CrowdMember {
  /** Where the member is drawn. Between `liftShoves` and `separate` this is the route position. */
  root: { x: number; y: number };
  /** Offset currently applied on top of the route position. */
  shove: { x: number; y: number };
  /** Half the width of the body on the ground. */
  radius: number;
  /** Steered by the player: never pushed. */
  anchored: boolean;
  /** Whether a world point is ground this member may stand on. */
  canStand: (x: number, y: number) => boolean;
}

/** Fraction of a shove that is kept each frame while nothing pushes against it. */
const KEEP = 0.9;
/** No shove grows beyond this, so a crowd cannot fling anyone across the street. */
const MAX_SHOVE = 26;
/** Bodies overlap on screen far less when one stands behind the other, so depth counts for less. */
const DEPTH_WEIGHT = 1.6;
/** How much of a push goes sideways, to the pushed member's right, instead of straight away. */
const SIDESTEP = 0.9;
const PASSES = 2;

/** Takes last frame's shove off every member, so routes move them from where the route says. */
export function liftShoves(members: readonly CrowdMember[]): void {
  for (const member of members) {
    member.root.x -= member.shove.x;
    member.root.y -= member.shove.y;
  }
}

function nudge(member: CrowdMember, dx: number, dy: number): void {
  const tries: [number, number][] = [
    [dx, dy],
    [dx, 0],
    [0, dy],
  ];
  for (const [tx, ty] of tries) {
    if (tx === 0 && ty === 0) continue;
    const x = member.shove.x + tx;
    const y = member.shove.y + ty;
    if (Math.hypot(x, y) > MAX_SHOVE) continue;
    if (!member.canStand(member.root.x + x, member.root.y + y)) continue;
    member.shove.x = x;
    member.shove.y = y;
    return;
  }
}

/** Pushes overlapping members apart, then draws everyone at route position plus shove. */
export function separate(members: readonly CrowdMember[]): void {
  for (const member of members) {
    member.shove.x *= KEEP;
    member.shove.y *= KEEP;
  }
  for (let pass = 0; pass < PASSES; pass += 1) {
    for (let i = 0; i < members.length; i += 1) {
      const a = members[i] as CrowdMember;
      for (let j = i + 1; j < members.length; j += 1) {
        const b = members[j] as CrowdMember;
        if (a.anchored && b.anchored) continue;
        const dx = a.root.x + a.shove.x - (b.root.x + b.shove.x);
        const dy = a.root.y + a.shove.y - (b.root.y + b.shove.y);
        const reach = a.radius + b.radius;
        const ground = Math.hypot(dx, dy * DEPTH_WEIGHT);
        if (ground >= reach) continue;
        // Directly on top of each other there is no direction to push; pick a stable one.
        const angle = ground < 1e-3 ? (i * 31 + j * 17) * 0.7 : Math.atan2(dy * DEPTH_WEIGHT, dx);
        const push = reach - ground;
        // Besides straight apart, each bears to its own right, so two people walking at each other
        // pass like pedestrians instead of shoving back and forth along one line.
        const ux = (Math.cos(angle) + Math.sin(angle) * SIDESTEP) * push;
        const uy = ((Math.sin(angle) - Math.cos(angle) * SIDESTEP) * push) / DEPTH_WEIGHT;
        const shareA = a.anchored ? 0 : b.anchored ? 1 : 0.5;
        const shareB = 1 - shareA;
        if (shareA > 0) nudge(a, ux * shareA, uy * shareA);
        if (shareB > 0) nudge(b, -ux * shareB, -uy * shareB);
      }
    }
  }
  for (const member of members) {
    member.root.x += member.shove.x;
    member.root.y += member.shove.y;
  }
}
