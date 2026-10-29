// Controller-side half of the OBS overlay sync: session id, message sequence and the POSTs to the loopback relay.
// Pure of the DOM: the page hands in what it knows (geometry, tracked point, last viewer) and shows the status text the publisher reports.
import {makeOverlayState,OVERLAY_CLOSED_TYPE,TICKER_TONES,TICKER_LIMITS,isTickerName,isTickerText} from './overlay_protocol.mjs';

export const SESSION_KEY='sm.overlay.session',SEQUENCE_KEY='sm.overlay.seq',AUTO_KEY='sm.overlay.auto';
const SESSION_RE=/^[a-f0-9]{32}$/;
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');

export function createOverlayPublisher({getGeometry,getSourcePoint=()=>null,getViewer=()=>undefined,getExtras=()=>({}),fetchImpl=globalThis.fetch?.bind(globalThis),baseHref='http://127.0.0.1/',cryptoImpl=globalThis.crypto,storage=null,now=()=>Date.now(),onStatus=()=>{}}={}) {
  // The session is the only secret of the loopback relay; it is kept in localStorage so the OBS Browser Source URL survives a reload of this page.
  // Reads and writes are guarded: without storage (private window, blocked site data) a fresh session is made on every load and `persistent()` says so.
  const read=key=>{try{return storage?.getItem(key)??null;}catch{return null;}};
  const write=(key,value)=>{try{if(!storage)return false;storage.setItem(key,String(value));return true;}catch{return false;}};
  let session=null,sequence=0,inFlight=0,enabled=false,persistent=false;
  try {
    const saved=read(SESSION_KEY);
    if(typeof saved==='string'&&SESSION_RE.test(saved)){session=saved;persistent=true;}
    else {
      if(typeof cryptoImpl?.getRandomValues!=='function')throw new Error('SECURE_RANDOM_UNAVAILABLE');
      const bytes=new Uint8Array(16);cryptoImpl.getRandomValues(bytes);session=hex(bytes);persistent=write(SESSION_KEY,session);
    }
  } catch {session=null;persistent=false;onStatus('UNAVAILABLE','This browser cannot sync the synthetic pages.');}
  // The relay refuses a sequence that does not rise (409), so a reloaded page must start above everything this session has ever sent:
  // the larger of "last saved + 1" and the millisecond clock (at most 25 messages a second are accepted, so the clock always stays ahead).
  const lastSaved=Number(read(SEQUENCE_KEY));
  sequence=Math.max(Number.isSafeInteger(lastSaved)&&lastSaved>=0?lastSaved:0,Math.floor(now()));
  const nextSequence=()=>++sequence;
  const remember=()=>{write(SEQUENCE_KEY,sequence);};
  function link() {
    if(!enabled||!session)return null;
    const url=new URL('./overlay.html',baseHref);url.search=new URLSearchParams({mode:'synthetic',session}).toString();return url.href;
  }
  function enable() {
    if(enabled)return true;
    if(!session){onStatus('UNAVAILABLE','This browser cannot sync the synthetic pages.');return false;}
    enabled=true;onStatus('CONNECTING','Connecting to the local overlay.');return true;
  }
  function publish(snapshot,{force=false}={}) {
    if(!enabled||!session||(inFlight&&!force))return false;
    const sourcePoint=snapshot.mode==='PLAYING'?(getSourcePoint()??null):null;
    const viewer=getViewer();
    const combo=Number.isFinite(snapshot.combo)?{combo:clampInt(snapshot.combo,0,999)}:{};
    const message=makeOverlayState({session,sequence:nextSequence(),geometry:getGeometry(),snapshot:{...snapshot,...combo,...getExtras(snapshot),...(viewer?{viewer}:{})},sourcePoint});
    inFlight++;
    fetchImpl('./__overlay/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(1000)})
      .then(response=>{if(!response.ok)throw new Error('RELAY_UNAVAILABLE');if(enabled)onStatus('SENT','Synthetic data sent; keep this controller page open.');})
      .catch(()=>{if(enabled)onStatus('UNREACHABLE','Cannot reach the local overlay relay; check the local server.');})
      .finally(()=>{inFlight--;});
    return true;
  }
  function disable() {
    if(!enabled)return false;
    enabled=false;
    try{fetchImpl('./__overlay/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:OVERLAY_CLOSED_TYPE,session,sequence:nextSequence()}),credentials:'omit',redirect:'error',keepalive:true}).catch(()=>{});}catch{/* the overlay times out by itself */}
    remember();onStatus('STOPPED','Overlay sync stopped.');return true;
  }
  // Auto-sync preference: when ticked, the page switches the overlay on at load (the link is shown as usual).
  const auto=()=>read(AUTO_KEY)==='1';
  const setAuto=value=>write(AUTO_KEY,value?'1':'0');
  return {enable,disable,publish,link,remember,auto,setAuto,isEnabled:()=>enabled,persistent:()=>persistent,session:()=>session,sequence:()=>sequence};
}

// What the OBS camera source must look like to line up with the grid: flip, crop (pixels of the camera's own resolution) and rotation. Text only; no pixels leave the page.
export function obsCameraSetup(geometry,{auto=false}={}) {
  if(!geometry||!geometry.crop||!(geometry.sourceWidth>0)||!(geometry.sourceHeight>0))return null;
  const px=(fraction,size)=>Math.round(Math.max(0,fraction)*size),c=geometry.crop;
  const crop={left:px(c.left,geometry.sourceWidth),right:px(c.right,geometry.sourceWidth),top:px(c.top,geometry.sourceHeight),bottom:px(c.bottom,geometry.sourceHeight)};
  const flip=Boolean(geometry.mirror),rotation=Number(geometry.rotation)||0;
  const cropText=Object.values(crop).every(v=>v===0)?'no crop':`crop (Transform > Edit Transform) left ${crop.left} px, right ${crop.right} px, top ${crop.top} px, bottom ${crop.bottom} px`;
  const lines=[`OBS camera source (${geometry.sourceWidth}x${geometry.sourceHeight}): ${flip?'flip horizontal ON (Transform > Flip Horizontal)':'no flip'}, ${cropText}${rotation?`, rotate ${rotation} degrees`:''}; then fit it to the whole canvas.`];
  if(auto)lines.push('Auto-frame re-frames when you move a lot and these numbers then change: for a steady setup untick Auto-frame (or press Center me once) and copy the numbers.');
  return {flip,crop,rotation,sourceWidth:geometry.sourceWidth,sourceHeight:geometry.sourceHeight,text:lines.join(' ')};
}

const clampInt=(value,min,max)=>Math.max(min,Math.min(max,Math.round(Number.isFinite(value)?value:0)));
// What the controller page shows besides the arena, as protocol fields: the marquee (<= 8 items, names re-checked with the protocol's own validators and dropped if they fail,
// so one odd name can never blank the whole frame), the versus bar, the round clock and the current round banner. Colours never travel: only the tone.
export function buildOverlayExtras({entries=[],now=0,score=0,chatScore=0,banner=null,roundLeftMs}={}) {
  const ticker=[];
  for(const e of entries){
    if(ticker.length>=TICKER_LIMITS.items)break;
    const text=typeof e?.text==='string'?Array.from(e.text).slice(0,TICKER_LIMITS.textChars).join(''):'';
    if(!isTickerName(e?.name)||!isTickerText(text)||!TICKER_TONES.includes(e?.tone))continue;
    ticker.push({name:e.name,text,tone:e.tone,...(e.star===true?{star:true}:{}),ageMs:clampInt(now-e.at,0,TICKER_LIMITS.ageMs)});
  }
  const extra={versus:{streamer:clampInt(score,0,1e6),chat:clampInt(chatScore,0,1e6)}};
  if(ticker.length)extra.ticker=ticker;
  if(Number.isFinite(roundLeftMs))extra.roundLeftMs=clampInt(roundLeftMs,0,120000);
  const mapped=overlayBanner(banner,now);if(mapped)extra.banner=mapped;
  return extra;
}
// The page's banner object ({text,at,big?,grade?}) as a protocol banner, or null for anything that is not a countdown digit, GO! or the round result (hints are page-only).
export function overlayBanner(banner,now) {
  if(!banner||typeof banner.text!=='string'||!Number.isFinite(banner.at))return null;
  const ageMs=clampInt(now-banner.at,0,7000);if(now-banner.at>7000)return null;
  if(/^[1-3]$/.test(banner.text)&&banner.big)return {kind:'COUNTDOWN',text:banner.text,ageMs};
  if(banner.text==='GO!'&&banner.big)return {kind:'GO',text:'GO!',ageMs};
  if(/^ROUND OVER · SCORE \d{1,7}(?: · (?:STREAMER|CHAT) WINS)?$/.test(banner.text))return {kind:'ROUND_OVER',text:banner.text,...(['S','A','B'].includes(banner.grade)?{grade:banner.grade}:{}),ageMs};
  return null;
}
