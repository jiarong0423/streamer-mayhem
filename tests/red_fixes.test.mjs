import test from 'node:test';
import assert from 'node:assert/strict';
import {MatrixGame,gradeFor} from '../dist/matrix.mjs';
import {EventSubAdapter,syntheticChat,syntheticWelcome,cleanViewerName} from '../dist/eventsub_adapter.mjs';
import {createTicker,drawTicker,cleanName,speakableName,REJECT_TEXT} from '../dist/ticker.mjs';

function fakeCtx(){const calls=[];return {calls,ctx:new Proxy({},{get:(t,k)=>k==='measureText'?s=>({width:String(s).length*7}):(...a)=>{calls.push([k,a]);},set:(t,k,v)=>{t[k]=v;return true;}})};}

function farm(accounts,x){
  const clock={now:0},game=new MatrixGame({clock:()=>clock.now,options:{landJitter:.12}});game.setConnection(true);game.start();
  let f=0,serial=0;
  for(clock.now=0;clock.now<75000;clock.now+=33){
    game.addFrame({frameId:'f'+(++f),captureTime:clock.now,nose:{x,y:.5,visibility:1},leftShoulder:null,rightShoulder:null});game.tick();
    if(clock.now%400<33){const a=`acct${serial++%accounts}`;game.receiveChat({notificationId:'n'+serial,messageId:'m'+serial,actorId:a,receivedAt:clock.now,text:'!pie '+(1+serial%3)});}
  }
  return game.score;
}
test('RED-02 a streamer parked in a corner cannot reach a grade by having helpers send pies',()=>{
  assert.equal(gradeFor(farm(4,.05)),null);
  assert.notEqual(gradeFor(farm(8,.05)),'S');
});
test('RED-02 a pie that lands where the streamer stands is AVOID and counts for the combo; one far away is AVOID with no combo',()=>{
  const run=(x,landX)=>{
    const clock={now:0},game=new MatrixGame({clock:()=>clock.now});game.setConnection(true);game.start();
    game.addFrame({frameId:'f',captureTime:0,nose:{x,y:.5,visibility:1},leftShoulder:null,rightShoulder:null});clock.now=50;game.tick();
    const attack={eventId:'p',cell:4,kind:'DROP',variant:'BOMB',cells:[1,4,7],landX};
    return game.resolve(attack,50);
  };
  const near=run(.5,.2);assert.equal(near.outcome,'AVOID');assert.equal(near.scoreDelta,0);assert.equal(near.combo,1);
  const far=run(.95,.2);assert.equal(far.outcome,'AVOID');assert.equal(far.scoreDelta,0);assert.equal(far.combo,0);
});

function adapterWithOut(){
  const out=[];const game=new MatrixGame({clock:()=>0});game.start();
  const a=new EventSubAdapter({game,clock:()=>0,onDelivery:d=>out.push(d)});a.ingest(syntheticWelcome());
  return {a,out};
}
test('RED-03 the same EventSub message id delivered five times gives one delivery, one CHEERED entry',()=>{
  const {a,out}=adapterWithOut();const t=createTicker();let ok=0;
  for(let i=0;i<5;i++){
    const r=a.ingest(syntheticChat({notificationId:'same',messageId:'m1',actorId:'9',chatterName:'Payer',text:'Cheer100 hi',cheerBits:100}));
    if(r.reason!=='DUPLICATE'||i===0){ok++;t.noteSupport(r,i);}
  }
  assert.equal(out.length,1);assert.equal(ok,1);assert.equal(t.live(10).length,1);
});
test('RED-03 ticker.noteSupport with an id skips a repeat',()=>{
  const t=createTicker();assert.ok(t.noteSupport({viewer:'A',cheerBits:5},0,'x'));assert.equal(t.noteSupport({viewer:'A',cheerBits:5},1,'x'),null);assert.ok(t.noteSupport({viewer:'A',cheerBits:5},2,'y'));
});
test('RED-03 the adapter id memory is bounded to 200',()=>{
  const {a}=adapterWithOut();for(let i=0;i<300;i++)a.ingest(syntheticChat({notificationId:'n'+i,messageId:'m'+i,actorId:'9',text:'hi'}));
  assert.equal(a.seenNotifications.size,200);
});

test('RED-04/05 names cannot draw the star, reserved words, or hide in invisible characters',()=>{
  for(const bad of ['★ Mika','Z  CHEERED 999 BITS','AUTO','auto','wait 3s','MISS','BUSY']){
    const c=cleanViewerName(bad);assert.ok(!/[★⭐]/.test(c),bad);assert.ok(!/\b(AUTO|CHEERED|BITS|WAIT|BUSY|MISS)\b/i.test(c)||c==='viewer',bad);
  }
  assert.equal(cleanViewerName('★ Mika'),'Mika');assert.equal(cleanViewerName('Z  CHEERED 999 BITS'),'viewer');assert.equal(cleanViewerName('AUTO'),'viewer');
  for(const inv of ['ㅤ','⠀','ᅟ','ﾠ','­','؜','᠎','͏','￹','️','⭐','✀'])assert.equal(cleanViewerName(`${inv}Ann${inv}`),'Ann',inv.codePointAt(0).toString(16));
  assert.equal(cleanViewerName('ㅤㅤ'),'viewer');assert.equal(cleanViewerName('!!!'),'viewer');assert.equal(cleanViewerName('   '),'');
  assert.equal(cleanViewerName('e'+'́'.repeat(19)),'é́');assert.equal(cleanViewerName('A    B'),'A B');
  assert.equal(cleanName('★ Mika'),'Mika');
});
test('RED-04 the supporter star is a field drawn before the name, not part of it',()=>{
  const t=createTicker();t.noteShot('e1','★ M  CHEERED 50 BITS',0,false);
  const e=t.noteResult({kind:'DROP',eventId:'e1',outcome:'MISS'},1);assert.equal(e.star,undefined);assert.equal(e.name,'viewer');
  const s=t.noteSupport({viewer:'Mika',cheerBits:50},2);assert.equal(s.name,'Mika');assert.equal(s.star,true);
  const f=fakeCtx();drawTicker(f.ctx,{x:0,y:0,width:1000,height:500},[s,e],3000);
  const texts=f.calls.filter(([k])=>k==='fillText').map(c=>c[1][0]);
  assert.ok(texts.includes('★ Mika  '));assert.ok(texts.includes('viewer  '));
});
test('RED-06 speakableName drops digit-only, long, and invisible-letter names',()=>{
  assert.equal(speakableName('12345'),'');assert.equal(speakableName('a'.repeat(17)),'');assert.equal(speakableName('a'.repeat(16)),'a'.repeat(16));
  assert.equal(speakableName('ㅤᅟ'),'');assert.equal(speakableName('Mika'),'Mika');
});
test('RED-08 refusals are rate-limited per actor id, not per display name',()=>{
  const t=createTicker(),rej=(actorId)=>({accepted:false,reason:'MODE_BUSY',viewer:'Sam',actorId});
  assert.ok(t.noteReject(rej('1'),0));assert.ok(t.noteReject(rej('2'),1));assert.equal(t.noteReject(rej('1'),2),null);
});
test('RED-09 REJECT_TEXT does not answer for inherited property names',()=>{
  const t=createTicker();for(const reason of ['constructor','toString','__proto__','hasOwnProperty'])assert.equal(t.noteReject({accepted:false,reason,viewer:'V'},0),null,reason);
  assert.ok(Object.hasOwn(REJECT_TEXT,'MODE_BUSY'));
});
