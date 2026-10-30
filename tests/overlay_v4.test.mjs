// Protocol v4 (marquee, versus bar, combo, round clock, banner), the overlay scene that draws it, and the relay cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCameraGeometry} from '../dist/camera_geometry.mjs';
import {makeOverlayState,readOverlayState,TICKER_TONES,TICKER_LIMITS,isTickerName} from '../dist/overlay_protocol.mjs';
import {buildOverlayExtras,overlayBanner} from '../dist/overlay_publisher.mjs';
import {createOverlayRelay,MAX_BODY} from '../scripts/overlay-relay.mjs';
import {drawOverlayScene,hudRect,tickerEntries,PAUSED_TEXT,OVERLAY_HINT} from '../dist/overlay_scene.mjs';
import {drawHoop,drawArena} from '../dist/arena_draw.mjs';
import {TICKER_H,VERSUS_H,TONE_COLORS,createTicker,cleanName} from '../dist/ticker.mjs';
import {DROP_CATCH_HALF} from '../dist/drop_lanes.mjs';
import {fakeRequest,fakeResponse} from './helpers/relay_fakes.mjs';

const session='d'.repeat(32);
const geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
const item=(extra={})=>({name:'Mika',text:'3PT ✓ +30  COMBO +4  ×2',tone:'SCORE3',star:false,ageMs:1200,...extra});
const make=(snapshot,sequence=1)=>makeOverlayState({session,sequence,geometry,snapshot:{mode:'PLAYING',attacks:[],score:10,hp:90,...snapshot},sourcePoint:{x:.5,y:.5,visibility:1}});
const read=message=>readOverlayState(message,session,1280,720).snapshot;
const bad=snapshot=>assert.throws(()=>make(snapshot),/INVALID_OVERLAY_STATE/);

function fake(width=1280,height=720){
  const calls=[],gradient={addColorStop(){}};
  const ctx=new Proxy({canvas:{width,height}},{
    get:(t,k)=>k in t?t[k]:/^create.*Gradient$/.test(String(k))?()=>gradient:(...a)=>{calls.push({k,a});},
    set:(t,k,v)=>{t[k]=v;return true;}});
  return {ctx,calls,texts:()=>calls.filter(c=>c.k==='fillText').map(c=>c.a[0])};
}

test('F2 v4 extras survive controller -> relay normalisation -> overlay unchanged',()=>{
  const extras={ticker:[item(),item({name:'AUTO',text:'MISS',tone:'MISS'}),item({name:'Nova',text:'CHEERED 100 BITS',tone:'CHEER',star:true})],versus:{streamer:120,chat:35},combo:7,roundLeftMs:42000,banner:{kind:'ROUND_OVER',text:'ROUND OVER · SCORE 120 · STREAMER WINS',grade:'A',ageMs:100}};
  const message=make(extras),snap=read(message);
  assert.deepEqual(snap.ticker,[item({star:undefined}),item({name:'AUTO',text:'MISS',tone:'MISS',star:undefined}),item({name:'Nova',text:'CHEERED 100 BITS',tone:'CHEER',star:true})].map(e=>JSON.parse(JSON.stringify(e))));
  assert.deepEqual(snap.versus,{streamer:120,chat:35});assert.equal(snap.combo,7);assert.equal(snap.roundLeftMs,42000);assert.deepEqual(snap.banner,extras.banner);
  const again=makeOverlayState({session,sequence:2,...readOverlayState(message,session,1280,720)});
  assert.deepEqual(again.snapshot,message.snapshot);
});

