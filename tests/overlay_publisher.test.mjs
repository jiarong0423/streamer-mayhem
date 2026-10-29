import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraGeometry} from '../dist/camera_geometry.mjs';
import {createOverlayPublisher} from '../dist/overlay_publisher.mjs';
import {OVERLAY_STATE_TYPE,OVERLAY_CLOSED_TYPE} from '../dist/overlay_protocol.mjs';

const geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
const snap=(extra={})=>({mode:'PLAYING',attacks:[],score:5,hp:100,...extra});
function rig(options={}){
  const calls=[],statuses=[],pending=[];
  const fetchImpl=(url,init)=>{
    const call={url,init,body:JSON.parse(init.body)};calls.push(call);
    if(options.fail)return Promise.reject(new Error('down'));
    return new Promise(resolve=>pending.push(()=>resolve({ok:options.ok!==false})));
  };
  const publisher=createOverlayPublisher({getGeometry:()=>geometry,getSourcePoint:()=>({x:.5,y:.5,visibility:1}),getViewer:()=>options.viewer,fetchImpl,baseHref:'http://localhost:4173/',onStatus:(code,text)=>statuses.push([code,text]),...options.extra});
  return {publisher,calls,statuses,settle:()=>{while(pending.length)pending.shift()();return new Promise(r=>setTimeout(r,0));}};
}

test('F0 nothing is sent until the overlay is enabled; the link only exists while enabled',()=>{
  const {publisher,calls}=rig();
  assert.equal(publisher.publish(snap()),false);assert.equal(calls.length,0);assert.equal(publisher.link(),null);
  assert.equal(publisher.enable(),true);
  const url=new URL(publisher.link());assert.equal(url.pathname,'/overlay.html');assert.equal(url.searchParams.get('mode'),'synthetic');assert.match(url.searchParams.get('session'),/^[a-f0-9]{32}$/);
  publisher.disable();assert.equal(publisher.link(),null);
});

test('F0 only one request is in flight; force bypasses that; sequence rises by one per message',async()=>{
  const {publisher,calls,settle}=rig();publisher.enable();
  assert.equal(publisher.publish(snap()),true);assert.equal(publisher.publish(snap()),false);assert.equal(calls.length,1);
  assert.equal(publisher.publish(snap(),{force:true}),true);assert.equal(calls.length,2);
  assert.equal(calls[1].body.sequence,calls[0].body.sequence+1);
  await settle();assert.equal(publisher.publish(snap()),true);assert.equal(calls.length,3);
  for(const c of calls){assert.equal(c.url,'./__overlay/state');assert.equal(c.body.type,OVERLAY_STATE_TYPE);assert.equal(c.init.credentials,'omit');assert.equal(c.init.redirect,'error');}
});

test('F0 disable sends a CLOSED message with a later sequence and reports STOPPED',async()=>{
  const {publisher,calls,statuses,settle}=rig();publisher.enable();publisher.publish(snap());await settle();
  assert.equal(publisher.disable(),true);
  const closed=calls.at(-1);assert.equal(closed.body.type,OVERLAY_CLOSED_TYPE);assert.ok(closed.body.sequence>calls[0].body.sequence);assert.equal(closed.init.keepalive,true);
  assert.equal(statuses.at(-1)[0],'STOPPED');assert.equal(publisher.disable(),false);assert.equal(publisher.publish(snap()),false);
});

test('F0 failures are reported as UNREACHABLE and do not throw or wedge the publisher',async()=>{
  const {publisher,statuses,settle}=rig({fail:true});publisher.enable();publisher.publish(snap());await settle();
  assert.equal(statuses.at(-1)[0],'UNREACHABLE');assert.equal(publisher.publish(snap()),true);
  const bad=rig({ok:false});bad.publisher.enable();bad.publisher.publish(snap());await bad.settle();assert.equal(bad.statuses.at(-1)[0],'UNREACHABLE');
});

test('F0 the tracked point and the viewer name are sent only while they apply',()=>{
  const r=rig({viewer:'Mika'});r.publisher.enable();
  r.publisher.publish(snap());assert.equal(r.calls[0].body.snapshot.viewer,'Mika');assert.deepEqual(Object.keys(r.calls[0].body.sourcePoint).sort(),['visibility','x','y']);
  r.publisher.publish(snap({mode:'PAUSED'}),{force:true});assert.equal(r.calls[1].body.sourcePoint,null);
});

test('F0 without secure random the publisher reports UNAVAILABLE and never enables',()=>{
  const statuses=[];const p=createOverlayPublisher({getGeometry:()=>geometry,fetchImpl:()=>Promise.reject(new Error('no')),cryptoImpl:{},onStatus:(c)=>statuses.push(c)});
  assert.equal(p.enable(),false);assert.equal(statuses[0],'UNAVAILABLE');assert.equal(p.session(),null);
});

// ---- F1: persistent session, sequence that never goes back, auto-sync preference ----
import {SESSION_KEY,SEQUENCE_KEY,AUTO_KEY,obsCameraSetup} from '../dist/overlay_publisher.mjs';
import {createOverlayRelay} from '../scripts/overlay-relay.mjs';
import {fakeRequest,fakeResponse} from './helpers/relay_fakes.mjs';

const memoryStorage=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),map:m};};
const brokenStorage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
function make({storage,now=()=>5000,fetchImpl=()=>Promise.resolve({ok:true}),onStatus=()=>{}}={}){
  const calls=[];
  const publisher=createOverlayPublisher({getGeometry:()=>geometry,fetchImpl:(u,i)=>{calls.push(JSON.parse(i.body));return fetchImpl(u,i);},storage,now,onStatus});
  return {publisher,calls};
}

