import test from 'node:test';
import assert from 'node:assert/strict';
import {COLORS,FONT_STACK,easeOutBack,easeOutQuad,easeOutExpo,easeInCubic,strokedText,cachedSprite,setCanvasFactory,clearSpriteCache,spriteCacheSize,bucket,tween,stateFor,
  drawFeedback,feedbackLabel,feedbackAnchor,shakeOffset,drawLanding,drawOrb,drawBomb,drawStunStars,drawHud,drawBanner,drawBackground,drawVignette} from '../dist/art.mjs';
import {DROP_FLOOR} from '../dist/drop_lanes.mjs';
import {drawArena} from '../dist/arena_draw.mjs';
import {drawCameraOverlay} from '../dist/matrix_view.mjs';
import {createCameraGeometry} from '../dist/camera_geometry.mjs';

function fake(width=1280,height=720){
  const calls=[],gradient={addColorStop(){}};
  const ctx=new Proxy({canvas:{width,height}},{
    get:(t,k)=>k in t?t[k]:/^create.*Gradient$/.test(String(k))?()=>gradient:(...a)=>{calls.push({k,a,fill:t.fillStyle,stroke:t.strokeStyle,lw:t.lineWidth,font:t.font,alpha:t.globalAlpha});},
    set:(t,k,v)=>{t[k]=v;return true;}});
  return {ctx,calls,of:name=>calls.filter(c=>c.k===name)};
}
const rect={x:100,y:50,width:960,height:540};
const geometry=()=>createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;

test('ART-01 palette, font stack and easing curves',()=>{
  assert.equal(COLORS.gold,'#FFD23F');assert.equal(COLORS.lime,'#D9F965');assert.equal(COLORS.danger,'#FF5A46');assert.equal(COLORS.ink,'#0A100A');
  assert.match(FONT_STACK,/^"Arial Rounded MT Bold".*"Arial Black".*sans-serif$/);
  for(const f of [easeOutBack,easeOutQuad,easeOutExpo,easeInCubic]){assert.ok(near(f(0),0,1e-3));assert.ok(near(f(1),1));assert.equal(f(-1),f(0));assert.equal(f(2),f(1));}
  assert.ok(Math.max(...Array.from({length:101},(_,i)=>easeOutBack(i/100)))>1.05,'easeOutBack overshoots');
  assert.ok(easeOutExpo(.5)>.9);assert.ok(easeInCubic(.5)<.2);
});