test('F2 ticker bounds: 8 items yes, 9 no; names, text, tone, star and age are validated',()=>{
  const eight=Array.from({length:8},()=>item());
  assert.equal(read(make({ticker:eight})).ticker.length,8);bad({ticker:[...eight,item()]});
  bad({ticker:'x'});bad({ticker:[null]});bad({ticker:[[]]});
  assert.equal(read(make({ticker:[item({name:'a'.repeat(20)})]})).ticker[0].name.length,20);bad({ticker:[item({name:'a'.repeat(21)})]});
  bad({ticker:[item({name:''})]});bad({ticker:[item({name:7})]});
  assert.ok(read(make({ticker:[item({text:'x'.repeat(40)})]})));bad({ticker:[item({text:'x'.repeat(41)})]});bad({ticker:[item({text:''})]});bad({ticker:[item({text:5})]});
  for(const tone of TICKER_TONES)assert.ok(read(make({ticker:[item({tone})]})).ticker[0].tone===tone);
  for(const tone of ['','score3','#ff0000','red',7,undefined,null])bad({ticker:[item({tone})]});
  bad({ticker:[item({star:'yes'})]});bad({ticker:[item({star:1})]});
  for(const ageMs of [0,90000])assert.equal(read(make({ticker:[item({ageMs})]})).ticker[0].ageMs,ageMs);
  for(const ageMs of [-1,90001,1.5,'3',NaN,undefined,Infinity])bad({ticker:[item({ageMs})]});
  assert.equal('ticker' in read(make({ticker:[]})),false);
});

test('F2 names use the adapter sanitizer: control, zero-width, bidi, star, symbol and reserved names are refused, real names pass',()=>{
  for(const ok of ['Mika','AUTO','小明','Nova_99','José','A B'])assert.equal(isTickerName(ok),true,ok);
  for(const evil of ['Mi\u0000ka','Mi​ka','‮akiM','★Mika','Mika★','Mi☀ka','Mi⠀ka','ㅤ','  ','!!!','Wait','Bits','CHEERED 5 BITS','busy','MISS','Mí́́́ka',' Mika','Mika ','Mi  ka'])assert.equal(isTickerName(evil),false,JSON.stringify(evil));
  for(const evil of ['Mi​ka','★Mika','Mi\u0000ka'])bad({ticker:[item({name:evil})]});
  bad({ticker:[item({text:'CHEERED ★ 5 BITS'})]});bad({ticker:[item({text:'a​b'})]});bad({ticker:[item({text:'a\nb'})]});
  // every name the game itself puts on the marquee passes
  const t=createTicker();for(const raw of ['Mika','','  ','WAIT','x'.repeat(40),'★Boss','​​','小明小明小明小明小明小明小明小明小明小明小明'])t.noteSupport({viewer:raw,cheerBits:5},1);
  for(const e of t.live(1))assert.equal(isTickerName(e.name),true,e.name);
  assert.equal(cleanName('★Boss'),'Boss');
});

test('F2 unknown fields are dropped and colours/ids never travel',()=>{
  const snap=read(make({ticker:[{...item(),color:'#ff0000',id:'secret-id',actorId:'viewer-3',at:5}],versus:{streamer:1,chat:2,extra:9},banner:{kind:'GO',text:'GO!',ageMs:0,color:'#000'},leak:'x'}));
  assert.deepEqual(Object.keys(snap.ticker[0]).sort(),['ageMs','name','text','tone']);
  assert.deepEqual(Object.keys(snap.versus),['streamer','chat']);assert.deepEqual(Object.keys(snap.banner).sort(),['ageMs','kind','text']);
  assert.equal('leak' in snap,false);assert.equal(JSON.stringify(snap).includes('secret'),false);
});

