import test from 'node:test';
import assert from 'node:assert/strict';
import { MatrixGame, ExperimentalGame } from '../dist/engine.mjs';
import { gridCell, parseMatrixCommand } from '../dist/matrix.mjs';
import { containRect, gridRects, mapPoint, audioStatus, drawMatrix } from '../dist/matrix_view.mjs';

const point = (x=.5,y=.5,visibility=1) => ({x,y,visibility});
const center = n => point(((n-1)%3+.5)/3,(Math.floor((n-1)/3)+.5)/3);
const freshFrame = (id,at,nose=point(),left=point(.4,.5),right=point(.6,.5)) =>
  ({frameId:id,captureTime:at,nose,leftShoulder:left,rightShoulder:right});

function setup(options={}) {
  const clock={now:0}; const events=[];
  const game=new MatrixGame({clock:()=>clock.now,onEvent:e=>events.push(e),options});
  game.setConnection(true); game.start(); game.addFrame(freshFrame('initial',0)); game.tick();
  let serial=0;
  // Simulate continuous producer frames between observations; tests for gaps use the clock directly.
  const advance=(at)=>{
    while(game.latestFrame && clock.now+Math.min(200,game.config.maxAge||1)<at){
      clock.now+=Math.min(200,game.config.maxAge||1);const previous=game.latestFrame;
      assert.equal(game.addFrame(freshFrame(`continuity-${++serial}`,clock.now,previous.nose,previous.leftShoulder,previous.rightShoulder)),true);game.tick();
    }
  };
  const inject=(at, frame=freshFrame(`frame-${++serial}`,at))=>{
    advance(at);clock.now=at; if(frame) assert.equal(game.addFrame(frame),true); game.tick();
  };
  const send=(at,text='!throw 5',actor='a',extras={})=>{
    clock.now=at;
    return game.receiveChat({notificationId:`n-${++serial}`,messageId:`m-${serial}`,actorId:actor,
      receivedAt:at,text,...extras});
  };
  return {clock,events,game,inject,send,advance};
}

