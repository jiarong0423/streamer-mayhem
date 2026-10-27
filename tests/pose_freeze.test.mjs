import test from 'node:test';
import assert from 'node:assert/strict';
import {PoseFreeze,FREEZE_JOINTS} from '../dist/pose_freeze.mjs';

const pose=()=>({nose:{x:.5,y:.2,visibility:1},leftShoulder:{x:.42,y:.4,visibility:1},rightShoulder:{x:.58,y:.4,visibility:1},leftElbow:{x:.4,y:.65,visibility:1},rightElbow:{x:.6,y:.65,visibility:1}});
function setup(options={}){
  const freeze=new PoseFreeze(options);let now=0,id=0,lastPose=pose(),lastMode='PLAYING';
  const frame=(at,points=lastPose)=>({frameId:`p-${++id}`,captureTime:at,...structuredClone(points)});
  const initial=frame(0);assert.equal(freeze.start({eventId:'challenge',now:0,frame:initial}),true);
  const sample=(at,points=lastPose,mode=lastMode)=>{
    while(now+200<at){now+=200;freeze.update({now,frame:frame(now,lastPose),mode:lastMode});}
    now=at;lastPose=structuredClone(points);lastMode=mode;
    return freeze.update({now,frame:frame(now,points),mode});
  };
  return {freeze,sample,frame,now:()=>now};
}

test('a fresh pre-admission capture cannot provide yellow time',()=>{
  const freeze=new PoseFreeze();let id=0;
  const frame=at=>({frameId:`entry-${++id}`,captureTime:at,...pose()});
  assert.equal(freeze.start({eventId:'later-event',now:100,frame:frame(0)}),true);
  for(const at of [200,400,600,800,1000,1200,1400,1500])freeze.update({now:at,frame:frame(at),mode:'PLAYING'});
  assert.equal(freeze.snapshot().phase,'YELLOW');assert.equal(freeze.snapshot().remainingMs,200);
  freeze.update({now:1700,frame:frame(1700),mode:'PLAYING'});assert.equal(freeze.snapshot().phase,'RED');
});

test('UNKNOWN observation floor rejects delayed captures and duplicate renders do not move it',()=>{
  const freeze=new PoseFreeze();let id=0;
  const frame=(at,points=pose())=>({frameId:`floor-${++id}`,captureTime:at,...points});
  const run=(now,at,points=pose(),mode='PLAYING')=>freeze.update({now,frame:frame(at,points),mode});
  freeze.start({eventId:'unknown-floor',now:0,frame:frame(0)});
  for(const at of [200,400,600,800])run(at,at);
  const lost=pose();lost.leftElbow=null;const invalid=frame(850,lost);
  freeze.update({now:1000,frame:invalid,mode:'PLAYING'});
  freeze.update({now:1050,frame:invalid,mode:'PLAYING'});
  run(1050,900);assert.equal(freeze.snapshot().recoveryRemaining,1000);
  run(1100,1100);assert.equal(freeze.snapshot().recoveryRemaining,1000);
  for(const at of [1300,1500,1700,1900,2100])run(at,at);
  assert.equal(freeze.snapshot().recoveryRemaining,0);assert.equal(freeze.snapshot().remainingMs,700);
  run(2300,2300);assert.equal(freeze.snapshot().remainingMs,500);
});

test('resume and global PLAYING floors reject delayed phase evidence without restarting preparation',()=>{
  const freeze=new PoseFreeze({recovery:400});let id=0;
  const frame=at=>({frameId:`resume-${++id}`,captureTime:at,...pose()});
  const run=(now,at,mode)=>freeze.update({now,frame:frame(at),mode});
  freeze.start({eventId:'resume-floor',now:0,frame:frame(0)});
  run(200,200,'PLAYING');run(400,400,'PAUSED');run(600,600,'PAUSED');
  run(700,650,'RECOVERING');run(800,750,'RECOVERING');
  assert.equal(freeze.snapshot().recoveryRemaining,400);
  run(950,950,'RECOVERING');run(1150,1150,'RECOVERING');
  assert.equal(freeze.snapshot().recoveryRemaining,0);
  run(1200,1175,'PLAYING');assert.equal(freeze.snapshot().remainingMs,1300);
  run(1250,1190,'PLAYING');assert.equal(freeze.snapshot().remainingMs,1300);
  run(1300,1300,'PLAYING');assert.equal(freeze.snapshot().remainingMs,1300);
  run(1500,1500,'PLAYING');assert.equal(freeze.snapshot().remainingMs,1100);
});