test('F2 versus, combo, round clock and banner bounds',()=>{
  for(const v of [{streamer:0,chat:0},{streamer:1e6,chat:1e6}])assert.deepEqual(read(make({versus:v})).versus,v);
  for(const v of [{streamer:-1,chat:0},{streamer:0,chat:1e6+1},{streamer:1.5,chat:0},{streamer:NaN,chat:0},{streamer:'3',chat:0},{streamer:1},null,[],5])bad({versus:v});
  for(const c of [0,999])assert.equal(read(make({combo:c})).combo,c);for(const c of [-1,1000,2.5,'4',NaN])bad({combo:c});
  for(const r of [0,120000])assert.equal(read(make({roundLeftMs:r})).roundLeftMs,r);for(const r of [-1,120001,0.5,'9',Infinity])bad({roundLeftMs:r});
  const banners=[{kind:'COUNTDOWN',text:'3'},{kind:'COUNTDOWN',text:'1'},{kind:'GO',text:'GO!'},{kind:'ROUND_OVER',text:'ROUND OVER · SCORE 0'},{kind:'ROUND_OVER',text:'ROUND OVER · SCORE 1234567 · CHAT WINS',grade:'S'}];
  for(const b of banners)assert.deepEqual(read(make({banner:{...b,ageMs:7000}})).banner,{...b,ageMs:7000});
  for(const b of [{kind:'COUNTDOWN',text:'4'},{kind:'COUNTDOWN',text:'0'},{kind:'COUNTDOWN',text:'12'},{kind:'GO',text:'GO'},{kind:'WIN',text:'GO!'},{kind:'ROUND_OVER',text:'ROUND OVER · SCORE x'},{kind:'ROUND_OVER',text:'ROUND OVER · SCORE 12345678'},{kind:'ROUND_OVER',text:'ROUND OVER · SCORE 5 · DRAW'},{kind:'GO',text:'GO!',grade:'S'},{kind:'ROUND_OVER',text:'ROUND OVER · SCORE 5',grade:'Z'},{kind:'GO',text:7}])bad({banner:{...b,ageMs:0}});
  bad({banner:{kind:'GO',text:'GO!',ageMs:-1}});bad({banner:{kind:'GO',text:'GO!',ageMs:7001}});bad({banner:{kind:'GO',text:'GO!'}});
  assert.equal('banner' in read(make({banner:null})),false);
});

test('F2 the protocol never carries pixels: only whitelisted keys, no image-like strings, even in the largest state',()=>{
  const message=maxMessage(),keys=new Set(),walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){keys.add(k);walk(x);}};walk(message);
  const allowed=new Set(['type','session','sequence','scene','snapshot','sourcePoint','viewport','x','y','width','height','sourceWidth','sourceHeight','crop','left','right','top','bottom','fit','mirror','rotation','mode','attacks','score','hp','viewer','cell','kind','cells','progress','label','variant','landX','ticker','name','text','tone','star','ageMs','versus','streamer','chat','combo','roundLeftMs','banner','grade','visibility']);
  for(const k of keys)assert.ok(allowed.has(k),`unexpected key ${k}`);
  const json=JSON.stringify(message);for(const word of ['data:','blob:','base64','image','frame','pixel'])assert.equal(json.includes(word),false,word);
  const src=readFileSync(new URL('../dist/overlay_protocol.mjs',import.meta.url),'utf8');assert.doesNotMatch(src,/ImageData|toDataURL|Blob|getImageData|drawImage|createImageBitmap/);
});

// The largest legal state: 8 attacks with 20-character labels, 8 marquee items with 20-character names (all quotes: JSON doubles them) and 40-character astral texts, banner, versus.
function maxMessage(){
  const name='"'.repeat(19)+'a',astral='\u{1D4D0}'.repeat(40);
  const attacks=Array.from({length:8},(_,i)=>({cell:4,kind:'DROP',cells:[1,4,7],progress:.5,label:'\u{1D4D0}'.repeat(20),variant:'BOMB',landX:.123456789012345}));
  const ticker=Array.from({length:8},()=>({name,text:astral,tone:'SCORE3',star:true,ageMs:90000}));
  return make({attacks,ticker,versus:{streamer:1e6,chat:1e6},combo:999,roundLeftMs:120000,banner:{kind:'ROUND_OVER',text:'ROUND OVER · SCORE 1000000 · CHAT WINS',grade:'S',ageMs:7000},viewer:'\u{1D4D0}'.repeat(20)});
}
test('F2 relay: the largest legal v4 message fits the body cap with room to spare; a bigger body is refused with 413',()=>{
  assert.equal(MAX_BODY,8192);
  const message=maxMessage(),json=JSON.stringify(message);
  assert.ok(json.length<MAX_BODY*0.75,`largest message is ${json.length} chars`);
  const relay=createOverlayRelay();
  try{
    const send=body=>{const req=fakeRequest({host:'localhost:4173',origin:'http://localhost:4173',body}),res=fakeResponse();relay.handle(req,res);req.send();return res;};
    assert.equal(send(json).status,204);
    const stored=JSON.stringify(message.snapshot.ticker);assert.equal(stored.length>1000,true);
    assert.equal(send(JSON.stringify({...message,sequence:message.sequence+1,pad:'x'.repeat(MAX_BODY)})).status,413);
  }finally{relay.close();}
});