test('ART-02 text gets a black outline of size*.16 under the fill, and never drops below 14px',()=>{
  const {ctx,calls}=fake();strokedText(ctx,'CATCH',10,20,50,COLORS.gold);
  const stroke=calls.find(c=>c.k==='strokeText'),fill=calls.find(c=>c.k==='fillText');
  assert.ok(calls.indexOf(stroke)<calls.indexOf(fill));assert.ok(near(stroke.lw,8));assert.equal(stroke.stroke,COLORS.ink);assert.equal(fill.fill,COLORS.gold);
  assert.match(stroke.font,/^900 50px "Arial Rounded/);
  const small=fake();strokedText(small.ctx,'x',0,0,5,'#fff');assert.match(small.of('fillText')[0].font,/^900 14px/);
});

test('ART-03 sprite cache: one offscreen canvas per size bucket, reused; no canvas available means a direct-paint fallback',()=>{
  let made=0;
  setCanvasFactory((w,h)=>{made++;return {width:w,height:h,getContext:()=>({})};});
  const paint=()=>{};
  const a=cachedSprite('t',33,33,paint),b=cachedSprite('t',33,33,paint),c=cachedSprite('t',40,40,paint);
  assert.equal(a,b);assert.notEqual(a,c);assert.equal(made,2);assert.equal(bucket(33),36);assert.equal(bucket(36),36);
  setCanvasFactory(()=>null);assert.equal(cachedSprite('none',20,20,paint),null);assert.equal(cachedSprite('t',0,5,paint),null);
  clearSpriteCache();assert.equal(spriteCacheSize(),0);
  setCanvasFactory(()=>{throw new Error('no canvas');});assert.equal(cachedSprite('boom',20,20,paint),null);
  clearSpriteCache();
});

test('ART-04 the orb and the bomb are cached offscreen: gradients are built once, later frames only blit',()=>{
  let made=0,gradients=0;
  setCanvasFactory((w,h)=>{made++;const g={canvasW:w,createRadialGradient:()=>{gradients++;return {addColorStop(){}};},createLinearGradient:()=>{gradients++;return {addColorStop(){}};}};return {width:w,height:h,getContext:()=>new Proxy(g,{get:(t,k)=>k in t?t[k]:()=>{},set:(t,k,v)=>{t[k]=v;return true;}})};});
  const {ctx,of}=fake();
  drawOrb(ctx,300,200,30,1000,.3);const afterFirst=made,gradFirst=gradients;
  for(let i=0;i<20;i++)drawOrb(ctx,300,200+i,30,1000+i*16,.3);
  assert.equal(made,afterFirst);assert.equal(gradients,gradFirst);assert.ok(of('drawImage').length>=21);
  made=0;drawBomb(ctx,300,200,30,1000,.3);const bombMade=made;for(let i=0;i<10;i++)drawBomb(ctx,300,200,30,1000+i*16,.3);assert.equal(made,bombMade);assert.ok(bombMade>=2);
  clearSpriteCache();setCanvasFactory(()=>null);
});

test('ART-05 without a canvas factory (Node) the orb paints directly: dark outline, last arc is the body at the true centre',()=>{
  setCanvasFactory(()=>null);const {ctx,calls}=fake();drawOrb(ctx,640,300,30,0,0);
  const arcs=calls.filter(c=>c.k==='arc');const last=arcs.at(-1);
  assert.deepEqual(last.a.slice(0,3),[640,300,30]);assert.equal(last.stroke,'rgba(10,16,10,.8)');assert.ok(last.lw>=1.5);
  assert.ok(calls.some(c=>c.k==='ellipse'),'highlight is an ellipse');
});

test('ART-06 landing ring is continuous at p=.6 and thickens, brightens and pulses afterwards',()=>{
  const at=p=>{const {ctx,calls}=fake();const r=drawLanding(ctx,500,400,30,100,p,123,'217,249,101');return {r,call:calls.find(c=>c.k==='stroke'),el:calls.find(c=>c.k==='ellipse')};};
  const lo=at(.59),mid=at(.6),hi=at(1);
  assert.ok(Math.abs(lo.r.lineWidth-mid.r.lineWidth)<.2);assert.ok(hi.r.lineWidth>mid.r.lineWidth*1.8);
  assert.equal(at(.3).r.pulse,1);
  assert.ok(near(mid.el.a[3],30*.7));assert.match(mid.call.stroke,/\.3\d*\)$/);assert.match(hi.call.stroke,/\.9\d*\)$/);
  const pulses=new Set(Array.from({length:12},(_,i)=>{const {ctx}=fake();return drawLanding(ctx,0,0,30,100,.95,i*40,'1,2,3').pulse;}));assert.ok(pulses.size>3);
});

test('ART-07 bomb: sparks every frame, "!" only once it is close, fuse is drawn',()=>{
  setCanvasFactory(()=>null);
  const far=fake();drawBomb(far.ctx,300,200,30,5000,.3);
  const close=fake();drawBomb(close.ctx,300,200,30,5000,.9);
  assert.equal(far.of('strokeText').length,0);assert.ok(close.of('strokeText').some(c=>c.a[0]==='!'));
  const sparks=far.of('arc').filter(c=>c.fill===COLORS.gold||c.fill===COLORS.orange);assert.ok(sparks.length>=3&&sparks.length<=6);
  const other=fake();drawBomb(other.ctx,300,200,30,5000+95,.3);
  assert.notDeepEqual(sparks.map(c=>c.a.slice(0,2)),other.of('arc').filter(c=>c.fill===COLORS.gold||c.fill===COLORS.orange).map(c=>c.a.slice(0,2)));
  assert.ok(far.of('quadraticCurveTo').length===1||far.of('lineTo').length>8);
  assert.ok(far.of('stroke').some(c=>c.stroke===COLORS.fuse));
});