test('F1 the session survives a reload and is the one stored under sm.overlay.session',()=>{
  const storage=memoryStorage();
  const a=make({storage}).publisher,b=make({storage}).publisher;
  assert.equal(a.session(),b.session());assert.equal(storage.map.get(SESSION_KEY),a.session());assert.equal(a.persistent(),true);
  assert.equal(new URL((a.enable(),a.link())).searchParams.get('session'),a.session());
});

test('F1 an invalid stored session is replaced with a fresh valid one',()=>{
  for(const bad of ['','short','G'.repeat(32),'a'.repeat(31),'a'.repeat(33),'A'.repeat(32)]){
    const storage=memoryStorage();storage.map.set(SESSION_KEY,bad);
    const p=make({storage}).publisher;assert.match(p.session(),/^[a-f0-9]{32}$/);assert.notEqual(p.session(),bad);assert.equal(storage.map.get(SESSION_KEY),p.session());
  }
});

test('F1 storage that throws falls back to a random session, reports it, and still publishes',()=>{
  const a=make({storage:brokenStorage}).publisher,b=make({storage:brokenStorage}).publisher;
  assert.match(a.session(),/^[a-f0-9]{32}$/);assert.equal(a.persistent(),false);assert.notEqual(a.session(),b.session());
  assert.equal(a.auto(),false);assert.equal(a.setAuto(true),false);
  a.enable();assert.equal(a.publish(snap()),true);assert.doesNotThrow(()=>a.disable());
  const none=make({storage:null}).publisher;assert.equal(none.persistent(),false);assert.match(none.session(),/^[a-f0-9]{32}$/);
});

test('F1 the sequence never goes back, even when the clock does or the saved value is junk',()=>{
  const storage=memoryStorage();
  const first=make({storage,now:()=>1_000_000});first.publisher.enable();first.publisher.publish(snap(),{force:true});first.publisher.publish(snap(),{force:true});first.publisher.disable();
  const last=first.calls.at(-1).sequence;
  assert.ok(first.calls[0].sequence>1_000_000);assert.ok(last>first.calls[1].sequence);
  const second=make({storage,now:()=>10});second.publisher.enable();second.publisher.publish(snap(),{force:true});
  assert.ok(second.calls[0].sequence>last,'a reload with a clock that went back still starts above the last sent sequence');
  for(const junk of ['abc','-5','1.5','9'.repeat(30),'']){
    const s2=memoryStorage();s2.map.set(SEQUENCE_KEY,junk);const p=make({storage:s2,now:()=>77});p.publisher.enable();p.publisher.publish(snap());
    assert.ok(Number.isSafeInteger(p.calls[0].sequence)&&p.calls[0].sequence>=77,junk);
  }
});

test('F1 with the real clock the first sequence is above the millisecond time',()=>{
  const calls=[],p=createOverlayPublisher({getGeometry:()=>geometry,storage:memoryStorage(),fetchImpl:(u,i)=>{calls.push(JSON.parse(i.body));return Promise.resolve({ok:true});}});
  const before=Date.now();p.enable();p.publish(snap());
  assert.ok(calls[0].sequence>before);assert.ok(Number.isSafeInteger(calls[0].sequence));
});

test('F1 the closing message has the highest sequence and auto-sync is off by default and remembered when ticked',()=>{
  const storage=memoryStorage();const {publisher,calls}=make({storage});
  assert.equal(publisher.auto(),false);publisher.enable();publisher.publish(snap());publisher.disable();
  assert.equal(calls.at(-1).type,OVERLAY_CLOSED_TYPE);assert.ok(calls.at(-1).sequence>calls[0].sequence);
  assert.equal(publisher.setAuto(true),true);assert.equal(storage.map.get(AUTO_KEY),'1');assert.equal(make({storage}).publisher.auto(),true);
  publisher.setAuto(false);assert.equal(make({storage}).publisher.auto(),false);
});

test('F1 relay: a second controller run on the same session is accepted (204), not rejected as stale (409)',()=>{
  const relay=createOverlayRelay(),storage=memoryStorage(),status=[];
  const run=(now)=>{
    const publisher=createOverlayPublisher({getGeometry:()=>geometry,storage,now,onStatus:()=>{},
      fetchImpl:(url,init)=>{const req=fakeRequest({host:'localhost:4173',origin:'http://localhost:4173',body:init.body}),res=fakeResponse();relay.handle(req,res);req.send();status.push(res.status);return Promise.resolve({ok:true});}});
    publisher.enable();publisher.publish(snap(),{force:true});publisher.publish(snap(),{force:true});publisher.disable();
  };
  try{run(()=>2_000_000);run(()=>1_000);run(()=>3_000_000);}finally{relay.close();}
  assert.deepEqual(status,[204,204,204,204,204,204,204,204,204]);
});

// ---- F6: OBS camera source numbers ----
test('F6 obsCameraSetup derives flip and pixel crop from the geometry and warns about auto-frame only when asked',()=>{
  const g=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1920,sourceHeight:1080,mirror:true,crop:{left:.25,right:.25,top:.1,bottom:.2}});
  const s=obsCameraSetup(g);
  assert.equal(s.flip,true);assert.deepEqual(s.crop,{left:480,right:480,top:108,bottom:216});
  assert.match(s.text,/flip horizontal ON/);assert.match(s.text,/left 480 px, right 480 px, top 108 px, bottom 216 px/);assert.doesNotMatch(s.text,/Auto-frame/);
  assert.match(obsCameraSetup(g,{auto:true}).text,/Auto-frame/);
  const plain=obsCameraSetup(createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720,mirror:false}));
  assert.equal(plain.flip,false);assert.match(plain.text,/no flip/);assert.match(plain.text,/no crop/);
  assert.equal(obsCameraSetup(null),null);
});
