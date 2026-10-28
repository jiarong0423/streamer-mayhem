// Same-origin, ephemeral synthetic overlay messages; no credentials or external services.
import {createCameraGeometry} from './camera_geometry.mjs';
import {CROSS_CELLS} from './matrix.mjs';
// A new identity makes old readers reject expanded challenge render payloads.
export const OVERLAY_STATE_TYPE='synthetic-state-v3';
export const OVERLAY_CLOSED_TYPE='synthetic-closed-v3';
const SESSION=/^[a-f0-9]{32}$/;
const MODES=new Set(['IDLE','PLAYING','PAUSED','TRACKING_LOST','RECOVERING','ROUND_END']);
function renderAttack(attack) {
  if(!attack || !Number.isInteger(attack.cell) || attack.cell<1 || attack.cell>9)throw new Error('INVALID_OVERLAY_STATE');
  if(attack.kind==='DROP'){
    const column=attack.cell-3;
    if(!Number.isInteger(column)||column<1||column>3||!Array.isArray(attack.cells)||attack.cells.length!==3||attack.cells.some((cell,i)=>cell!==column+i*3)||!Number.isFinite(attack.progress)||attack.progress<0||attack.progress>1)throw new Error('INVALID_OVERLAY_STATE');
    if(attack.variant!==undefined&&attack.variant!=='BOMB')throw new Error('INVALID_OVERLAY_STATE');
    return {cell:attack.cell,kind:'DROP',cells:[...attack.cells],progress:attack.progress,...(attack.variant?{variant:attack.variant}:{})};
  }
  if(attack.cells===undefined)return {cell:attack.cell};
  if(attack.cell!==5 || !Array.isArray(attack.cells) || attack.cells.length!==CROSS_CELLS.length ||
    attack.cells.some((cell,i)=>cell!==CROSS_CELLS[i]))throw new Error('INVALID_OVERLAY_STATE');
  return {cell:5,cells:[...CROSS_CELLS]};
}
const JOINTS=['nose','leftShoulder','rightShoulder','leftElbow','rightElbow'];
const error=()=>{throw new Error('INVALID_OVERLAY_STATE');};
const number=(value,min,max)=>Number.isFinite(value)&&value>=min&&value<=max?value:error();
function renderPoint(value,visibility=true){
  if(value===null)return null;
  if(!value||typeof value!=='object')return error();
  return {x:number(value.x,0,1),y:number(value.y,0,1),...(visibility?{visibility:number(value.visibility,0,1)}:{})};
}
function renderPose(value,names,partial=false){
  if(value===null)return null;
  if(!value||typeof value!=='object')return error();
  const pose=Object.fromEntries(names.map(name=>[name,renderPoint(value[name]??null)]));
  if(partial?!Object.values(pose).some(Boolean):Object.values(pose).some(p=>!p))return error();
  return pose;
}
function renderFreeze(value,playing){
  if(value===undefined||value===null||value.active===false)return null;
  if(value.active!==true||!['YELLOW','RED'].includes(value.phase)||!['YELLOW','RED','UNKNOWN','RECOVERING','PAUSED'].includes(value.status))return error();
  const b=value.box;if(!b)return error();
  const box=Object.fromEntries(['left','right','top','bottom'].map(k=>[k,number(b[k],0,1)]));
  if(box.left>=box.right||box.top>=box.bottom)return error();
  const anchor=renderPose(value.anchor,JOINTS),pose=renderPose(value.pose,JOINTS);
  if(value.phase==='RED'&&!anchor||value.phase==='YELLOW'&&anchor)return error();
  if(['YELLOW','RED'].includes(value.status)&&!pose)return error();
  return {active:true,phase:value.phase,status:value.status,remainingMs:number(value.remainingMs,0,60000),recoveryRemaining:number(value.recoveryRemaining,0,60000),box,anchor,pose:playing&&['YELLOW','RED'].includes(value.status)?pose:null};
}
function renderAction(value,playing){
  if(value===undefined||value===null||value.active===false)return null;
  if(value.active!==true||!['MOSQUITO','LAVA'].includes(value.kind)||!['ACTIVE','UNKNOWN','PAUSED','RECOVERING'].includes(value.status))return error();
  const names=value.kind==='MOSQUITO'?['leftWrist','rightWrist']:['leftHip'];
  const pose=renderPose(value.pose,names,value.kind==='MOSQUITO'),visible=playing&&value.status==='ACTIVE';
  if(value.status==='ACTIVE'&&(!pose||(value.kind==='MOSQUITO'&&!value.mosquito)))return error();
  if(!Number.isSafeInteger(value.burns)||value.burns<0||value.burns>60)return error();
  return {active:true,kind:value.kind,status:value.status,remainingMs:number(value.remainingMs,0,10000),recoveryRemaining:number(value.recoveryRemaining,0,60000),pose:visible?pose:null,mosquito:visible&&value.kind==='MOSQUITO'?renderPoint(value.mosquito,false):null,level:number(value.level,0,.8),targetLevel:number(value.targetLevel,0,.8),burns:value.burns};
}
function renderSnapshot(snapshot){
  if(!snapshot||!MODES.has(snapshot.mode)||!Array.isArray(snapshot.attacks)||snapshot.attacks.length>8)return error();
  const playing=snapshot.mode==='PLAYING',attacks=snapshot.attacks.map(renderAttack),freeze=renderFreeze(snapshot.freeze,playing),action=renderAction(snapshot.actionGame,playing);
  if(freeze&&action||((freeze||action)&&attacks.length))return error();
  // Score and health are optional display numbers for the stream HUD; if present they must be finite and in range.
  const hud={};
  if(snapshot.score!==undefined)hud.score=number(snapshot.score,0,1e6);
  if(snapshot.hp!==undefined)hud.hp=number(snapshot.hp,0,100);
  // The last viewer who triggered something (display name, already cleaned by the sender); the overlay shows it for a few seconds.
  if(snapshot.viewer!==undefined&&!(typeof snapshot.viewer==='string'&&/^[^\u0000-\u001f\u007f-\u009f]{1,20}$/u.test(snapshot.viewer)))return error();
  return {mode:snapshot.mode,attacks:playing?attacks:[],...hud,...(snapshot.viewer?{viewer:snapshot.viewer}:{}),...(freeze?{freeze}:{}),...(action?{actionGame:action}:{})};
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
  return {type:OVERLAY_STATE_TYPE,session,sequence,scene,snapshot:renderSnapshot({...snapshot,attacks:snapshot.attacks??[]}),sourcePoint:playing&&sourcePoint?{x:sourcePoint.x,y:sourcePoint.y,visibility:sourcePoint.visibility}:null};
}
export function readOverlayState(message,session,width,height) {
  if(!message || message.type!==OVERLAY_STATE_TYPE || message.session!==session || !SESSION.test(session??'') || !Number.isSafeInteger(message.sequence) || message.sequence<0 || !Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 || width>4096 || height>2160)throw new Error('INVALID_OVERLAY_STATE');
  const snapshot=renderSnapshot(message.snapshot);
  if(message.scene===null)return {sequence:message.sequence,geometry:null,snapshot:{mode:'TRACKING_LOST',attacks:[]},sourcePoint:null};
  const s=message.scene,v=s?.viewport;if(!v || ![v.x,v.y,v.width,v.height].every(Number.isFinite))throw new Error('INVALID_OVERLAY_STATE');
  const geometry=createCameraGeometry({canvasWidth:width,canvasHeight:height,viewport:{x:v.x*width,y:v.y*height,width:v.width*width,height:v.height*height},sourceWidth:s.sourceWidth,sourceHeight:s.sourceHeight,crop:s.crop,fit:s.fit,mirror:s.mirror,rotation:s.rotation});
  let point=null;
  if(message.sourcePoint!==null){const p=message.sourcePoint;if(!p || ![p.x,p.y,p.visibility].every(Number.isFinite) || p.x<0 || p.x>1 || p.y<0 || p.y>1 || p.visibility<0 || p.visibility>1)throw new Error('INVALID_OVERLAY_STATE');point={x:p.x,y:p.y,visibility:p.visibility};}
  const playing=snapshot.mode==='PLAYING';
  return {sequence:message.sequence,geometry,snapshot,sourcePoint:playing?point:null};
}
