import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {MatrixGame} from '../dist/matrix.mjs';

const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

function started(options){
  const clock={now:0},game=new MatrixGame({clock:()=>clock.now,options});game.setConnection(true);game.start();
  game.addFrame({frameId:'f1',captureTime:0,nose:{x:.5,y:.5,visibility:1},leftShoulder:null,rightShoulder:null});game.tick();
  return {game,clock};
}
const chat=(n,text,at=0)=>({notificationId:`n${n}`,messageId:`m${n}`,actorId:`a${n}`,receivedAt:at,text});

test('PATROL-01 chatThrow:false refuses the legacy !throw from chat but !drop and !pie still work',()=>{
  const {game}=started({landJitter:.12,avoidScore:0,chatThrow:false});
  for(let i=1;i<=9;i++)assert.equal(game.receiveChat(chat(i,`!throw ${i}`)).reason,'INVALID_COMMAND',`!throw ${i}`);
  assert.equal(game.hp,100);assert.equal(game.score,0);
  assert.equal(game.receiveChat(chat(20,'!drop 2')).accepted,true);
});

test('PATROL-02 the default game still accepts !throw (the 3x3 core keeps its tests)',()=>{
  const {game}=started({});
  assert.equal(game.receiveChat(chat(1,'!throw 5')).accepted,true);
});

test('PATROL-03 the page builds its game with avoidScore:0 and chatThrow:false, and the simulator also scores a dodge as 0',()=>{
  const app=read('dist/app.mjs');
  assert.match(app,/options:\{landJitter:\.12,avoidScore:0,chatThrow:false,chatPieGap:4500,pieFall:1700,staleGrace:1500,stunMs:1000,pieReach:1.3\}/);
  assert.match(read('scripts/sim-play.mjs'),/landJitter: \.12, avoidScore: 0/);
});

test('PATROL-04 no mosquito code is left in the shipped modules or the page',()=>{
  const files=readdirSync(new URL('../dist/',import.meta.url)).filter(f=>/\.(mjs|html|css)$/.test(f));
  for(const f of files)assert.doesNotMatch(read(`dist/${f}`),/mosquito/i,f);
  assert.doesNotMatch(read('dist/index.html'),/data-throw/);
});

test('PATROL-05 chatPieGap: several accounts taking turns cannot keep a pie on screen and block every ball',()=>{
  const run=gap=>{
    const clock={now:0},game=new MatrixGame({clock:()=>clock.now,options:{landJitter:.12,avoidScore:0,chatThrow:false,chatPieGap:gap}});game.setConnection(true);game.start();
    let frame=0,serial=0,pies=0,balls=0;
    for(clock.now=0;clock.now<20000;clock.now+=33){
      game.addFrame({frameId:`f${++frame}`,captureTime:clock.now,nose:{x:.5,y:.5,visibility:1},leftShoulder:null,rightShoulder:null});game.tick();
      if(clock.now%450<33){const n=++serial;if(game.receiveChat({notificationId:`p${n}`,messageId:`pm${n}`,actorId:`pie${(n>>1)%8}`,receivedAt:clock.now,text:'!pie 2'}).accepted)pies++;}
      if(clock.now%450<33){const n=++serial;if(game.receiveChat({notificationId:`b${n}`,messageId:`bm${n}`,actorId:`ball${n%4}`,receivedAt:clock.now,text:'!drop 2'}).accepted)balls++;}
    }
    return {pies,balls};
  };
  const open=run(0),fixed=run(4500);
  assert.ok(open.balls<=1,`without the gap the pie spam blocks the balls (the bug): ${open.balls}`);assert.ok(fixed.balls>=3,`balls get through with the gap: ${fixed.balls}`);assert.ok(fixed.pies>=3);
  const slow=new MatrixGame({options:{chatPieGap:4500}});slow.setConnection(true);slow.start();
  assert.equal(slow.receiveChat({notificationId:'x',messageId:'x',actorId:'a',receivedAt:0,text:'!pie 1'}).reason!=='PIE_COOLDOWN',true);
});

test('PIE-01 pieFall shortens only the pie (the ball keeps dropFall) and must be positive',()=>{
  const fall=(text)=>{
    const game=new MatrixGame({clock:()=>0,options:{pieFall:1700}});game.setConnection(true);game.start();
    game.addFrame({frameId:'f1',captureTime:0,nose:{x:.5,y:.5,visibility:1},leftShoulder:null,rightShoulder:null});game.tick();
    assert.equal(game.receiveChat({notificationId:'n1',messageId:'m1',actorId:'a',receivedAt:0,text}).accepted,true);
    const attack=game.snapshot().attacks[0];return attack.due-attack.start;
  };
  assert.equal(fall('!pie 2'),1700);
  assert.equal(fall('!drop 2'),2500);
  assert.throws(()=>new MatrixGame({options:{pieFall:0}}),RangeError);
});

test('PIE-02 a pie is judged at the nose, a ball at the torso',()=>{
  const run=(text)=>{
    const clock={now:0},results=[];
    const game=new MatrixGame({clock:()=>clock.now,onEvent:e=>{if(e.type==='result')results.push(e);},options:{pieFall:1700}});game.setConnection(true);game.start();
    // torso is in the middle lane (.5), the nose leans far to the right (.85)
    const frame=t=>({frameId:`f${t}`,captureTime:t,nose:{x:.85,y:.4,visibility:1},torso:{x:.5,y:.7,visibility:1},leftShoulder:null,rightShoulder:null});
    game.addFrame(frame(0));game.tick();
    assert.equal(game.receiveChat({notificationId:'n',messageId:'m',actorId:'a',receivedAt:0,text}).accepted,true);
    for(clock.now=33;clock.now<4000;clock.now+=33){game.addFrame(frame(clock.now));game.tick();}
    return results.find(r=>r.kind==='DROP')?.outcome;
  };
  assert.equal(run('!pie 2'),'AVOID');   // the face is out of the lane although the torso is under it
  assert.equal(run('!drop 2'),'CATCH');  // the hoop (torso) is under the ball
});

