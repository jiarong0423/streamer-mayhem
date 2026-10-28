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
// The target whose catch zone contains x, or null when x is between zones or outside the window (the zones meet but do not overlap).
export function dropColumn(x,half=DROP_CATCH_HALF){
  if(!Number.isFinite(x)||x<0||x>1)return null;
  let best=null,bestDistance=Infinity;
  for(let c=1;c<=3;c++){const d=Math.abs(x-DROP_TARGETS[c-1]);if(d<=half+1e-9&&d<bestDistance){best=c;bestDistance=d;}}
  return best;
}