test('F2 relay forwards every v4 field to the overlay and drops anything else',()=>{
  const relay=createOverlayRelay(),events=fakeResponse();
  try{
    const sub=fakeRequest({method:'GET',url:`/__overlay/events?session=${session}`,host:'localhost:4173',contentType:null});relay.handle(sub,events);
    const message=make({ticker:[item()],versus:{streamer:3,chat:4},combo:5,roundLeftMs:60000,banner:{kind:'GO',text:'GO!',ageMs:10}});
    const req=fakeRequest({host:'localhost:4173',origin:'http://localhost:4173',body:{...message,ticker:'ignored',extra:'private-field'}}),res=fakeResponse();
    relay.handle(req,res);req.send();assert.equal(res.status,204);
    const data=events.chunks.find(c=>c.startsWith('data: '));assert.ok(data);const got=JSON.parse(data.slice(6));
    assert.deepEqual(got.snapshot,message.snapshot);assert.equal(JSON.stringify(got).includes('private-field'),false);
    sub.emit('close');
  }finally{relay.close();}
});

test('F2 publisher helper: at most 8 valid items, bad names dropped instead of blanking the frame, colour replaced by tone, ages clamped',()=>{
  const t=createTicker();
  for(let i=0;i<12;i++)t.noteSupport({viewer:`Fan${i}`,cheerBits:10+i},1000+i);
  t.noteResult({kind:'DROP',eventId:'x',outcome:'CATCH',points:3,scoreDelta:30,combo:4},1100);
  const entries=t.live(2000);
  const extra=buildOverlayExtras({entries:[{name:'x​y',text:'hi',tone:'MISS',at:0},{name:'Ok',text:'y'.repeat(60),tone:'nope',at:0},...entries],now:5000+90000,score:42,chatScore:7,roundLeftMs:99999999});
  assert.ok(extra.ticker.length<=8);assert.ok(extra.ticker.every(e=>isTickerName(e.name)&&TICKER_TONES.includes(e.tone)&&!('color' in e)&&e.ageMs<=90000&&e.ageMs>=0));
  assert.equal(extra.roundLeftMs,120000);assert.deepEqual(extra.versus,{streamer:42,chat:7});
  assert.ok(make(extra));
  assert.deepEqual(buildOverlayExtras({entries:[],now:1,score:-5,chatScore:1e9}).versus,{streamer:0,chat:1e6});
  assert.equal('ticker' in buildOverlayExtras({entries:[],now:1}),false);
});

test('F2 publisher helper: banner mapping accepts countdown digits, GO! and the round result only',()=>{
  assert.deepEqual(overlayBanner({text:'3',at:100,big:true},350),{kind:'COUNTDOWN',text:'3',ageMs:250});
  assert.deepEqual(overlayBanner({text:'GO!',at:100,big:true},100),{kind:'GO',text:'GO!',ageMs:0});
  assert.deepEqual(overlayBanner({text:'ROUND OVER · SCORE 90 · CHAT WINS',at:0,grade:'B'},3000),{kind:'ROUND_OVER',text:'ROUND OVER · SCORE 90 · CHAT WINS',grade:'B',ageMs:3000});
  assert.equal(overlayBanner({text:'TILT YOUR HEAD TO DODGE',at:0},10),null);assert.equal(overlayBanner({text:'3',at:0},10),null,'a bare 3 without the big flag is not a countdown');
  assert.equal(overlayBanner({text:'GO!',at:0,big:true},8000),null);assert.equal(overlayBanner(null,0),null);
});

// ---------------- the overlay scene (F3 / F4 / F5) ----------------
const stateFor=(snapshot,point={x:.5,y:.5})=>readOverlayState(make(snapshot),session,1280,720);
const drop=(landX=.5)=>({cell:5,kind:'DROP',cells:[2,5,8],progress:.5,landX});