test('new challenge generation and recovery0 do not borrow old evidence',()=>{
  const freeze=new PoseFreeze({recovery:0});let id=0;
  const frame=(at,points=pose())=>({frameId:`generation-${++id}`,captureTime:at,...points});
  freeze.start({eventId:'old',now:0,frame:frame(0)});freeze.cancel('SOURCE_STOPPED',100);freeze.takeResult();
  freeze.start({eventId:'new',now:100,frame:frame(0)});
  freeze.update({now:200,frame:frame(200),mode:'PLAYING'});
  assert.equal(freeze.snapshot().remainingMs,1500);
  const lost=pose();lost.rightElbow.visibility=0;
  freeze.update({now:300,frame:frame(300,lost),mode:'PLAYING'});
  freeze.update({now:400,frame:frame(400),mode:'PLAYING'});
  assert.equal(freeze.snapshot().remainingMs,1500);assert.equal(freeze.snapshot().recoveryRemaining,0);
  freeze.update({now:500,frame:frame(500),mode:'PLAYING'});assert.equal(freeze.snapshot().remainingMs,1400);
});

test('confidence and finite duration bounds are exact at configured thresholds',()=>{
  for(const threshold of [0,.3,.55,.8,1]){
    const freeze=new PoseFreeze({confidence:threshold});
    for(const value of [0,.3,.55,.8,1,1.01,NaN,undefined]){
      const points=pose();points.rightElbow.visibility=value;
      assert.equal(freeze.canStart({frameId:'bounds',captureTime:0,...points},0),Number.isFinite(value)&&value>=threshold&&value<=1);
    }
  }
  for(const key of ['warning','hold','stable','recovery','maxAge']){
    for(const value of [Number.MIN_VALUE,60000])assert.doesNotThrow(()=>new PoseFreeze({[key]:value}));
    for(const value of [60000.001,Infinity,NaN,-1])assert.throws(()=>new PoseFreeze({[key]:value}),RangeError);
    if(['recovery','maxAge'].includes(key))assert.doesNotThrow(()=>new PoseFreeze({[key]:0}));
    else assert.throws(()=>new PoseFreeze({[key]:0}),RangeError);
  }
});

test('yellow and red use admitted capture evidence and settle success only once',()=>{
  const s=setup();s.sample(1499);assert.equal(s.freeze.snapshot().remainingMs,1);assert.equal(s.freeze.snapshot().phase,'YELLOW');
  s.sample(1500);assert.equal(s.freeze.snapshot().phase,'RED');assert.equal(s.freeze.snapshot().remainingMs,2500);
  s.sample(3999);assert.equal(s.freeze.takeResult(),null);s.sample(4000);
  assert.equal(s.freeze.takeResult().outcome,'DODGE');assert.equal(s.freeze.takeResult(),null);s.sample(4200);
  assert.equal(s.freeze.takeResult(),null);assert.equal(s.freeze.active,false);
});

test('bad pose requires distinct bad captures spanning150ms, not repeated render ticks',()=>{
  const s=setup();s.sample(1500);const bad=pose();bad.leftElbow.x=.2;s.sample(1800,bad);
  const held={frameId:s.freeze.lastFrameId,captureTime:1800,...bad};
  s.freeze.update({now:1949,frame:held,mode:'PLAYING'});assert.equal(s.freeze.takeResult(),null);
  s.sample(1949,bad);assert.equal(s.freeze.takeResult(),null);s.sample(1950,bad);
  assert.equal(s.freeze.takeResult().outcome,'HIT');assert.equal(s.freeze.takeResult(),null);
});

test('failure wins over hold completion at the same capture, shorter final jitter can pass',()=>{
  const fail=setup();fail.sample(1500);const bad=pose();bad.nose.x=.2;fail.sample(3850,bad);fail.sample(4000,bad);
  assert.equal(fail.freeze.takeResult().outcome,'HIT');
  const jitter=setup();jitter.sample(1500);jitter.sample(3900,bad);jitter.sample(4000,bad);
  assert.equal(jitter.freeze.takeResult().outcome,'DODGE');
});