test('ART-09 labels, colours and default positions of the five feedbacks',()=>{
  const MINUS='−';
  assert.equal(feedbackLabel({outcome:'CATCH',scoreDelta:50}),'CATCH +50');assert.equal(feedbackLabel({outcome:'BOMB',scoreDelta:-25}),`PIE ${MINUS}25`);
  assert.equal(feedbackLabel({outcome:'AVOID',scoreDelta:25}),'AVOID +25');
  assert.equal(feedbackLabel({outcome:'MISS',scoreDelta:0}),'MISS');assert.equal(feedbackLabel({outcome:'HIT',scoreDelta:-15}),'HIT');
  const draw=(outcome,extra={},opts)=>{const f=fake();const info=drawFeedback(f.ctx,rect,{outcome,at:1000,scoreDelta:10,...extra},1400,opts);return {f,info};};
  const colors={CATCH:COLORS.gold,BOMB:COLORS.dangerText,AVOID:COLORS.avoid,MISS:COLORS.gray};
  const spots={};
  for(const [o,c] of Object.entries(colors)){const {info}=draw(o);assert.equal(info.color,c,o);spots[o]=`${Math.round(info.x)},${Math.round(info.y)}`;}
  assert.equal(new Set(Object.values(spots)).size,4,'positions are not all the same: '+JSON.stringify(spots));   // the PIE label sits above the cream, so BOMB no longer shares MISS's spot
  // explicit event point wins
  const e=draw('AVOID',{x:.25,y:.75}).info;assert.ok(near(e.x,rect.x+.25*rect.width)&&near(e.y,rect.y+.75*rect.height));
  // catch sits above the catcher; bomb at the landing point on the catcher x
  const c=draw('CATCH',{},{catcherX:.35}).info,a=feedbackAnchor({outcome:'CATCH'},rect,{catcherX:.35});
  assert.ok(near(c.x,rect.x+.35*rect.width));assert.ok(a.y<rect.y+rect.height*DROP_FLOOR);
  assert.ok(feedbackAnchor({outcome:'BOMB'},rect,{catcherX:.65}).y>a.y);
  assert.ok(draw('MISS').info.size<draw('AVOID').info.size,'MISS is small');assert.ok(draw('MISS').info.alpha<=.8);
  const catchText=draw('CATCH',{combo:4}).f.of('fillText').map(x=>x.a[0]);assert.deepEqual(catchText,['+10','CATCH','×4']);
});

test('ART-10 timing: pop 160ms with easeOutBack, hold, fade+rise over the last 300ms, gone at 1000ms',()=>{
  const at=age=>{const f=fake();return drawFeedback(f.ctx,rect,{outcome:'AVOID',at:0,scoreDelta:5},age);};
  assert.ok(at(0).scale<.65);assert.equal(at(160).scale,1);assert.equal(at(500).scale,1);
  const scales=Array.from({length:16},(_,i)=>at(i*10).scale);assert.ok(Math.max(...scales)>1.02&&Math.max(...scales)<=1.1,'overshoots a little, as easeOutBack does');assert.ok(scales[1]>scales[0]);
  assert.equal(at(700).alpha,1);assert.ok(at(850).alpha<1&&at(850).alpha>0);assert.ok(at(999).alpha<.01);
  assert.ok(at(990).y<at(500).y,'rises while fading');assert.equal(at(1000),null);assert.equal(at(5000),null);
  const f=fake();assert.equal(drawFeedback(f.ctx,rect,null,0),null);assert.equal(drawFeedback(f.ctx,rect,{outcome:'AVOID',at:NaN},0),null);
});