test('CHAT-01 accepts cells and whitespace',()=>{
  for(let i=1;i<=9;i++){const s=setup();assert.deepEqual(s.send(0,`  !THROW \t${i} `).cell,i);assert.equal(s.game.attacks[0].cell,i);}
});
test('CHAT-02 rejects malformed commands',()=>{
  for(const text of ['!throw 0','!throw 10','!throw -1','!throw 1.0','!throw 1 extra','',null,'x'.repeat(101),'<script>']){
    const s=setup();assert.equal(s.send(0,text).reason,'INVALID_COMMAND');assert.equal(s.game.attacks.length,0);assert.equal(s.game.hp,100);}
});
test('CHAT-03 actor cooldown boundaries and rejection do not extend',()=>{
  const s=setup();assert.equal(s.send(0).accepted,true);s.inject(500);s.inject(2999);assert.equal(s.send(2999).reason,'ACTOR_COOLDOWN');
  s.inject(3000);assert.equal(s.send(3000).accepted,true);
});
test('CHAT-04 global cooldown boundaries',()=>{
  const s=setup();assert.equal(s.send(0).accepted,true);s.inject(399);assert.equal(s.send(399,'!throw 1','b').reason,'GLOBAL_COOLDOWN');
  s.inject(400);assert.equal(s.send(400,'!throw 1','b').accepted,true);
});
test('CHAT-05 bounded unfinished attack queue',()=>{
  const s=setup();s.game.attacks=Array.from({length:8},(_,i)=>({eventId:`seed-${i}`,cell:1,start:0,due:5000}));
  const before=s.game.attacks.map(a=>a.eventId);assert.equal(s.send(0).reason,'QUEUE_FULL');assert.deepEqual(s.game.attacks.map(a=>a.eventId),before);
  s.inject(5000,freshFrame('queue-impact',5000,center(1)));assert.equal(s.game.results.length,8);
  assert.equal(new Set(s.game.results.map(r=>r.eventId)).size,8);
});
test('CHAT-06 deduplicates either event identity with bounded TTL',()=>{
  const s=setup({dedupeTtl:10000,dedupeLimit:2});const e={notificationId:'n1',messageId:'m1'};
  assert.equal(s.send(0,'!throw 5','a',e).accepted,true);
  assert.equal(s.send(0,'!throw 5','a',e).reason,'DUPLICATE');
  assert.equal(s.send(0,'!throw 5','a',{notificationId:'n2',messageId:'m1'}).reason,'DUPLICATE');
  assert.equal(s.send(0,'!throw 5','a',{notificationId:'n1',messageId:'m2'}).reason,'DUPLICATE');
  assert.equal(s.game.attacks.length,1);assert.equal(s.game.attacks[0].due,500);
  s.inject(500);s.inject(10000);assert.equal(s.send(10000,'!throw 5','a',e).accepted,true);
  assert.ok(s.game.notifications.size<=2);assert.ok(s.game.messages.size<=2);
});
test('CHAT-07 distinct IDs not deduped by text',()=>{
  const s=setup();assert.equal(s.send(0,'!throw 5','a').accepted,true);
  s.inject(400);assert.equal(s.send(400,'!throw 5','b').accepted,true);
});
test('CHAT-08 refuses paused, lost, and ended',()=>{
  for(const mode of ['PAUSED','TRACKING_LOST','ROUND_END']){const s=setup();s.game.mode=mode;
    assert.equal(s.send(0).reason,'NOT_PLAYING');assert.equal(s.game.attacks.length,0);}
});
test('CHAT-09 disconnected synthetic source is visibly offline and cannot invent events',()=>{
  const s=setup();s.game.setConnection(false);assert.equal(s.game.snapshot().connection,'OFFLINE');
  assert.equal(s.send(0).reason,'OFFLINE');assert.equal(s.game.attacks.length,0);
  s.game.setConnection(true);assert.equal(s.game.attacks.length,0);
});
test('CHAT rejects invalid and oversized identities and synchronizes tracking before admission',()=>{
  const s=setup();assert.equal(s.send(0,'!throw 1','a',{messageId:'x'.repeat(129)}).reason,'INVALID_EVENT');
  s.clock.now=251;assert.equal(s.send(251,'!throw 1','a').reason,'NOT_PLAYING');assert.equal(s.game.mode,'TRACKING_LOST');
});