test('missing joint at red entry pauses yellow and cannot create an anchor or reward',()=>{
  const s=setup();s.sample(1499);const missing=pose();missing.leftElbow=null;s.sample(1500,missing);
  assert.equal(s.freeze.snapshot().status,'UNKNOWN');assert.equal(s.freeze.snapshot().anchor,null);assert.equal(s.freeze.takeResult(),null);
  s.sample(1800,missing);s.sample(1900,pose());assert.equal(s.freeze.snapshot().recoveryRemaining,1000);
  s.sample(2899,pose());assert.equal(s.freeze.snapshot().recoveryRemaining,1);
  s.sample(2900,pose());assert.equal(s.freeze.snapshot().phase,'YELLOW');s.sample(2901,pose());
  assert.equal(s.freeze.snapshot().phase,'RED');assert.equal(s.freeze.snapshot().remainingMs,2500);
});

test('red anchor survives UNKNOWN while bad evidence clears and recovery overlaps parent',()=>{
  const s=setup();s.sample(1500);const anchor=s.freeze.snapshot().anchor;
  const lost=pose();lost.rightElbow.visibility=.1;s.sample(1650,lost);assert.equal(s.freeze.snapshot().status,'UNKNOWN');
  s.sample(1750,pose(),'RECOVERING');s.sample(2750,pose(),'RECOVERING');
  assert.equal(s.freeze.snapshot().recoveryRemaining,0);assert.equal(s.freeze.snapshot().status,'RECOVERING');
  s.sample(2751,pose(),'PLAYING');assert.deepEqual(s.freeze.snapshot().anchor,anchor);assert.equal(s.freeze.snapshot().remainingMs,2500);
  s.sample(2951,pose());assert.equal(s.freeze.snapshot().remainingMs,2300);
});

test('pause conserves phase while continued captures keep the source fresh',()=>{
  const s=setup();s.sample(1500);s.sample(1600,pose(),'PAUSED');s.sample(2400,pose(),'PAUSED');
  assert.equal(s.freeze.snapshot().status,'PAUSED');assert.equal(s.freeze.snapshot().remainingMs,2500);
  s.sample(2500,pose(),'RECOVERING');s.sample(3500,pose(),'RECOVERING');s.sample(3501,pose(),'PLAYING');
  assert.equal(s.freeze.snapshot().remainingMs,2500);s.sample(3601);assert.equal(s.freeze.snapshot().remainingMs,2400);
});

test('stale source, fresh capture after an excessive gap and terminal cancel cannot settle later',()=>{
  for(const reason of ['stale','gap','CALIBRATION_CHANGED','SOURCE_STOPPED','ROUND_END']){
    const s=setup();s.sample(1500);
    if(reason==='stale')s.freeze.update({now:1751,frame:{frameId:s.freeze.lastFrameId,captureTime:1500,...pose()},mode:'PLAYING'});
    else if(reason==='gap')s.freeze.update({now:2000,frame:s.frame(2000),mode:'PLAYING'});
    else if(reason==='ROUND_END')s.freeze.update({now:1500,frame:s.frame(1500),mode:'ROUND_END'});
    else s.freeze.cancel(reason,1500);
    assert.equal(s.freeze.takeResult().outcome,'UNKNOWN');assert.equal(s.freeze.active,false);
    s.freeze.update({now:5000,frame:s.frame(5000),mode:'PLAYING'});assert.equal(s.freeze.takeResult(),null);
  }
});

test('pose, anchor and option containers are copied; invalid options and clocks fail closed',()=>{
  const box={left:.3,right:.7,top:.04,bottom:.96},freeze=new PoseFreeze({box});box.left=.99;
  assert.equal(freeze.config.box.left,.3);const s=setup();s.sample(1500);const snap=s.freeze.snapshot();
  for(const name of FREEZE_JOINTS){snap.anchor[name].x=0;snap.pose[name].visibility=0;}
  assert.deepEqual(s.freeze.snapshot().anchor,pose());assert.deepEqual(s.freeze.snapshot().pose,pose());
  assert.throws(()=>s.freeze.update({now:1499,frame:s.frame(1499),mode:'PLAYING'}),RangeError);
  for(const patch of [{warning:0},{hold:-1},{stable:Infinity},{recovery:NaN},{confidence:2},{displacement:-1},{box:null},{box:{left:.8,right:.2,top:0,bottom:1}}])assert.throws(()=>new PoseFreeze(patch),RangeError);
  s.freeze.reset();assert.equal(s.freeze.active,false);assert.equal(s.freeze.takeResult(),null);
});
