import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixGame,CROSS_CELLS} from '../dist/matrix.mjs';
import {drawMatrix,drawCameraOverlay,gridRects} from '../dist/matrix_view.mjs';
import {createCameraGeometry} from '../dist/camera_geometry.mjs';

const center=cell=>({x:((cell-1)%3+.5)/3,y:(Math.floor((cell-1)/3)+.5)/3,visibility:1});
function setup(options={}) {
  let now=0,serial=0;const events=[];
  const game=new MatrixGame({clock:()=>now,onEvent:event=>events.push(event),options});
  const frame=(at,cell=5)=>{now=at;return game.addFrame({frameId:`frame-${++serial}`,captureTime:at,
    nose:cell===null?null:center(cell),leftShoulder:center(4),rightShoulder:center(6)});};
  const advance=(at,cell=5)=>{
    while(now+200<at){frame(now+200,cell);game.tick();}
    frame(at,cell);return game.tick();
  };
  const event=(extra={})=>({notificationId:`n-${++serial}`,messageId:`m-${serial}`,actorId:'cross-viewer',receivedAt:now,...extra});
  game.setConnection(true);game.start();frame(0);game.tick();
  return {game,events,frame,advance,event,setTime:at=>{now=at;}};
}

test('CROSS all nine positions: five danger cells, four safe corners, one outcome',()=>{
  for(let cell=1;cell<=9;cell++){
    const s=setup(),accepted=s.game.receiveSyntheticCross(s.event());
    assert.equal(accepted.accepted,true);assert.deepEqual(accepted.cells,[2,4,5,6,8]);
    assert.equal(s.game.attacks[0].due,1500);
    s.advance(1499,cell);assert.equal(s.game.results.length,0);
    s.advance(1500,cell);s.game.tick();
    assert.equal(s.game.results.length,1);
    const danger=CROSS_CELLS.includes(cell),result=s.game.results[0];
    assert.equal(result.outcome,danger?'HIT':'DODGE');assert.equal(result.hpDelta,danger?-15:0);
    assert.equal(result.scoreDelta,danger?0:25);assert.equal(result.sampledAt,1500);
    assert.equal(result.kind,'CROSS');assert.deepEqual(result.cells,[2,4,5,6,8]);
    assert.equal(s.game.attacks.length,0);
  }
});

test('CROSS uses the final sampled position, supports simultaneous throw without fivefold damage',()=>{
  const s=setup({globalCooldown:0});s.game.receiveSyntheticCross(s.event());
  s.game.receiveChat(s.event({actorId:'throw-viewer',text:'!throw 5'}));
  s.advance(500);assert.equal(s.game.hp,85);assert.equal(s.game.attacks.length,1);
  s.advance(1499);s.advance(1500,1);
  assert.deepEqual(s.game.results.map(r=>r.outcome),['HIT','DODGE']);assert.equal(s.game.hp,85);assert.equal(s.game.score,25);
});

test('CROSS shares both dedupe identities with throws, including after reset',()=>{
  const s=setup(),event=s.event();s.game.receiveSyntheticCross(event);
  assert.equal(s.game.receiveSyntheticCross({...event,messageId:'different'}).reason,'DUPLICATE');
  assert.equal(s.game.receiveChat({...event,notificationId:'different',text:'!throw 1'}).reason,'DUPLICATE');
  s.game.reset();s.game.setConnection(true);s.game.start();
  assert.equal(s.game.receiveSyntheticCross(event).reason,'DUPLICATE');assert.equal(s.game.attacks.length,0);
});

test('CROSS shares global/actor cooldowns and bounded queue with throws',()=>{
  const s=setup();assert.equal(s.game.receiveSyntheticCross(s.event()).accepted,true);
  assert.equal(s.game.receiveChat(s.event({actorId:'other',text:'!throw 1'})).reason,'GLOBAL_COOLDOWN');
  s.advance(1500);assert.equal(s.game.receiveSyntheticCross(s.event()).reason,'ACTOR_COOLDOWN');
  s.advance(3000);assert.equal(s.game.receiveSyntheticCross(s.event()).accepted,true);
  const q=setup({globalCooldown:0,maxAttacks:2});
  for(const actorId of ['a','b'])assert.equal(q.game.receiveSyntheticCross(q.event({actorId})).accepted,true);
  assert.equal(q.game.receiveSyntheticCross(q.event({actorId:'c'})).reason,'QUEUE_FULL');assert.equal(q.game.attacks.length,2);
});

test('CROSS rejects inactive/offline/stale sources and never replays rejected events on reconnect',()=>{
  for(const mode of ['IDLE','PAUSED','TRACKING_LOST','RECOVERING','ROUND_END']){
    const s=setup();if(mode==='RECOVERING')s.game.beginRecovery();else s.game.mode=mode;
    assert.equal(s.game.receiveSyntheticCross(s.event()).reason,'NOT_PLAYING');
    assert.equal(s.game.attacks.length,0);
  }
  const s=setup(),event=s.event();s.game.setConnection(false);
  assert.equal(s.game.receiveSyntheticCross(event).reason,'OFFLINE');s.game.setConnection(true);
  assert.equal(s.game.receiveSyntheticCross(event).reason,'DUPLICATE');assert.equal(s.game.attacks.length,0);
  s.setTime(251);assert.equal(s.game.receiveSyntheticCross(s.event()).reason,'NOT_PLAYING');
  assert.equal(s.game.mode,'TRACKING_LOST');
});

