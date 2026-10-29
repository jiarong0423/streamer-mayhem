import test from 'node:test';
import assert from 'node:assert/strict';
import {createTicker,drawTicker,cleanName,TICKER_H,TICKER_MAX,STREAK_GAP_MS,HINT} from '../dist/ticker.mjs';

const result=(over={})=>({kind:'DROP',eventId:'e1',outcome:'CATCH',points:3,scoreDelta:30,combo:4,...over});
function fakeCtx(){const calls=[];return {calls,ctx:new Proxy({},{get:(t,k)=>k==='measureText'?s=>({width:String(s).length*7}):(...a)=>{calls.push([k,a]);},set:(t,k,v)=>{t[k]=v;return true;}})};}

test('TICK-01 a settled shot becomes an entry with the viewer, points, combo and streak',()=>{
  const t=createTicker();t.noteShot('e1','Mika',1000);
  const e=t.noteResult(result(),1500);
  assert.equal(e.name,'Mika');assert.match(e.text,/3PT ✓ \+30/);assert.match(e.text,/COMBO \+4/);assert.ok(!/×/.test(e.text),'first shot has no streak mark');
  assert.deepEqual(t.live(1600).map(x=>x.name),['Mika']);
});
test('TICK-02 the same viewer shooting again within the gap builds a streak (×2, ×3); another viewer or a long pause resets it',()=>{
  const t=createTicker();
  t.noteShot('a','Mika',0);t.noteShot('b','Mika',5000);t.noteShot('c','Mika',9000);
  assert.match(t.noteResult(result({eventId:'b'}),9500).text,/×2/);assert.match(t.noteResult(result({eventId:'c'}),9600).text,/×3/);
  t.noteShot('d','Jojo',10000);assert.ok(!/×/.test(t.noteResult(result({eventId:'d'}),10100).text));
  t.noteShot('e','Jojo',10000+STREAK_GAP_MS+1);assert.ok(!/×/.test(t.noteResult(result({eventId:'e'}),40000).text));
});
test('TICK-03 outcomes: miss, pie splat and pie dodged; auto drops show AUTO; non-drop results are ignored',()=>{
  const t=createTicker();
  assert.equal(t.noteResult(result({eventId:'x',outcome:'MISS',points:2,combo:0,scoreDelta:0}),0).text,'MISS');
  assert.equal(t.noteResult(result({eventId:'y',outcome:'BOMB',variant:'BOMB',scoreDelta:-25}),0).text,'PIE SPLAT -25');assert.equal(t.noteResult(result({eventId:'y2',outcome:'BOMB',variant:'BOMB',scoreDelta:0}),0).text,'PIE SPLAT');
  assert.equal(t.noteResult(result({eventId:'z',outcome:'AVOID',variant:'BOMB',scoreDelta:10}),0).text,'PIE DODGED');
  assert.equal(t.noteResult(result({eventId:'q'}),0).name,'AUTO');
  assert.equal(t.noteResult({kind:'FREEZE',outcome:'HIT'},0),null);assert.equal(t.noteResult(null,0),null);
});
test('TICK-04 the strip keeps at most TICKER_MAX entries, newest first, and drops old ones',()=>{
  const t=createTicker();for(let i=0;i<TICKER_MAX+5;i++)t.noteResult(result({eventId:`e${i}`}),i);
  assert.equal(t.live(100).length,TICKER_MAX);assert.equal(t.live(100+95000).length,0);
});
test('TICK-05 names are cleaned: control characters removed, at most 20 characters',()=>{
  assert.equal(cleanName('Mi\u0000ka\n'),'Mika');assert.equal(cleanName('x'.repeat(40)).length,20);assert.equal(cleanName(7),'');
  const t=createTicker();assert.equal(t.noteShot('e','   ',0),0);
});
test('TICK-06 drawTicker paints a clipped strip of TICKER_H of the arena, scrolls over time, and falls back to the command hint when empty',()=>{
  const rect={x:0,y:0,width:1000,height:500};
  const a=fakeCtx();drawTicker(a.ctx,rect,[{name:'Mika',text:'3PT ✓ +30',color:'#B58CFF'}],3000);
  const band=a.calls.find(([k])=>k==='fillRect');assert.equal(band[1][3],500*TICKER_H);assert.ok(a.calls.some(([k])=>k==='clip'));
  const texts=a.calls.filter(([k])=>k==='fillText').map(c=>c[1][0]);assert.ok(texts.some(s=>s.includes('Mika')));
  const x0=a.calls.find(([k])=>k==='fillText')[1][1];const b=fakeCtx();drawTicker(b.ctx,rect,[{name:'Mika',text:'3PT ✓ +30',color:'#B58CFF'}],5000);
  assert.notEqual(b.calls.find(([k])=>k==='fillText')[1][1],x0,'moves with time');
  const c=fakeCtx();drawTicker(c.ctx,rect,[],3000);assert.ok(c.calls.filter(([k])=>k==='fillText').some(x=>x[1][0]===HINT));
});

