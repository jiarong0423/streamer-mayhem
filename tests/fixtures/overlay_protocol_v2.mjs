// Historical v2 reader, retained unchanged except relative imports.
// Origin: accepted SM-G01 checkpoint.
// Same-origin, ephemeral synthetic overlay messages; no credentials or external services.
import {createCameraGeometry} from '../../dist/camera_geometry.mjs';
import {CROSS_CELLS} from '../../dist/matrix.mjs';
// A new wire type makes legacy readers reject the expanded five-cell payload.
export const OVERLAY_STATE_TYPE='synthetic-state-v2';
export const OVERLAY_CLOSED_TYPE='synthetic-closed-v2';
const SESSION=/^[a-f0-9]{32}$/;
const MODES=new Set(['IDLE','PLAYING','PAUSED','TRACKING_LOST','RECOVERING','ROUND_END']);
function renderAttack(attack) {
  if(!attack || !Number.isInteger(attack.cell) || attack.cell<1 || attack.cell>9)throw new Error('INVALID_OVERLAY_STATE');
  if(attack.cells===undefined)return {cell:attack.cell};
  if(attack.cell!==5 || !Array.isArray(attack.cells) || attack.cells.length!==CROSS_CELLS.length ||
    attack.cells.some((cell,i)=>cell!==CROSS_CELLS[i]))throw new Error('INVALID_OVERLAY_STATE');
  return {cell:5,cells:[...CROSS_CELLS]};
}
export function parseOverlayQuery(search) {
  const q=new URLSearchParams(search);
  if([...q.keys()].some(k=>!['mode','session'].includes(k)) || q.getAll('mode').length>1 || q.getAll('session').length>1)throw new Error('INVALID_OVERLAY_QUERY');
  if(!q.has('mode')&&!q.has('session'))return null;
  if(q.get('mode')!=='synthetic'||!SESSION.test(q.get('session')??''))throw new Error('INVALID_OVERLAY_QUERY');
  return q.get('session');
}
export function makeOverlayState({session,sequence,geometry,snapshot,sourcePoint}) {
  if(!SESSION.test(session??'') || !Number.isSafeInteger(sequence) || sequence<0)throw new Error('INVALID_OVERLAY_STATE');
  const scene=geometry?{viewport:{x:geometry.viewport.x/geometry.canvasWidth,y:geometry.viewport.y/geometry.canvasHeight,width:geometry.viewport.width/geometry.canvasWidth,height:geometry.viewport.height/geometry.canvasHeight},sourceWidth:geometry.sourceWidth,sourceHeight:geometry.sourceHeight,crop:{...geometry.crop},fit:geometry.fit,mirror:geometry.mirror,rotation:geometry.rotation}:null;
  const playing=snapshot.mode==='PLAYING';
  return {type:OVERLAY_STATE_TYPE,session,sequence,scene,snapshot:{mode:snapshot.mode,attacks:playing?(snapshot.attacks??[]).map(renderAttack):[]},sourcePoint:playing&&sourcePoint?{x:sourcePoint.x,y:sourcePoint.y,visibility:sourcePoint.visibility}:null};
}
export function readOverlayState(message,session,width,height) {
  if(!message || message.type!==OVERLAY_STATE_TYPE || message.session!==session || !SESSION.test(session??'') || !Number.isSafeInteger(message.sequence) || message.sequence<0 || !Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width>4096 || height>2160)throw new Error('INVALID_OVERLAY_STATE');
  const snapshot=message.snapshot;
  if(!snapshot || !MODES.has(snapshot.mode) || !Array.isArray(snapshot.attacks) || snapshot.attacks.length>8)throw new Error('INVALID_OVERLAY_STATE');
  const attacks=snapshot.attacks.map(renderAttack);
  if(message.scene===null)return {sequence:message.sequence,geometry:null,snapshot:{mode:'TRACKING_LOST',attacks:[]},sourcePoint:null};
  const s=message.scene,v=s?.viewport;if(!v || ![v.x,v.y,v.width,v.height].every(Number.isFinite))throw new Error('INVALID_OVERLAY_STATE');
  const geometry=createCameraGeometry({canvasWidth:width,canvasHeight:height,viewport:{x:v.x*width,y:v.y*height,width:v.width*width,height:v.height*height},sourceWidth:s.sourceWidth,sourceHeight:s.sourceHeight,crop:s.crop,fit:s.fit,mirror:s.mirror,rotation:s.rotation});
  let point=null;
  if(message.sourcePoint!==null){const p=message.sourcePoint;if(!p || ![p.x,p.y,p.visibility].every(Number.isFinite) || p.x<0 || p.x>1 || p.y<0 || p.y>1 || p.visibility<0 || p.visibility>1)throw new Error('INVALID_OVERLAY_STATE');point={x:p.x,y:p.y,visibility:p.visibility};}
  const playing=snapshot.mode==='PLAYING';
  return {sequence:message.sequence,geometry,snapshot:{mode:snapshot.mode,attacks:playing?attacks:[]},sourcePoint:playing?point:null};
}
