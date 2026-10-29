// Catch mode geometry, in fractions of the visible window. The numbers come from common catcher games (osu!catch: catcher 1/6 of the width, fruit up to
// 0.1 of the height, catcher at the very bottom) and from tests on a phone: the window is about six face widths wide, so a catcher of 0.15 is about 0.9 of a
// face width and the targets 0.15 away from the middle need a lean of about one face width.
// An item falls from above the top edge to the floor line at one of three target x positions; the streamer's catcher (drawn at the bottom) follows their head.
export const DROP_TARGETS=Object.freeze([.35,.5,.65]);
export const DROP_CATCH_HALF=.075;  // half of the catcher width: the catcher (0.15) is as wide as the spacing between targets, so it never covers two at once
export const DROP_START=-.15;       // item starts above the visible window
export const DROP_FLOOR=.93;        // item lands, and the catcher is drawn, near the bottom

export const dropTarget=column=>Number.isInteger(column)&&column>=1&&column<=3?DROP_TARGETS[column-1]:null;
export const dropY=progress=>DROP_START+Math.max(0,Math.min(1,progress))*(DROP_FLOOR-DROP_START);

// True if a catcher centred at x (0..1) covers the target of `column`; null if x or column is unusable (outside the window counts as unusable).
export function dropCaught(x,column,half=DROP_CATCH_HALF){
  const target=dropTarget(column);
  if(target===null||!Number.isFinite(x)||x<0||x>1)return null;
  return Math.abs(x-target)<=half+1e-9;   // tolerance for floating-point noise at the exact edge
}
// Theme: a ball that lands away from the middle is a three-pointer (30), one near the middle a two-pointer (20).
export const THREE_POINT_AWAY=.135;
export const dropPoints=landX=>Number.isFinite(landX)&&Math.abs(landX-.5)>THREE_POINT_AWAY?3:2;
// Same judgement against a landing x chosen per shot (theme: the landing point moves every time); null if x or the landing x is unusable.
export function dropCaughtAt(x,landX,half=DROP_CATCH_HALF){
  if(!Number.isFinite(landX)||landX<0||landX>1||!Number.isFinite(x)||x<0||x>1)return null;
  return Math.abs(x-landX)<=half+1e-9;
}
// Landing x for a shot (theme): the lanes decide the value. The middle lane is a two-pointer: it lands 0.09..0.12 to a random side of the middle (a small lean).
// The left and right lanes are three-pointers: they land on their own side, 0.15..0.18 from the middle (0.45-0.65 face width of lean, the most a seated
// streamer should need; the window is about six face widths wide, so 1 face width = 0.167). Nothing lands straight above the head. The exact offset and the
// side of a two-pointer come from a stable hash of the event id, so a shot never jumps. How often each lane comes is up to the caller (DropWaves columnWeights).
export function dropLandX(column,eventId,jitter){
  const base=dropTarget(column);if(base===null)return null;if(!(jitter>0))return base;
  let h=2166136261;for(const ch of String(eventId))h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;
  // FNV alone barely changes its high bits when only the last character of the id changes (wave-12 vs wave-13), so consecutive shots would pick the same side:
  // run the murmur3 finaliser first, then draw the two numbers.
  const mix=x=>{x^=x>>>16;x=Math.imul(x,0x85ebca6b)>>>0;x^=x>>>13;x=Math.imul(x,0xc2b2ae35)>>>0;x^=x>>>16;return x>>>0;};
  h=mix(h);const u=h/4294967296;h=mix(h^0x9e3779b9);const v=h/4294967296;
  if(column===2)return .5+(u<.5?-1:1)*(.09+v*.03);
  return .5+(column===1?-1:1)*(.15+v*.03);
}
// Shot path (theme), drawn per shot from fixed ranges (fractions of the window; y counts from the top, so a larger apex is a LOWER arc).
// Three-pointer (left and right lanes): thrown from its own side in a moderate arc: reach = start x as a multiple of the window width from that edge
//   (1 = at the edge), startY = release height, apex = highest point. Not a lob: it peaks in the upper-middle of the window, never near the top.
// Two-pointer (middle lane): drops from above the window with a little sideways drift (drift = start x offset, in window widths; startY above the top).
export const ARC_RANGES=Object.freeze({
  three:Object.freeze({reach:[1.00,1.04],startY:[.60,.70],apex:[.36,.46]}),
  two:Object.freeze({drift:[.02,.06],startY:[-.15,-.08]})
});
export function shotArc(eventId,points){
  let h=2166136261;for(const ch of String(eventId)+'#arc')h=Math.imul(h^ch.charCodeAt(0),16777619)>>>0;
  const next=()=>{h=Math.imul(h^(h>>>15),2246822519)>>>0;h=Math.imul(h^(h>>>13),3266489917)>>>0;return ((h^(h>>>16))>>>0)/4294967296;};
  const side=next()<.5?-1:1,pick=([lo,hi])=>lo+next()*(hi-lo);
  if(points===3){const r=ARC_RANGES.three;return {side,reach:pick(r.reach),startY:pick(r.startY),apex:pick(r.apex)};}
  const r=ARC_RANGES.two;return {side,drift:pick(r.drift),startY:pick(r.startY)};
}
// The target whose catch zone contains x, or null when x is between zones or outside the window (the zones meet but do not overlap).
export function dropColumn(x,half=DROP_CATCH_HALF){
  if(!Number.isFinite(x)||x<0||x>1)return null;
  let best=null,bestDistance=Infinity;
  for(let c=1;c<=3;c++){const d=Math.abs(x-DROP_TARGETS[c-1]);if(d<=half+1e-9&&d<bestDistance){best=c;bestDistance=d;}}
  return best;
}