test('ART-11 BOMB: expanding orange blast and a 300ms decaying shake of at most W/160',()=>{
  const f=fake();drawFeedback(f.ctx,rect,{outcome:'BOMB',at:0,scoreDelta:-25},175);
  const blast=f.of('arc').find(c=>c.a[2]>0&&c.a[2]<=rect.width/6);assert.ok(blast);
  const f2=fake();drawFeedback(f2.ctx,rect,{outcome:'BOMB',at:0,scoreDelta:-25},349);assert.ok(f2.of('arc').find(c=>c.a[2]>rect.width/6*.99));
  const f3=fake();drawFeedback(f3.ctx,rect,{outcome:'BOMB',at:0,scoreDelta:-25},1400);assert.equal(f3.of('arc').length,0);   // the cream splat (blobs are arcs) lasts 1300 ms
  let peak=0;for(let age=0;age<300;age+=5){const s=shakeOffset(age,rect.width);peak=Math.max(peak,Math.abs(s.x),Math.abs(s.y));assert.ok(Math.abs(s.x)<=rect.width/160+1e-9&&Math.abs(s.y)<=rect.width/160+1e-9);}
  assert.ok(peak>rect.width/160*.3);assert.deepEqual(shakeOffset(300,960),{x:0,y:0,amp:0});assert.equal(shakeOffset(-1,960).amp,0);assert.ok(shakeOffset(250,960).amp<shakeOffset(50,960).amp);
});

test('ART-12 the MISS ring appears only for its own outcome',()=>{
  const count=(o,age,k)=>{const f=fake();drawFeedback(f.ctx,rect,{outcome:o,at:0,scoreDelta:1},age);return f.of(k).length;};
  assert.equal(count('MISS',100,'ellipse'),1);assert.equal(count('MISS',500,'ellipse'),0);
});

test('ART-13 vignette: inner .45H, overlay ring .5H, zero strength draws nothing',()=>{
  const g=[];const ctx=new Proxy({},{get:(t,k)=>k==='createRadialGradient'?(...a)=>{g.push(a);return {addColorStop(){}};}:()=>{},set:()=>true});
  assert.equal(drawVignette(ctx,rect,.4),true);assert.ok(near(g[0][2],540*.45));
  drawVignette(ctx,rect,.4,{ring:true});assert.ok(near(g[1][2],540*.5));assert.equal(drawVignette(ctx,rect,0),false);
});

test('ART-14 HUD draws score and health, and combo / timer / bonus only when present',()=>{
  const draw=(s,now=0)=>{const f=fake();const r=drawHud(f.ctx,rect,s,now);return {f,r};};
  const base=draw({score:7,hp:80});assert.deepEqual(base.r.drawn,['score','hp']);assert.ok(base.f.of('fillText').some(c=>c.a[0]==='007'));
  assert.equal(drawHud(fake().ctx,rect,null),null);assert.deepEqual(draw({}).r.drawn,[]);
  const full=draw({score:120,hp:100,combo:5,bonus:2,roundLeftMs:42000});
  assert.deepEqual(full.r.drawn,['timer','score','hp','combo','bonus']);const texts=full.f.of('fillText').map(c=>c.a[0]);
  assert.ok(texts.includes('0:42')&&texts.includes('120')&&texts.includes('×5')&&texts.includes('BONUS +2'));
  assert.ok(!draw({score:1,hp:50,combo:2}).r.drawn.includes('combo'));
  const lowTime=draw({roundLeftMs:9000},0).f.of('fillText')[0];assert.equal(lowTime.fill,COLORS.dangerText);assert.equal(draw({roundLeftMs:30000}).f.of('fillText')[0].fill,COLORS.paper);
  const hpColor=hp=>{const f=fake().of?draw({score:0,hp}):null;return f.f.of('fill').filter(c=>c.fill==='#FF6B4A'||c.fill===COLORS.lime).length&&f.f.of('fill').at(-1).fill;};
  assert.equal(hpColor(30),'#FF6B4A');assert.equal(hpColor(31),COLORS.lime);
});