test('F3 the overlay draws the marquee, the versus bar and the refused-command note with the same functions as the page',()=>{
  const f=fake();
  const result=drawOverlayScene(f.ctx,stateFor({ticker:[item({name:'Mika',text:'WAIT 3S',tone:'REFUSED'}),item({name:'Nova',text:'PIE SPLAT -25',tone:'SPLAT'})],versus:{streamer:50,chat:25}}),{now:5000,receivedAt:5000});
  const texts=f.texts();
  assert.ok(texts.some(t=>String(t).includes('WAIT 3S')),'refused-command note on the marquee');assert.ok(texts.some(t=>String(t).includes('PIE SPLAT -25')));
  assert.ok(texts.includes('STREAMER 50')||f.calls.some(c=>c.k==='strokeText'&&c.a[0]==='STREAMER 50'));
  assert.ok(f.calls.some(c=>c.k==='strokeText'&&c.a[0]==='CHAT 25'));
  assert.equal(result.status,'Overlay PLAYING');
  assert.equal(TONE_COLORS.REFUSED,tickerEntries([item({tone:'REFUSED'})],0)[0].color);
});

test('F3 no marquee data: the strip shows the command hint; an old message without v4 fields draws no strip',()=>{
  const f=fake();drawOverlayScene(f.ctx,stateFor({versus:{streamer:0,chat:0}}),{now:1,receivedAt:1});
  assert.ok(f.texts().some(t=>String(t).includes('!drop 1 = 3PT')),'HINT on the strip');
  const g=fake();drawOverlayScene(g.ctx,stateFor({}),{now:1,receivedAt:1});assert.equal(g.texts().some(t=>String(t).includes('!drop 1 = 3PT')),false);
  assert.ok(g.calls.some(c=>c.k==='strokeText'&&c.a[0]===OVERLAY_HINT),'bottom hint');
});