test('HIT-01 all 81 target and position pairs',()=>{
  for(let target=1;target<=9;target++)for(let position=1;position<=9;position++){
    const s=setup();assert.equal(s.send(0,`!throw ${target}`).accepted,true);
    s.advance(500);s.clock.now=500;assert.equal(s.game.addFrame(freshFrame('impact',500,center(position))),true);s.game.tick();
    const result=s.game.results[0];assert.equal(result.outcome,target===position?'HIT':'DODGE');
    assert.equal(result.hpDelta,target===position?-15:0);assert.equal(result.scoreDelta,target===position?0:25);
    assert.equal(result.sampledFrameId,'impact');s.game.tick();assert.equal(s.game.results.length,1);
  }
});
test('HIT-02 warning lasts exactly 500ms',()=>{
  const s=setup();s.send(0);s.inject(499);assert.equal(s.game.results.length,0);assert.equal(s.game.attacks.length,1);
  s.inject(500);assert.equal(s.game.results[0].outcome,'HIT');assert.equal(s.game.results[0].sampledAt,500);
});
test('HIT-03 uses latest at impact rather than initial position',()=>{
  const s=setup();s.send(0);s.inject(499,freshFrame('moved',499,center(1)));s.clock.now=500;s.game.tick();
  assert.equal(s.game.results[0].outcome,'DODGE');assert.equal(s.game.results[0].sampledFrameId,'moved');
});
test('HIT-04 interior boundaries inclusive on right/bottom',()=>{
  const e=1e-9, values=[0,1/3-e,1/3,1/3+e,2/3-e,2/3,2/3+e,1];
  const index=v=>v<1/3?0:v<2/3?1:2;
  for(const x of values)for(const y of values)assert.equal(gridCell(point(x,y)),index(y)*3+index(x)+1);
});
test('HIT-05 out-of-range and nonfinite are not cells',()=>{
  for(const p of [point(-1e-6,.5),point(1+1e-6,.5),point(NaN,.5),point(Infinity,.5),point(.5,.5,.54),{x:.5,y:.5}])assert.equal(gridCell(p),null);
});
test('HIT-06 mirror is applied once to geometry and collision',()=>{
  const rect=containRect(1280,720,1280,720), p=center(1), mapped=mapPoint(p,rect,true);
  assert.equal(gridCell(point((mapped.x-rect.x)/rect.width,(mapped.y-rect.y)/rect.height)),3);
  assert.equal(gridCell(p),1);
});
test('HIT-07 two different due events settle once each without immunity',()=>{
  const s=setup();s.game.attacks=[{eventId:'a',cell:5,start:0,due:500},{eventId:'b',cell:5,start:0,due:500}];
  s.inject(500);assert.deepEqual(s.game.results.map(r=>r.hpDelta),[-15,-15]);assert.equal(s.game.hp,70);
  s.game.tick();assert.equal(s.game.results.length,2);
});
test('HIT-08 frame injected at deadline precedes tick and cannot be backfilled',()=>{
  const s=setup();s.send(0);s.advance(500);s.clock.now=500;assert.equal(s.game.addFrame(freshFrame('latest',500,center(1))),true);s.game.tick();
  assert.equal(s.game.results[0].outcome,'DODGE');assert.equal(s.game.results[0].sampledFrameId,'latest');
  s.clock.now=501;assert.equal(s.game.addFrame(freshFrame('late',499,center(5))),false);assert.equal(s.game.results[0].outcome,'DODGE');
});
test('HIT stops remaining attacks safely after KO and bounds result memory',()=>{
  const s=setup({maxResults:3});s.game.hp=15;
  s.game.attacks=[{eventId:'a',cell:5,start:0,due:500},{eventId:'b',cell:5,start:0,due:500}];s.inject(500);
  assert.deepEqual(s.game.results.map(r=>[r.eventId,r.outcome]),[['a','HIT'],['b','UNKNOWN']]);
  assert.equal(s.game.results[1].reason,'ROUND_END');assert.equal(s.game.attacks.length,0);
  for(let i=0;i<10;i++)s.game.recordResult({eventId:String(i),outcome:'UNKNOWN'});
  assert.equal(s.game.results.length,3);
});