test('ART-15 HUD animates: score pop for 120ms with a gold flash, hp ghost lags, combo shows its loss',()=>{
  const {ctx,calls}=fake();
  drawHud(ctx,rect,{score:10,hp:100,combo:4},1000);
  calls.length=0;drawHud(ctx,rect,{score:60,hp:100,combo:5},2000);calls.length=0;drawHud(ctx,rect,{score:60,hp:100,combo:5},2060);
  const scoreText=calls.find(c=>c.k==='fillText'&&c.a[0]==='060');assert.equal(scoreText.fill,COLORS.gold,'flash on gain');
  const scale=calls.filter(c=>c.k==='scale').map(c=>c.a[0]);assert.ok(scale.some(s=>s>1.1&&s<=1.15+1e-9),'pop scale');
  calls.length=0;drawHud(ctx,rect,{score:60,hp:100,combo:5},2300);assert.equal(calls.find(c=>c.k==='fillText'&&c.a[0]==='060').fill,COLORS.paper);
  calls.length=0;drawHud(ctx,rect,{score:60,hp:60,combo:5},3000);
  assert.ok(calls.some(c=>c.k==='fill'&&c.fill==='rgba(255,255,255,.55)'),'ghost bar right after damage');
  calls.length=0;drawHud(ctx,rect,{score:60,hp:60,combo:5},3600);assert.ok(!calls.some(c=>c.k==='fill'&&c.fill==='rgba(255,255,255,.55)'),'ghost gone');
  calls.length=0;const r=drawHud(ctx,rect,{score:60,hp:60,combo:0},4000);assert.deepEqual(r.drawn.includes('comboLost'),true);
  calls.length=0;assert.ok(!drawHud(ctx,rect,{score:60,hp:60,combo:0},4300).drawn.includes('comboLost'));
});

test('ART-16 banner: plain, graded (S gold, A lime, B white; staggered lines) and big countdown',()=>{
  const draw=(banner,now)=>{const f=fake();const r=drawBanner(f.ctx,rect,banner,now);return {f,r};};
  const plain=draw({text:'ROUND OVER',at:0},1000);assert.equal(plain.r.kind,'plain');assert.equal(draw({text:'x',at:0},6000).r,null);assert.equal(draw(null,0).r,null);
  const color=g=>draw({text:'T',at:0,grade:g},1000).f.of('fillText').find(c=>c.a[0]===g).fill;
  assert.equal(color('S'),COLORS.gold);assert.equal(color('A'),COLORS.lime);assert.equal(color('B'),COLORS.paper);
  const s=draw({text:'T',at:0,grade:'S',lines:['SCORE 900','CATCH 12','AVOID 3']},1000);assert.equal(s.r.kind,'grade');
  assert.ok(s.f.calls.some(c=>c.k==='fillRect'&&c.fill==='rgba(10,16,10,.55)'&&c.a[2]===rect.width),'full curtain');
    const t=age=>draw({text:'T',at:0,grade:'A',lines:['L1','L2','L3']},age).f.of('fillText').map(c=>c.a[0]);
  assert.deepEqual(t(500),['A','L1']);assert.deepEqual(t(700),['A','L1','L2']);assert.deepEqual(t(900),['A','L1','L2','L3']);
  assert.ok(near(draw({text:'T',at:0,grade:'B'},0).f.of('scale')[0].a[0],2.2,.01),'grade enters at 2.2x');
  assert.equal(draw({text:'T',at:0,grade:'B'},5100).r,null);
  const big=draw({text:'3',at:0,big:true},100);assert.equal(big.r.kind,'big');assert.equal(big.f.of('fillRect').length,0);assert.ok(big.f.of('fillText')[0].font.includes('px'));
  assert.equal(draw({text:'3',at:0,big:true},1000).r,null);
  const bad=draw({text:'T',at:0,grade:'Z'},100);assert.equal(bad.r.kind,'plain');
});

test('ART-17 cached background: one gradient per size, plain painting in Node',()=>{
  setCanvasFactory(()=>null);const a=fake();assert.equal(drawBackground(a.ctx,1280,720),false);assert.ok(a.of('fillRect').length>=2);
  let made=0;setCanvasFactory((w,h)=>{made++;return {width:w,height:h,getContext:()=>new Proxy({createRadialGradient:()=>({addColorStop(){}})},{get:(t,k)=>k in t?t[k]:()=>{},set:()=>true})};});
  const b=fake();assert.equal(drawBackground(b.ctx,1280,720),true);drawBackground(b.ctx,1280,720);drawBackground(b.ctx,1280,720);assert.equal(made,1);assert.equal(b.of('drawImage').length,3);
  drawBackground(b.ctx,640,360);assert.equal(made,2);clearSpriteCache();setCanvasFactory(()=>null);
});