test('CROSS rejects malformed identities and is unavailable as a chat/Bits command',()=>{
  const s=setup();
  for(const event of [null,{},s.event({messageId:''}),s.event({actorId:'x'.repeat(129)}),s.event({receivedAt:1})]){
    assert.equal(s.game.receiveSyntheticCross(event).reason,'INVALID_EVENT');
  }
  for(const text of ['!cross','!cross 5','!bits 500','cheer500'])assert.equal(s.game.receiveChat(s.event({text})).reason,'INVALID_COMMAND');
  assert.equal(s.game.attacks.length,0);
});

test('CROSS loss at deadline pauses the attack through recovery, without speculative damage',()=>{
  const s=setup();s.game.receiveSyntheticCross(s.event());s.advance(1499);s.setTime(1500);s.game.loseLandmarks();
  assert.equal(s.game.mode,'TRACKING_LOST');assert.equal(s.game.results.length,0);assert.equal(s.game.hp,100);
  s.advance(2000,1);assert.equal(s.game.mode,'RECOVERING');
  s.advance(3000,1);assert.equal(s.game.mode,'PLAYING');s.advance(3001,1);
  assert.equal(s.game.results.length,1);assert.equal(s.game.results[0].outcome,'DODGE');
});

test('CROSS pause freezes warning and resumes only after preparation',()=>{
  const s=setup();s.game.receiveSyntheticCross(s.event());s.advance(600);s.game.pause();
  s.advance(2000,1);assert.equal(s.game.gameTime,600);assert.equal(s.game.results.length,0);
  s.game.resume();s.advance(3000,1);s.advance(3899,1);assert.equal(s.game.results.length,0);
  s.advance(3900,1);assert.equal(s.game.results[0].outcome,'DODGE');
});

test('CROSS stale source, calibration change and round end cancel as UNKNOWN once',()=>{
  for(const cancel of ['stale','calibration','round']){
    const s=setup();s.game.receiveSyntheticCross(s.event());
    if(cancel==='stale'){s.setTime(251);s.game.tick();}
    if(cancel==='calibration'){s.game.invalidateTracking();}
    if(cancel==='round'){
      s.game.hp=15;s.advance(400);s.game.receiveChat(s.event({actorId:'other',text:'!throw 5'}));s.advance(900);
    }
    const cross=s.game.results.filter(result=>result.kind==='CROSS');
    assert.equal(cross.length,1);assert.equal(cross[0].outcome,'UNKNOWN');assert.equal(cross[0].hpDelta,0);assert.equal(cross[0].scoreDelta,0);
    assert.deepEqual(cross[0].cells,[2,4,5,6,8]);assert.equal(s.game.attacks.length,0);s.game.tick();
    assert.equal(s.game.results.filter(result=>result.kind==='CROSS').length,1);
  }
});

test('CROSS unknown landmarks at impact never reward or damage',()=>{
  const s=setup();s.game.receiveSyntheticCross(s.event());s.advance(1499);s.advance(1500,null);
  assert.equal(s.game.results[0].outcome,'UNKNOWN');assert.equal(s.game.hp,100);assert.equal(s.game.score,0);
});

test('CROSS result, admission and snapshot cell arrays cannot change future collisions',()=>{
  const s=setup(),result=s.game.receiveSyntheticCross(s.event());result.cells.splice(0);
  s.game.snapshot().attacks[0].cells.splice(0);s.advance(1500);
  assert.equal(s.game.results[0].outcome,'HIT');s.game.snapshot().lastResult.cells.splice(0);
  assert.deepEqual(s.game.results[0].cells,[2,4,5,6,8]);
  for(const value of [-1,NaN,Infinity])assert.throws(()=>setup({crossWarning:value}),RangeError);
});

test('CROSS both Canvas renderers warn on exactly five cells and leave corners clear',()=>{
  const geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
  const snapshot={mode:'PLAYING',attacks:[{cell:5,cells:[...CROSS_CELLS]}]};
  for(const render of [ctx=>drawCameraOverlay(ctx,geometry,snapshot),ctx=>drawMatrix(ctx,snapshot,{viewWidth:1280,viewHeight:720,sourceWidth:1280,sourceHeight:720})]){
    const fills=[],ctx={canvas:{width:1280,height:720},fillRect:(...args)=>fills.push(args)};
    for(const name of ['clearRect','save','restore','beginPath','rect','clip','strokeRect','fillText'])ctx[name]=()=>{};
    render(ctx);const cells=gridRects(geometry.visible);
    assert.deepEqual(fills,CROSS_CELLS.map(cell=>{const r=cells[cell-1];return [r.x,r.y,r.width,r.height];}));
  }
});