test('TRACK-01 missing, low, or absent confidence yields UNKNOWN at deadline',()=>{
  for(const nose of [null,point(.5,.5,.54),{x:.5,y:.5}]){const s=setup();s.send(0);s.inject(500,freshFrame('invalid',500,nose));
    assert.equal(s.game.results[0].outcome,'UNKNOWN');assert.equal(s.game.hp,100);assert.equal(s.game.score,0);assert.equal(s.game.mode,'TRACKING_LOST');}
});
test('TRACK-02 frame age boundary and replayed frame rejection',()=>{
  for(const [age,expected] of [[250,'HIT'],[251,'UNKNOWN']]){const s=setup();s.send(0);s.inject(250,freshFrame('age',250));s.clock.now=250+age;
    s.game.tick();assert.equal(s.game.results[0].outcome,expected);}
  const s=setup();s.clock.now=10;assert.equal(s.game.addFrame(freshFrame('initial',10)),false);
  assert.equal(s.game.addFrame(freshFrame('future',11)),false);assert.equal(s.game.addFrame(freshFrame('back',-1)),false);
});
test('TRACK-03 no core joints is lost, never ring out',()=>{
  const s=setup();s.inject(10,freshFrame('none',10,null,null,null));assert.equal(s.game.mode,'TRACKING_LOST');
  s.clock.now=2010;s.game.tick();assert.equal(s.game.hp,100);assert.equal(s.events.filter(e=>e.type==='ringOut').length,0);
  const legacy=new ExperimentalGame();legacy.start();for(let i=0;i<20;i++)legacy.step(.1);assert.equal(legacy.hp,100);
});
test('TRACK-04 definite out at 999 and 1000ms',()=>{
  const s=setup();const outside=point(.01,.5);s.inject(1,freshFrame('out',1,outside,outside,outside));
  s.inject(1000,freshFrame('out2',1000,outside,outside,outside));assert.equal(s.game.hp,100);
  s.inject(1001,freshFrame('out3',1001,outside,outside,outside));assert.equal(s.game.hp,90);assert.equal(s.events.filter(e=>e.type==='ringOut').length,1);
});
test('TRACK-05 any known inside resets out timer',()=>{
  const s=setup();const outside=point(.01,.5);s.inject(1,freshFrame('out',1,outside,outside,outside));
  s.inject(701,freshFrame('inside',701,outside,point(.5,.5),outside));s.inject(702,freshFrame('again',702,outside,outside,outside));
  s.inject(1701,freshFrame('almost',1701,outside,outside,outside));assert.equal(s.game.hp,100);
  s.inject(1702,freshFrame('done',1702,outside,outside,outside));assert.equal(s.game.hp,90);
});
test('TRACK-06 loss freezes warning and recovery countdown',()=>{
  const s=setup();s.send(0);s.inject(300,freshFrame('lost',300,null,null,null));assert.equal(s.game.mode,'TRACKING_LOST');assert.equal(s.game.gameTime,300);
  s.inject(5300,freshFrame('still-lost',5300,null,null,null));assert.equal(s.game.results.length,0);assert.equal(s.game.gameTime,300);
  s.inject(5301,freshFrame('recover',5301));assert.equal(s.game.mode,'RECOVERING');
  s.inject(6301,freshFrame('ready',6301));assert.equal(s.game.mode,'PLAYING');assert.equal(s.game.gameTime,300);
  s.inject(6500);assert.equal(s.game.results.length,0);s.inject(6501);assert.equal(s.game.results[0].outcome,'HIT');
});
test('TRACK-07 manual pause does not advance active time',()=>{
  const s=setup();s.send(0);s.inject(300);assert.equal(s.game.pause(),true);s.inject(5300,freshFrame('resume',5300));assert.equal(s.game.gameTime,300);
  assert.equal(s.game.resume(),true);s.inject(6300);s.inject(6500);
  assert.equal(s.game.results.length,1);assert.equal(s.game.results[0].outcome,'HIT');
});
test('TRACK-08 partial outside is unknown and resets ring timer',()=>{
  const s=setup();const out=point(.01,.5);s.inject(1,freshFrame('out',1,out,out,out));
  s.inject(701,freshFrame('partial',701,out,null,null));s.inject(702,freshFrame('out2',702,out,out,out));
  s.inject(1701,freshFrame('almost',1701,out,out,out));assert.equal(s.game.hp,100);s.inject(1702,freshFrame('done',1702,out,out,out));assert.equal(s.game.hp,90);
});
test('TRACK a large clock jump does not resolve later attacks after loss',()=>{
  const s=setup();s.game.attacks=[{eventId:'a',cell:5,start:0,due:500},{eventId:'b',cell:5,start:0,due:1000}];
  s.clock.now=5000;s.game.tick();assert.equal(s.game.mode,'TRACKING_LOST');
  assert.deepEqual(s.game.results.map(r=>r.outcome),['UNKNOWN','UNKNOWN']);assert.equal(s.game.attacks.length,0);assert.equal(s.game.gameTime,0);
});

