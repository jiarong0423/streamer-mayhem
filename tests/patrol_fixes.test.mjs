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
  assert.match(app,/options:\{landJitter:\.12,avoidScore:0,chatThrow:false\}/);
  assert.match(read('scripts/sim-play.mjs'),/landJitter: \.12, avoidScore: 0/);
});

test('PATROL-04 no mosquito code is left in the shipped modules or the page',()=>{
  const files=readdirSync(new URL('../dist/',import.meta.url)).filter(f=>/\.(mjs|html|css)$/.test(f));
  for(const f of files)assert.doesNotMatch(read(`dist/${f}`),/mosquito/i,f);
  assert.doesNotMatch(read('dist/index.html'),/data-throw/);
});