test('F3 every tone has a colour and the score panel starts below the strip and the versus bar',()=>{
  for(const tone of TICKER_TONES)assert.match(TONE_COLORS[tone],/^#[0-9A-F]{6}$/i);
  const rect={x:0,y:0,width:1280,height:720},r=hudRect(rect,{ticker:true,versus:true});
  assert.ok(r.y>=rect.height*(TICKER_H+VERSUS_H));assert.equal(r.y+r.height,rect.height);assert.deepEqual(hudRect(rect),rect);
  const f=fake();drawOverlayScene(f.ctx,stateFor({combo:6,roundLeftMs:30000,ticker:[item()],versus:{streamer:1,chat:1}}),{now:1000,receivedAt:1000});
  assert.ok(f.calls.some(c=>c.k==='strokeText'&&c.a[0]==='0:30'),'round clock');assert.ok(f.calls.some(c=>c.k==='strokeText'&&c.a[0]==='×6'),'combo');
  assert.ok(f.calls.some(c=>c.k==='strokeText'&&String(c.a[0]).startsWith('BONUS +1')),'bonus derived from the combo');
});

test('F4 hoop: the overlay draws the same rim as the page while an item falls, and none without an item or without a tracked point',()=>{
  const rimWidth=DROP_CATCH_HALF*1280;
  const rims=f=>f.calls.filter(c=>c.k==='ellipse'&&Math.abs(c.a[2]-rimWidth)<1e-6);
  const f=fake();drawOverlayScene(f.ctx,stateFor({attacks:[drop()]}),{now:1,receivedAt:1});assert.equal(rims(f).length,1);
  const none=fake();drawOverlayScene(none.ctx,stateFor({attacks:[]}),{now:1,receivedAt:1});assert.equal(rims(none).length,0);
  const lost=fake();drawOverlayScene(lost.ctx,readOverlayState({...make({attacks:[drop()]}),sourcePoint:null},session,1280,720),{now:1,receivedAt:1});
  assert.equal(rims(lost).length,0,'no tracked point, no hoop (TRACKING_LOST)');
  const paused=fake();drawOverlayScene(paused.ctx,stateFor({mode:'PAUSED',attacks:[drop()]}),{now:1,receivedAt:1});assert.equal(rims(paused).length,0);
});

test('F4 drawHoop extracted from drawArena draws exactly the calls drawArena used to make',()=>{
  const g=geometry,rect=g.visible,position={x:rect.x+rect.width*.5,y:rect.y+rect.height*.5},d=drop();
  const arena=fake();drawArena(arena.ctx,{mode:'PLAYING',attacks:[d],score:0,hp:100},{x:.5,y:.5},{now:0,geometry:g,marker:true,tracking:true});
  const guide=arena.calls.find(c=>c.k==='moveTo'&&Math.abs(c.a[0]-position.x)<1e-6&&c.a[1]>position.y),ringRadius=guide.a[1]-position.y;
  const direct=fake();drawHoop(direct.ctx,rect,position,d,{ringRadius});
  const key=c=>JSON.stringify([c.k,c.a]),a=arena.calls.map(key),needle=direct.calls.map(key).join('|');
  assert.ok(direct.calls.length>20);assert.ok(a.join('|').includes(needle),'page output contains the shared hoop calls in the same order');
});

test('F4 banners: countdown, GO! and the round result are drawn with the winner; they age out',()=>{
  const at=(banner,now=0)=>{const f=fake();drawOverlayScene(f.ctx,stateFor({banner}),{now,receivedAt:0});return f;};
  for(const [banner,text] of [[{kind:'COUNTDOWN',text:'3',ageMs:500},'3'],[{kind:'GO',text:'GO!',ageMs:100},'GO!'],[{kind:'ROUND_OVER',text:'ROUND OVER · SCORE 90 · STREAMER WINS',ageMs:100},'ROUND OVER · SCORE 90 · STREAMER WINS']])
    assert.ok(at(banner).calls.some(c=>c.k==='strokeText'&&c.a[0]===text),text);
  const gradeCard=at({kind:'ROUND_OVER',text:'ROUND OVER · SCORE 90 · CHAT WINS',grade:'A',ageMs:1000},0);assert.ok(gradeCard.calls.some(c=>c.k==='strokeText'&&c.a[0]==='A'),'grade letter');
  assert.equal(at({kind:'GO',text:'GO!',ageMs:100},5000).calls.some(c=>c.k==='strokeText'&&c.a[0]==='GO!'),false,'a GO! banner is gone after its second');
});

test('F5 a paused game shows GAME PAUSED on the overlay instead of going blank; other modes do not',()=>{
  const f=fake(),result=drawOverlayScene(f.ctx,stateFor({mode:'PAUSED'}),{now:1,receivedAt:1});
  assert.ok(f.calls.some(c=>c.k==='strokeText'&&c.a[0]===PAUSED_TEXT));assert.equal(result.status,'Overlay PAUSED');
  for(const mode of ['PLAYING','RECOVERING','ROUND_END','IDLE']){const g=fake();drawOverlayScene(g.ctx,stateFor({mode}),{now:1,receivedAt:1});assert.equal(g.calls.some(c=>c.k==='strokeText'&&c.a[0]===PAUSED_TEXT),false,mode);}
});

test('F5 overlay page keeps a paused message on screen for minutes and blanks a stalled live one after 1.5 s; the controller heartbeat keeps the relay session alive while hidden',()=>{
  const overlaySrc=readFileSync(new URL('../dist/overlay.mjs',import.meta.url),'utf8'),app=readFileSync(new URL('../dist/app.mjs',import.meta.url),'utf8');
  assert.match(overlaySrc,/STALE_MS=1500,STALE_PAUSED_MS=600000/);assert.match(overlaySrc,/mode==='PAUSED'\?STALE_PAUSED_MS:STALE_MS/);
  // hidden: pause + forced publish of the PAUSED snapshot; visible: no automatic resume
  const hidden=/if\(document\.hidden\)\{[^}]*game\.pause\(\)[\s\S]*?publishOverlay\(snapshot,\{force:true\}\)/.exec(app);assert.ok(hidden,'hidden branch pauses and force-publishes');
  const visible=/else\{hiddenSnapshot=null;if\(hiddenAt!==null\)[\s\S]*?\}\s*\/\/ back on screen/.exec(app);assert.ok(visible);assert.doesNotMatch(visible[0],/game\.resume\(\)/);
  assert.match(app,/setInterval\(\(\)=>\{if\(document\.hidden/);
});