test('TICK-07 (theme) a supporter gets a star on the strip, and a cheer shows up even when it is not a command',()=>{
  const t=createTicker();t.noteShot('e1','Mika',0,true);
  const mika=t.noteResult(result(),10);assert.equal(mika.name,'Mika');assert.equal(mika.star,true);   // the star is a field, never a character of the name
  t.noteShot('e2','Jojo',20,false);assert.equal(t.noteResult(result({eventId:'e2'}),30).name,'Jojo');
  const c=t.noteSupport({viewer:'Nova',cheerBits:250},40);assert.equal(c.name,'Nova');assert.equal(c.star,true);assert.equal(c.text,'CHEERED 250 BITS');
  assert.equal(t.noteSupport({viewer:'Nova'},50),null);assert.equal(t.noteSupport({viewer:'',cheerBits:5},50),null);assert.equal(t.noteSupport({viewer:'Nova',cheerBits:-3},50),null);assert.equal(t.noteSupport(null,50),null);
});

import {speakableName} from '../dist/ticker.mjs';
test('TICK-08 (theme) speakableName keeps only letters, digits and spaces, shortens to 20, and returns empty when nothing speakable is left',()=>{
  assert.equal(speakableName('Mika_99'),'Mika 99');assert.equal(speakableName('  Nova!!  '),'Nova');assert.equal(speakableName('小明123'),'小明123');
  assert.equal(speakableName('a'.repeat(40)),'');   // longer than 16: not read out (RED-06)
  assert.equal(speakableName('!!!***'),'');assert.equal(speakableName('___'),'');assert.equal(speakableName(null),'');
  assert.equal(speakableName('A\u0000B‮C'),'ABC');
});

import {chatPointsFor,drawVersus,VERSUS_H,CHAT_POINTS} from '../dist/ticker.mjs';
test('VS-01 (theme) chat earns points only when the streamer misses a ball (10) or catches a pie (25)',()=>{
  assert.equal(chatPointsFor('MISS'),CHAT_POINTS.MISS);assert.equal(chatPointsFor('BOMB'),CHAT_POINTS.BOMB);
  for(const o of ['CATCH','AVOID','UNKNOWN','HIT','DODGE',undefined])assert.equal(chatPointsFor(o),0,String(o));
});
test('VS-02 (theme) the tug-of-war bar splits the strip by score share and shows both numbers',()=>{
  const rect={x:0,y:0,width:1000,height:500};
  const a=fakeCtx();drawVersus(a.ctx,rect,300,100);
  const bars=a.calls.filter(([k])=>k==='fillRect');assert.equal(bars[1][1][2],750);assert.equal(bars[2][1][2],250);assert.equal(bars[1][1][3],500*VERSUS_H);
  const texts=a.calls.filter(([k])=>k==='fillText').map(c=>c[1][0]);assert.ok(texts.some(s=>s.includes('STREAMER 300'))&&texts.some(s=>s.includes('CHAT 100')));
  const b=fakeCtx();drawVersus(b.ctx,rect,0,0);assert.equal(b.calls.filter(([k])=>k==='fillRect')[1][1][2],500);   // empty: half and half
});

test('REJ-01 (theme) a refused real command shows on the strip with the reason; non-commands and accepted ones never do; one note per viewer per 3 s',()=>{
  const t=createTicker(),rej=(reason,viewer='Nova')=>({accepted:false,reason,viewer});
  assert.equal(t.noteReject(rej('ACTOR_COOLDOWN'),0).text,'WAIT 3S');
  assert.equal(t.noteReject(rej('ACTOR_COOLDOWN'),1000),null);                 // same viewer within 3 s
  assert.equal(t.noteReject(rej('GLOBAL_COOLDOWN'),3500).text,'TOO FAST');
  assert.equal(t.noteReject(rej('MODE_BUSY','Mika'),3600).text,'BUSY');assert.equal(t.noteReject(rej('QUEUE_FULL','Jojo'),3700).text,'BUSY');
  for(const reason of ['INVALID_COMMAND','NOT_PLAYING','DUPLICATE','OFFLINE',undefined])assert.equal(t.noteReject(rej(reason,'Kai'),9000),null,String(reason));
  assert.equal(t.noteReject({accepted:true,reason:'ACTOR_COOLDOWN',viewer:'Kai'},9000),null);assert.equal(t.noteReject({accepted:false,reason:'MODE_BUSY'},9000),null);assert.equal(t.noteReject(null,0),null);
});