function canvasRecorder(){const calls=[];const ctx={calls};for(const method of ['save','restore','beginPath','rect','clip','strokeRect','fillText','fillRect','arc','fill'])ctx[method]=(...args)=>calls.push({method,args,fillStyle:ctx.fillStyle});return ctx;}
function view(snapshot,opts={}){const ctx=canvasRecorder();const result=drawMatrix(ctx,snapshot,{viewWidth:1280,viewHeight:720,sourceWidth:1280,sourceHeight:720,...opts});return {ctx,...result};}
test('VIEW-01 nine numbered cells and one target warning',()=>{
  const s=setup();for(let n=1;n<=9;n++){const snap=s.game.snapshot();snap.attacks=[{cell:n}];const v=view(snap);
    assert.equal(v.cells.length,9);const fills=v.ctx.calls.filter(c=>c.method==='fillRect');assert.equal(fills.length,1);
    assert.deepEqual(fills[0].args,[v.cells[n-1].x,v.cells[n-1].y,v.cells[n-1].width,v.cells[n-1].height]);}
  s.send(0);s.inject(499);const warning=view(s.game.snapshot());assert.equal(warning.ctx.calls.filter(c=>c.method==='fillRect').length,1);
  s.inject(500);const result=view(s.game.snapshot());assert.equal(result.ctx.calls.filter(c=>c.method==='fillRect').length,0);assert.ok(result.labels.includes('HIT'));
});
test('VIEW-02 mirror point matches collision cell',()=>{
  const s=setup();s.send(0,'!throw 3');const v=view(s.game.snapshot(),{nose:center(1),mirror:true});
  assert.equal(gridCell(point(v.position.x/1280,v.position.y/720)),3);
  s.inject(500,freshFrame('mirrored-impact',500,point(v.position.x/1280,v.position.y/720)));
  assert.equal(s.game.results[0].outcome,'HIT');assert.equal(s.game.results[0].cell,3);
});
test('VIEW-03 contain grid excludes letterbox',()=>{
  const rect=containRect(1024,768,1280,720);assert.deepEqual(rect,{x:0,y:96,width:1024,height:576});
  const cells=gridRects(rect);assert.equal(cells[0].y,96);assert.equal(cells[8].y+cells[8].height,672);
});
test('VIEW-04 status and simulated labels',()=>{
  const s=setup();for(const [mode,expected] of [['TRACKING_LOST','TRACKING LOST'],['PAUSED','PAUSED'],['RECOVERING','READY 1']]){
    const snap={...s.game.snapshot(),mode,connection:'OFFLINE',recoveryRemaining:1000};const v=view(snap);
    assert.ok(v.labels.includes(expected));assert.ok(v.labels.includes('OFFLINE'));assert.ok(v.labels.includes('SIMULATED'));}
  const v=view({...s.game.snapshot(),lastResult:{outcome:'UNKNOWN'}});assert.ok(v.labels.includes('UNKNOWN'));assert.ok(!v.labels.includes('DODGE'));
});
test('VIEW-05 draws one result label as text and ignores attacker markup',()=>{
  const s=setup();const snap={...s.game.snapshot(),lastResult:{outcome:'HIT'},text:'<script>alert(1)</script>'+'x'.repeat(5000)};
  for(let i=0;i<2;i++){const v=view(snap);assert.equal(v.ctx.calls.filter(c=>c.method==='fillText'&&c.args[0]==='HIT').length,1);
    assert.ok(!v.ctx.calls.some(c=>c.method==='fillText'&&String(c.args[0]).includes('<script>')));}
});
test('VIEW-06 audio state does not alter game decisions',()=>{
  assert.equal(audioStatus(false,false),'MUTED');assert.equal(audioStatus(true,false),'AUDIO LOCKED');assert.equal(audioStatus(true,true),'AUDIO READY');
  const s=setup();s.send(0);const a=view(s.game.snapshot(),{soundEnabled:false});const b=view(s.game.snapshot(),{soundEnabled:true,audioUnlocked:false});
  assert.ok(a.labels.includes('MUTED'));assert.ok(b.labels.includes('AUDIO LOCKED'));s.inject(500);assert.equal(s.game.results[0].outcome,'HIT');
});