test('ART-18 tween eases to a new target without jumping',()=>{
  const s={};assert.equal(tween(s,'k',1,0,120),1);
  const v=[0,20,40,60,80,100,120,140].map(t=>tween(s,'k',1.35,t,120));
  assert.ok(near(v[0],1,1e-9));assert.ok(near(v.at(-1),1.35,1e-9));assert.ok(v.every((x,i)=>i===0||Math.abs(x-v[i-1])<.3),'no single-step jump');assert.ok(Math.max(...v)>1.35,'overshoot');
  const mid=tween(s,'k',1,150,120);assert.ok(near(mid,1.35,.1),'reversing starts from the current value');
  assert.equal(stateFor(null).constructor,Object);const o={};assert.equal(stateFor(o),stateFor(o));
});

test('ART-19 arena: BOMB shakes the picture inside W/160 and then stops; feedback sits at the event point; legacy effect shape still works',()=>{
  setCanvasFactory(()=>null);
  const g=geometry(),snap={mode:'PLAYING',attacks:[],score:40,hp:75},w=g.visible.width;
  const run=(effect,now,extra={})=>{const f=fake();drawArena(f.ctx,snap,null,{now,lastEffect:effect,geometry:g,...extra});return f;};
  const shaken=run({outcome:'BOMB',at:1000,scoreDelta:-25},1050);const t=shaken.of('translate')[0];
  const small=f=>f.of('translate').filter(c=>Math.abs(c.a[0])<=w/160+1e-9&&Math.abs(c.a[1])<=w/160+1e-9);
  assert.equal(small(shaken).length,1);assert.ok(t.a[0]!==0||t.a[1]!==0);
  assert.equal(small(run({outcome:'BOMB',at:1000,scoreDelta:-25},1400)).length,0);
  assert.equal(small(run({outcome:'CATCH',at:1000,scoreDelta:50},1050)).length,0);
  const placed=run({outcome:'AVOID',at:1000,scoreDelta:30,x:.2,y:.3},1500);
  assert.ok(placed.of('translate').some(c=>near(c.a[0],g.visible.x+.2*w)&&near(c.a[1],g.visible.y+.3*g.visible.height)));
  assert.ok(run({outcome:'CATCH',at:1000,scoreDelta:50},1500).of('fillText').some(c=>c.a[0]==='+50'));
  assert.equal(run({outcome:'CATCH',at:1000,scoreDelta:50},3000).of('fillText').some(c=>c.a[0]==='+50'),false,'expired');
  assert.ok(run(null,0,{banner:{text:'ROUND OVER',at:0}}).of('fillText').some(c=>c.a[0]==='ROUND OVER'));
});

test('ART-20 arena HUD: drawn from snapshot.score/hp, extras optional, not drawn when idle or missing',()=>{
  setCanvasFactory(()=>null);const g=geometry();
  const texts=snap=>{const f=fake();drawArena(f.ctx,snap,null,{now:0,geometry:g});return f.of('fillText').map(c=>c.a[0]);};
  assert.ok(texts({mode:'PLAYING',attacks:[],score:5,hp:90}).includes('005'));
  assert.ok(texts({mode:'PLAYING',attacks:[],score:5,hp:90,combo:6,multiplier:2,roundLeftMs:61000}).includes('1:01'));
  assert.equal(texts({mode:'PLAYING',attacks:[]}).length,0);assert.equal(texts({mode:'IDLE',attacks:[],score:0,hp:100}).length,0);
});