test('STALE-01 staleGrace keeps falling balls through a short camera stall and cancels them after a long silence',()=>{
  const run=(gap,grace)=>{
    const clock={now:0},results=[];
    const game=new MatrixGame({clock:()=>clock.now,onEvent:e=>{if(e.type==='result')results.push(e);},options:{staleGrace:grace}});game.setConnection(true);game.start();
    const frame=t=>({frameId:`f${t}`,captureTime:t,nose:{x:.5,y:.4,visibility:1},leftShoulder:null,rightShoulder:null});
    game.addFrame(frame(0));game.tick();
    assert.equal(game.receiveChat({notificationId:'n',messageId:'m',actorId:'a',receivedAt:0,text:'!drop 2'}).accepted,true);
    clock.now=gap;game.tick();
    return {pending:game.snapshot().attacks.length,results:results.map(r=>`${r.outcome}:${r.reason??''}`)};
  };
  assert.deepEqual(run(700,0),{pending:0,results:['UNKNOWN:SOURCE_STALE']});   // the old behaviour is still the default
  const soft=run(700,1500);assert.equal(soft.pending,1);assert.deepEqual(soft.results,[]);
  const hard=run(2500,1500);assert.equal(hard.pending,0);assert.deepEqual(hard.results,['UNKNOWN:SOURCE_STALE']);
  assert.throws(()=>new MatrixGame({options:{staleGrace:-1}}),RangeError);
});

test('STUN-01 a pie hit freezes the head for stunMs: drops landing meanwhile are judged at the frozen spot, then it ends; cooldown blocks a second stun',()=>{
  const run=(stunMs)=>{
    const clock={now:0},results=[];
    const game=new MatrixGame({clock:()=>clock.now,onEvent:e=>{if(e.type==='result')results.push(e);},options:{pieFall:1700,dropFall:600,stunMs,stunCooldown:3000}});game.setConnection(true);game.start();
    const frame=t=>({frameId:`f${t}`,captureTime:t,nose:{x:t<1700?.5:.95,y:.4,visibility:1},torso:{x:t<1700?.5:.95,y:.7,visibility:1},leftShoulder:null,rightShoulder:null});
    game.addFrame(frame(0));game.tick();
    assert.equal(game.receiveChat({notificationId:'p',messageId:'p',actorId:'a',receivedAt:0,text:'!pie 2'}).accepted,true);
    let ball=false;
    for(clock.now=33;clock.now<4500;clock.now+=33){
      game.addFrame(frame(clock.now));game.tick();
      if(!ball&&clock.now>=1800){ball=game.receiveChat({notificationId:'b',messageId:'b',actorId:'b',receivedAt:clock.now,text:'!drop 2'}).accepted;}
    }
    return {pie:results.find(r=>r.variant==='BOMB'),ball:results.find(r=>r.kind==='DROP'&&r.variant!=='BOMB')};
  };
  const stunned=run(1000),free=run(0);
  assert.equal(stunned.pie.outcome,'BOMB');assert.equal(stunned.pie.stunStarted,true);
  assert.equal(stunned.ball.outcome,'CATCH');assert.equal(stunned.ball.stunned,true);   // judged at the frozen 0.5 although the head moved to 0.95
  assert.equal(free.ball.outcome,'MISS');assert.equal(free.ball.stunned,undefined);
  assert.throws(()=>new MatrixGame({options:{stunMs:-1}}),RangeError);
});

test('REACH-01 pieReach widens only the pie: the same distance hits a pie but misses a ball, and the drawn width follows',()=>{
  const run=(text)=>{
    const clock={now:0},results=[];
    const game=new MatrixGame({clock:()=>clock.now,onEvent:e=>{if(e.type==='result')results.push(e);},options:{catchHalf:.05,pieReach:1.5}});game.setConnection(true);game.start();
    const frame=t=>({frameId:`f${t}`,captureTime:t,nose:{x:.5+.07,y:.4,visibility:1},torso:{x:.5+.07,y:.7,visibility:1},leftShoulder:null,rightShoulder:null});   // 0.07 from the lane: outside 0.05, inside 0.075
    game.addFrame(frame(0));game.tick();
    game.receiveChat({notificationId:'n',messageId:'m',actorId:'a',receivedAt:0,text});
    const widths=game.snapshot().attacks.map(a=>a.catchHalf);
    for(clock.now=33;clock.now<4000;clock.now+=33){game.addFrame(frame(clock.now));game.tick();}
    return {outcome:results.find(r=>r.kind==='DROP')?.outcome,widths};
  };
  const pie=run('!pie 2'),ball=run('!drop 2');
  assert.equal(pie.outcome,'BOMB');assert.ok(Math.abs(pie.widths[0]-.075)<1e-9);
  assert.equal(ball.outcome,'MISS');assert.ok(Math.abs(ball.widths[0]-.05)<1e-9);
  assert.throws(()=>new MatrixGame({options:{pieReach:0}}),RangeError);
});