test('ART-21 catcher ring grows toward 1.35x with easeOutBack, never instantly',()=>{
  setCanvasFactory(()=>null);const g=geometry(),ctxState={};
  const f=fake();const snapIn={mode:'PLAYING',attacks:[{cell:5,kind:'DROP',cells:[2,5,8],progress:.4}]};
  const radius=(now,snap)=>{const r=f.calls.length;drawArena(f.ctx,snap,{x:.5,y:.5},{now,geometry:g,marker:true,showMarker:true});return f.calls.slice(r).filter(c=>c.k==='arc'&&c.lw>=4&&c.stroke==='#ffd23f'||c.k==='arc'&&c.stroke==='#d9f965'&&c.lw>=4).map(c=>c.a[2]).at(0);};
  void ctxState;
  const out={mode:'PLAYING',attacks:[{cell:2,kind:'DROP',cells:[2,5,8],progress:.4}]};
  const r0=radius(0,out),r1=radius(16,out);const base=Math.max(10,Math.min(26,g.visible.width/40));
  assert.ok(near(r0,base,.01));
  const rs=[radius(1000,snapIn),radius(1020,snapIn),radius(1060,snapIn),radius(1120,snapIn),radius(1300,snapIn)];
  assert.ok(rs[0]-r1<base*.35,'first frame after entering lane does not jump');assert.ok(rs.at(-1)>=base*1.34);assert.ok(rs[1]>rs[0]);
});

test('ART-22 overlay path: drawCameraOverlay takes an optional now and keeps its old call shape',()=>{
  setCanvasFactory(()=>null);const g=geometry();
  for(const opts of [{clear:false},{clear:false,now:1234}]){const f=fake();drawCameraOverlay(f.ctx,g,{mode:'PLAYING',attacks:[{cell:5,kind:'DROP',cells:[2,5,8],progress:.9,variant:'BOMB'}]},opts);assert.ok(f.of('arc').length+f.of('ellipse').length+f.of('quadraticCurveTo').length>5);}
});

test('ART-T1 (theme) a three-pointer is a differently coloured ball: its own cached sprite and violet, the two-pointer stays orange',()=>{
  setCanvasFactory(()=>null);
  const fills=three=>{const f=fake();drawOrb(f.ctx,100,100,10,0,.5,three);return f;};
  const two=fills(false),thr=fills(true);
  assert.ok(two.of('arc').length>0&&thr.of('arc').length>0);
  const colors=f=>f.calls.map(c=>JSON.stringify(c)).join('');
  assert.ok(/255,140,40/.test(colors(two))&&!/160,110,255/.test(colors(two)),'two-pointer is orange');
  assert.ok(/160,110,255/.test(colors(thr))&&!/rgba\(255,140,40,\.0/.test(colors(thr)),'three-pointer is violet');
});

test('ART-FACE a pie effect lands on the live face even when the effect carries a floor spot, and falls back to that spot without a face',()=>{
  const effect={outcome:'BOMB',at:0,scoreDelta:-25,x:.5,y:.93};
  const onFace=feedbackAnchor(effect,rect,{catcherX:.5,faceX:.3,faceY:.4});
  assert.ok(Math.abs(onFace.x-(rect.x+.3*rect.width))<1e-9&&Math.abs(onFace.y-(rect.y+.4*rect.height))<1e-9);
  const noFace=feedbackAnchor(effect,rect,{catcherX:.5});
  assert.ok(Math.abs(noFace.x-(rect.x+.5*rect.width))<1e-9&&Math.abs(noFace.y-(rect.y+.93*rect.height))<1e-9);
});

test('ART-STUN dizzy stars draw three stars; the pie cream lasts 1300 ms while other labels stay at 1000 ms',()=>{
  const f=fake();drawStunStars(f.ctx,200,200,12,500);
  assert.equal(f.of('fill').length,3);
  assert.notEqual(drawFeedback(fake().ctx,rect,{outcome:'BOMB',at:0,scoreDelta:-25},1200),null);
  assert.equal(drawFeedback(fake().ctx,rect,{outcome:'BOMB',at:0,scoreDelta:-25},1300),null);
  assert.equal(drawFeedback(fake().ctx,rect,{outcome:'CATCH',at:0,scoreDelta:20},1200),null);
});
