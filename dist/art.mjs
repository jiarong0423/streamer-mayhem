// Shared art kit: palette, font stack, easing, an offscreen sprite cache and the pure drawing functions used by both the arena page and the OBS overlay.
// Everything here only needs a Canvas 2D context; it never touches the DOM unless a sprite canvas is created (and then only if one is available).
import {DROP_FLOOR} from './drop_lanes.mjs';

export const COLORS=Object.freeze({
  gold:'#FFD23F',goldHi:'#FFF6BF',goldDark:'#E59A14',lime:'#D9F965',
  danger:'#FF5A46',dangerDark:'#3A1414',dangerText:'#FF8B70',dangerWarm:'#FF6B5A',orange:'#FF8B2A',
  cyan:'#3FE0FF',ink:'#0A100A',paper:'#F3F4E8',gray:'#C9D1C2',avoid:'#BFF3FF',wing:'#DCEBFF',fuse:'#8A6A3A'
});
export const FONT_STACK='"Arial Rounded MT Bold","Segoe UI Black","Arial Black",system-ui,sans-serif';
export const MIN_TEXT_PX=14;
export const font=(size,weight=900)=>`${weight} ${size}px ${FONT_STACK}`;
export const rgba=(hex,a)=>{const n=parseInt(hex.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`;};

export const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export const lerp=(a,b,t)=>a+(b-a)*t;
export const easeOutBack=t=>{t=clamp(t,0,1);const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);};
export const easeOutQuad=t=>{t=clamp(t,0,1);return 1-(1-t)*(1-t);};
export const easeOutExpo=t=>{t=clamp(t,0,1);return t>=1?1:1-Math.pow(2,-10*t);};
export const easeInCubic=t=>{t=clamp(t,0,1);return t*t*t;};

// Small deterministic generator (same idea as catch_fx) so flicker and sparks are reproducible in tests.
export function rng(seed){let x=(Math.floor(seed)>>>0)||1;return()=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}

// ---------- offscreen sprite cache ----------
let canvasFactory=(w,h)=>{
  if(typeof OffscreenCanvas==='function'){try{return new OffscreenCanvas(w,h);}catch{/* fall through */}}
  if(typeof document!=='undefined'&&document&&typeof document.createElement==='function'){try{const c=document.createElement('canvas');c.width=w;c.height=h;return c;}catch{/* fall through */}}
  return null;
};
export function setCanvasFactory(factory){canvasFactory=factory;clearSpriteCache();}
const sprites=new Map(),SPRITE_LIMIT=48;
export const spriteCacheSize=()=>sprites.size;
export function clearSpriteCache(){sprites.clear();}
// Sizes are rounded up to a step so a continuously changing radius reuses a small number of sprites.
export const bucket=(value,step=4)=>Math.max(step,Math.ceil(value/step)*step);
// Returns an offscreen canvas painted by paint(g,w,h), or null where none can be made (Node tests); callers then paint directly with the same function.
export function cachedSprite(key,w,h,paint){
  w=Math.ceil(w);h=Math.ceil(h);
  if(!(w>0&&h>0&&w<=4096&&h<=4096))return null;
  const k=`${key}:${w}x${h}`;
  if(sprites.has(k))return sprites.get(k);
  let out=null;
  try{const c=canvasFactory(w,h);const g=c&&c.getContext&&c.getContext('2d');if(g){paint(g,w,h);out=c;}}catch{out=null;}
  sprites.set(k,out);
  while(sprites.size>SPRITE_LIMIT)sprites.delete(sprites.keys().next().value);
  return out;
}
// Draws a cached sprite centred on (cx,cy) or, with no canvas available, paints it directly at that spot.
function stamp(ctx,key,r,span,paint,cx,cy,alpha=1){
  const size=bucket(r*span*2+2,4),sprite=cachedSprite(`${key}:${Math.round(r)}`,size,size,(g,w,h)=>paint(g,w/2,h/2,r));
  if(alpha!==1){ctx.save();ctx.globalAlpha*=alpha;}
  if(sprite&&typeof ctx.drawImage==='function')ctx.drawImage(sprite,cx-size/2,cy-size/2,size,size);else paint(ctx,cx,cy,r);
  if(alpha!==1)ctx.restore();
}

// ---------- per-context animation state (score pop, ring easing, ...) ----------
const states=new WeakMap();
export function stateFor(ctx){
  if(!ctx||(typeof ctx!=='object'&&typeof ctx!=='function'))return {};
  let s=states.get(ctx);if(!s){s={};states.set(ctx,s);}return s;
}
// Eases store[key] toward `target` over `dur` ms from wherever it currently is, so a changing target never makes the value jump.
export function tween(store,key,target,now,dur=120,ease=easeOutBack){
  const s=store[key];
  if(!s){store[key]={from:target,to:target,at:now,val:target};return target;}
  if(s.to!==target){s.from=s.val;s.to=target;s.at=now;}
  s.val=s.from+(s.to-s.from)*ease(clamp((now-s.at)/dur,0,1));
  return s.val;
}

// ---------- text ----------
// Black outline (size*.16) under the fill plus a soft dark shadow: readable over any camera image or stream scene.
export function strokedText(ctx,text,x,y,size,fill,{align='center',alpha=1,weight=900}={}){
  size=Math.max(MIN_TEXT_PX,size);
  ctx.save();ctx.globalAlpha*=alpha;ctx.font=font(size,weight);ctx.textAlign=align;ctx.lineJoin='round';ctx.miterLimit=2;
  ctx.lineWidth=Math.max(2,size*.16);ctx.strokeStyle=COLORS.ink;ctx.shadowColor='rgba(10,16,10,.6)';ctx.shadowBlur=size*.25;
  if(typeof ctx.strokeText==='function')ctx.strokeText(text,x,y);
  ctx.shadowBlur=0;ctx.shadowColor='transparent';ctx.fillStyle=fill;ctx.fillText(text,x,y);ctx.restore();
  return size;
}
const clipTo=(ctx,rect)=>{ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();};
const pad=(n,len)=>String(Math.max(0,Math.round(n))).padStart(len,'0');

// ---------- background (cached) ----------
export function drawBackground(ctx,w,h){
  const paint=(g,pw,ph)=>{
    g.fillStyle='#101610';g.fillRect(0,0,pw,ph);
    const gradient=g.createRadialGradient(pw*.5,ph*.45,30,pw*.5,ph*.45,pw*.6);
    gradient.addColorStop(0,'#263a28');gradient.addColorStop(1,'#111711');g.fillStyle=gradient;g.fillRect(0,0,pw,ph);
    g.save();g.globalAlpha=.16;g.strokeStyle='#99b391';g.lineWidth=1;g.beginPath();
    for(let i=-ph;i<pw;i+=48){g.moveTo(i,0);g.lineTo(i+ph,ph);}
    g.stroke();g.restore();
  };
  const sprite=cachedSprite('bg',w,h,paint);
  if(sprite&&typeof ctx.drawImage==='function'){ctx.drawImage(sprite,0,0,w,h);return true;}
  paint(ctx,w,h);return false;
}

// ---------- falling items ----------
// A basketball (theme): a ball with black seams, painted in two colours. Orange is the two-pointer, violet the three-pointer.
const ballPainter=({glow,hi,mid,dark})=>(g,cx,cy,r)=>{
  const halo=g.createRadialGradient(cx,cy,r*.2,cx,cy,r*2.6);
  halo.addColorStop(0,glow);halo.addColorStop(1,glow.replace(/[\d.]+\)$/,'0)'));
  g.fillStyle=halo;g.beginPath();g.arc(cx,cy,r*2.6,0,2*Math.PI);g.fill();
  const ball=g.createRadialGradient(cx-r*.35,cy-r*.4,r*.1,cx,cy,r);
  ball.addColorStop(0,hi);ball.addColorStop(.55,mid);ball.addColorStop(1,dark);
  g.fillStyle=ball;g.beginPath();g.arc(cx,cy,r,0,2*Math.PI);g.fill();
  g.save();g.beginPath();g.arc(cx,cy,r,0,2*Math.PI);g.clip();
  g.strokeStyle='rgba(30,14,6,.85)';g.lineWidth=Math.max(1.5,r/9);
  g.beginPath();g.moveTo(cx,cy-r);g.lineTo(cx,cy+r);g.moveTo(cx-r,cy);g.lineTo(cx+r,cy);g.stroke();
  g.beginPath();g.arc(cx-r*1.15,cy,r*.95,-Math.PI/2.6,Math.PI/2.6);g.stroke();
  g.beginPath();g.arc(cx+r*1.15,cy,r*.95,Math.PI-Math.PI/2.6,Math.PI+Math.PI/2.6);g.stroke();
  g.restore();
  g.strokeStyle='rgba(10,16,10,.8)';g.lineWidth=Math.max(1.5,r/10);g.beginPath();g.arc(cx,cy,r,0,2*Math.PI);g.stroke();
  g.fillStyle='rgba(255,255,255,.55)';g.beginPath();g.ellipse(cx-r*.35,cy-r*.4,r*.2,r*.14,-.5,0,2*Math.PI);g.fill();
};
const PAINT_ORB=ballPainter({glow:'rgba(255,140,40,.5)',hi:'#FFB36B',mid:'#F0791E',dark:'#B34A0B'});
export const THREE_BALL_COLOR='#B58CFF';   // the three-pointer's colour, also used for its label
const PAINT_ORB3=ballPainter({glow:'rgba(160,110,255,.55)',hi:'#E3D3FF',mid:'#9B5CFF',dark:'#5326B5'});
export const STAR_BALL_COLOR='#FFD23F';   // the star ball (a supporter's name on it): gold
const PAINT_ORBSTAR=ballPainter({glow:'rgba(255,210,63,.65)',hi:'#FFF6BF',mid:'#FFC933',dark:'#B07A00'});
const PAINT_RED_GLOW=(g,cx,cy,r)=>{
  const glow=g.createRadialGradient(cx,cy,r*.3,cx,cy,r*2.6);
  glow.addColorStop(0,'rgba(255,90,70,.9)');glow.addColorStop(1,'rgba(255,90,70,0)');
  g.fillStyle=glow;g.beginPath();g.arc(cx,cy,r*2.6,0,2*Math.PI);g.fill();
};
const PAINT_BOMB_CORE=(g,cx,cy,r)=>{   // a cream pie (theme): crust, white cream dome, cherry
  const crust=g.createRadialGradient(cx-r*.3,cy+r*.1,r*.1,cx,cy+r*.2,r*1.05);
  crust.addColorStop(0,'#F0C48A');crust.addColorStop(1,'#B97B3E');
  g.fillStyle=crust;g.beginPath();g.ellipse(cx,cy+r*.25,r,r*.62,0,0,2*Math.PI);g.fill();
  g.strokeStyle=COLORS.dangerWarm;g.lineWidth=Math.max(1.5,r/7);g.beginPath();g.ellipse(cx,cy+r*.25,r,r*.62,0,0,2*Math.PI);g.stroke();
  const cream=g.createRadialGradient(cx-r*.25,cy-r*.35,r*.1,cx,cy-r*.1,r*.8);
  cream.addColorStop(0,'#FFFFFF');cream.addColorStop(1,'#F3E6D6');
  g.fillStyle=cream;g.beginPath();g.ellipse(cx,cy-r*.05,r*.78,r*.55,0,0,2*Math.PI);g.fill();
  g.fillStyle='#D8283C';g.beginPath();g.arc(cx+r*.05,cy-r*.42,r*.2,0,2*Math.PI);g.fill();
  g.fillStyle='rgba(255,255,255,.7)';g.beginPath();g.arc(cx-r*.02,cy-r*.48,r*.06,0,2*Math.PI);g.fill();
};
// Thin vertical glow for the guide line, cached by height bucket and stretched.
export function drawGuide(ctx,x,top,bottom,radius,hue){
  const height=bottom-top;if(!(height>0))return;
  const lineW=Math.max(2,radius/3);
  const sprite=cachedSprite(`guide:${hue}`,4,bucket(height,32),(g,w,h)=>{const grad=g.createLinearGradient(0,0,0,h);grad.addColorStop(0,`rgba(${hue},0)`);grad.addColorStop(1,`rgba(${hue},.28)`);g.fillStyle=grad;g.fillRect(0,0,w,h);});
  if(sprite&&typeof ctx.drawImage==='function'){ctx.drawImage(sprite,x-lineW/2,top,lineW,height);return;}
  if(typeof ctx.createLinearGradient==='function'){const grad=ctx.createLinearGradient(0,top,0,bottom);grad.addColorStop(0,`rgba(${hue},0)`);grad.addColorStop(1,`rgba(${hue},.28)`);ctx.fillStyle=grad;ctx.fillRect(x-lineW/2,top,lineW,height);}
}
// Landing ring: calm until p=.6, then it thickens, brightens and pulses (4Hz rising to 6Hz) as the item closes in; the pulse width never jumps because k starts at 0.
export function drawLanding(ctx,cx,floor,r,ringHalf,p,now,hue){
  const k=easeInCubic((p-.6)/.4),hz=4+2*k,pulse=1+.06*k*Math.sin(2*Math.PI*hz*now/1000);
  ctx.save();ctx.strokeStyle=`rgba(${hue},${lerp(.3,.9,k).toFixed(3)})`;ctx.lineWidth=lerp(Math.max(1.5,r/4),Math.max(2,r/2),k);
  ctx.beginPath();ctx.ellipse(cx,floor+r*.4,ringHalf*(1.15-.15*p)*pulse,r*.7,0,0,2*Math.PI);ctx.stroke();ctx.restore();
  return {k,pulse,lineWidth:ctx.lineWidth};
}
function drawAim(ctx,cx,y,r,p,hue){
  if(p<=.85)return;
  const t=clamp((p-.85)/.15,0,1);
  ctx.save();ctx.strokeStyle=`rgba(${hue},.9)`;ctx.lineWidth=Math.max(1.5,r/6);ctx.beginPath();ctx.arc(cx,y,r*lerp(2.2,1,t),0,2*Math.PI);ctx.stroke();ctx.restore();
}
export function drawOrb(ctx,cx,y,r,now=0,p=0,style=false){   // style: false/'two' orange, true/'three' violet, 'star' gold
  const star=style==='star',three=style===true||style==='three';
  for(let i=3;i>=1;i--){ctx.fillStyle=`${star?'rgba(255,210,63,':three?'rgba(160,110,255,':'rgba(255,140,40,'}${(.09*(4-i)).toFixed(3)})`;ctx.beginPath();ctx.arc(cx,y-i*r*1.1,r*(1-.2*i),0,2*Math.PI);ctx.fill();}
  const flash=.3+.4*(.5+.5*Math.sin(now/1000*6*Math.PI)),len=r*2.2;
  ctx.save();ctx.strokeStyle=`rgba(255,246,191,${flash.toFixed(3)})`;ctx.lineWidth=Math.max(1.5,r/8);ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(cx-len,y);ctx.lineTo(cx+len,y);ctx.moveTo(cx,y-len);ctx.lineTo(cx,y+len);ctx.stroke();ctx.restore();
  drawAim(ctx,cx,y,r,p,'217,249,101');
  stamp(ctx,star?'orbstar':three?'orb3':'orb',r,2.6,star?PAINT_ORBSTAR:three?PAINT_ORB3:PAINT_ORB,cx,y);
}
export function drawBomb(ctx,cx,y,r,now=0,p=0){
  const near=easeInCubic(p),breath=.5+.15*Math.sin(2*Math.PI*1.5*(1+near)*now/1000);
  stamp(ctx,'bomb-glow',r,2.6,PAINT_RED_GLOW,cx,y,breath/.9);
  const spin=now/1000*2*(1+2*near);
  ctx.save();ctx.strokeStyle=COLORS.dangerDark;ctx.lineWidth=Math.max(2,r/4);ctx.lineCap='round';ctx.beginPath();
  for(let k=0;k<8;k++){const a=k*Math.PI/4+spin;ctx.moveTo(cx+Math.cos(a)*r*.9,y+Math.sin(a)*r*.9);ctx.lineTo(cx+Math.cos(a)*r*1.5,y+Math.sin(a)*r*1.5);}
  ctx.stroke();ctx.restore();
  drawAim(ctx,cx,y,r,p,'255,90,70');
  stamp(ctx,'bomb-core',r,1.2,PAINT_BOMB_CORE,cx,y);
  // Fuse: a short curve from the top of the bomb to the upper right, with sparks that rise and fade (re-rolled every 90ms).
  const sx=cx+r*.2,sy=y-r*.95,ex=cx+r*.85,ey=y-r*1.6;
  ctx.save();ctx.strokeStyle=COLORS.fuse;ctx.lineWidth=Math.max(1.5,r/5);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(sx,sy);
  if(typeof ctx.quadraticCurveTo==='function')ctx.quadraticCurveTo(cx+r*.2,y-r*1.5,ex,ey);else ctx.lineTo(ex,ey);ctx.stroke();
  const bucketNow=Math.floor(now/90);
  for(let layer=0;layer<2;layer++){
    const seed=bucketNow-layer,age=now-seed*90,random=rng(seed*7919+13);
    for(let i=0;i<3;i++){
      const a=1-age/180;if(a<=0){random();random();continue;}
      const dx=(random()-.5)*r*.3,dy=(random()-.5)*r*.2;
      ctx.globalAlpha=clamp(a,0,1);ctx.fillStyle=i%2?COLORS.orange:COLORS.gold;ctx.beginPath();ctx.arc(ex+dx,ey+dy-r*.8*age/180,Math.max(1.5,r*.12),0,2*Math.PI);ctx.fill();
    }
  }
  ctx.restore();
  if(p>.6)strokedText(ctx,'!',cx,y-r*2.2,Math.max(MIN_TEXT_PX,r*1.1),COLORS.danger,{alpha:clamp((p-.6)/.2,0,1)});
}

// ---------- feedback (CATCH / BOMB / AVOID / MISS / HIT) ----------
export const SPLAT_MS=1000,FEEDBACK_MS=1000,FEEDBACK_FADE_MS=300,POP_MS=160,BOMB_SHAKE_MS=300;
const MINUS='−';
const STYLE={
  CATCH:{color:COLORS.gold,scored:true},BOMB:{color:COLORS.dangerText,scored:true},AVOID:{color:COLORS.avoid,scored:true},
  MISS:{color:COLORS.gray,scale:.7,alpha:.8},HIT:{color:COLORS.dangerText}
};
const fin=Number.isFinite;
export function feedbackLabel(effect){
  const d=effect.scoreDelta,st=STYLE[effect.outcome];
  if(st?.scored&&fin(d)&&d!==0)return `${effect.outcome==='CATCH'&&fin(effect.points)?`${effect.points}PT`:effect.outcome} ${d>0?'+':MINUS}${Math.abs(d)}`;
  return effect.outcome;
}
// Where the feedback shows: the event point (effect.x/y, 0..1 of the window) or a per-outcome default.
export function feedbackAnchor(effect,rect,{catcherX=.5,faceY}={}){
  const r=Math.max(10,Math.min(26,rect.width/40)),has=fin(effect.x)&&fin(effect.y);
  const point=(rx,ry)=>({x:rect.x+clamp(has?effect.x:rx,0,1)*rect.width,y:rect.y+clamp(has?effect.y:ry,0,1)*rect.height});
  switch(effect.outcome){
    case 'CATCH':{const p=point(catcherX,DROP_FLOOR);return {x:p.x,y:has?p.y:p.y-r*2};}
    case 'BOMB':return point(catcherX,fin(faceY)?faceY:DROP_FLOOR);   // a pie ends on the face
    case 'MISS':return point(catcherX,DROP_FLOOR);
    case 'AVOID':return point(.5,.35);
    default:return {x:rect.x+rect.width/2,y:rect.y+Math.min(72,rect.height/4)};
  }
}
export function shakeOffset(age,width){
  if(!fin(age)||age<0||age>=BOMB_SHAKE_MS)return {x:0,y:0,amp:0};
  const amp=width/160*(1-age/BOMB_SHAKE_MS);
  return {x:amp*Math.sin(age*.11*Math.PI),y:amp*Math.cos(age*.17*Math.PI),amp};
}
// Draws one feedback; returns a descriptor of what was drawn (null when expired) so tests and callers can read position/colour/scale.
export function drawFeedback(ctx,rect,effect,now,{catcherX=.5,faceY}={}){
  if(!effect||!fin(effect.at)||!fin(now))return null;
  const age=Math.max(0,now-effect.at);if(age>=FEEDBACK_MS)return null;
  const st=STYLE[effect.outcome]??STYLE.HIT,anchor=feedbackAnchor(effect,rect,{catcherX,faceY}),label=feedbackLabel(effect);
  const scale=age>=POP_MS?1:.6+.4*easeOutBack(age/POP_MS);
  const fadeT=clamp((age-(FEEDBACK_MS-FEEDBACK_FADE_MS))/FEEDBACK_FADE_MS,0,1),alpha=(1-fadeT)*(st.alpha??1),rise=-rect.height*.04*easeOutQuad(fadeT);
  const size=clamp(rect.height/8,MIN_TEXT_PX,48)*(st.scale??1);
  ctx.save();clipTo(ctx,rect);
  const unit=Math.max(7,rect.width/48);
  if(effect.outcome==='BOMB'&&age<350){
    const p=easeOutExpo(age/350),r=rect.width/6*p;
    if(r>0){const g=ctx.createRadialGradient(anchor.x,anchor.y,0,anchor.x,anchor.y,r);g.addColorStop(0,'rgba(255,139,42,.9)');g.addColorStop(.6,'rgba(255,139,42,.45)');g.addColorStop(1,'rgba(255,139,42,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(anchor.x,anchor.y,r,0,2*Math.PI);ctx.fill();}
  }
  if(effect.outcome==='BOMB'&&age<SPLAT_MS){
    // Cream splat on the face: a white blob with satellite blobs and drips that run down and fade out.
    const grow=easeOutExpo(Math.min(1,age/140)),fade=1-clamp((age-SPLAT_MS+300)/300,0,1),R=unit*3.4*grow;
    ctx.save();ctx.globalAlpha=fade;ctx.fillStyle='#fff7e6';ctx.strokeStyle='rgba(214,170,110,.9)';ctx.lineWidth=Math.max(1.5,unit*.18);
    const blob=(x,y,r)=>{ctx.beginPath();ctx.arc(x,y,r,0,2*Math.PI);ctx.fill();ctx.stroke();};
    blob(anchor.x,anchor.y,R);
    for(let i=0;i<8;i++){const ang=i*Math.PI/4+.3,d=R*(.85+.25*((i*5)%3)/2);blob(anchor.x+Math.cos(ang)*d,anchor.y+Math.sin(ang)*d,R*(.28+.12*(i%3)));}
    for(const dx of [-.55,0,.5]){const len=unit*(1.2+4*easeOutQuad(Math.min(1,age/SPLAT_MS)))*(dx===0?1.3:1);ctx.fillRect(anchor.x+dx*R-unit*.28,anchor.y+R*.4,unit*.56,len);}
    ctx.restore();
  }
  if(effect.outcome==='MISS'&&age<400){
    const t=easeOutQuad(age/400);ctx.strokeStyle=rgba(COLORS.gray,.5*(1-t));ctx.lineWidth=Math.max(2,unit*.4);ctx.beginPath();ctx.ellipse(anchor.x,anchor.y,unit*(2+4*t),unit*(1+1.4*t),0,0,2*Math.PI);ctx.stroke();
  }
  const tx=anchor.x,ty=anchor.y+rise;
  ctx.translate(tx,ty);ctx.scale(scale,scale);
  const d=effect.scoreDelta;
  if(effect.outcome==='CATCH'&&fin(d)&&d!==0){
    strokedText(ctx,`${d>0?'+':MINUS}${Math.abs(d)}`,0,0,size,st.color,{alpha});
    strokedText(ctx,'CATCH',0,-size*.95,size*.5,st.color,{alpha});
    if(fin(effect.combo)&&effect.combo>1)strokedText(ctx,`×${effect.combo}`,size*1.5,0,size*.7,COLORS.paper,{alpha,align:'left'});
  }else strokedText(ctx,label,0,0,size,st.color,{alpha});
  ctx.restore();
  return {outcome:effect.outcome,label,x:tx,y:ty,color:st.color,scale,alpha,size,age};
}
// Red flush at the edges (a hit) with an adjustable inner radius; the overlay uses a narrow ring so the stream scene stays clear.
export function drawVignette(ctx,rect,strength,{inner=.45,rgb='255,60,50',ring=false}={}){
  if(!(strength>0))return false;
  const cx=rect.x+rect.width/2,cy=rect.y+rect.height/2,g=ctx.createRadialGradient(cx,cy,rect.height*(ring?.5:inner),cx,cy,rect.height*.9);
  g.addColorStop(0,`rgba(${rgb},0)`);g.addColorStop(1,`rgba(${rgb},${clamp(strength,0,1).toFixed(3)})`);
  ctx.save();clipTo(ctx,rect);ctx.fillStyle=g;ctx.fillRect(rect.x,rect.y,rect.width,rect.height);ctx.restore();return true;
}

// ---------- HUD ----------
const panel=(ctx,x,y,w,h,alpha)=>{ctx.save();ctx.fillStyle=`rgba(10,16,10,${alpha})`;ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=1;ctx.beginPath();ctx.roundRect(x,y,w,h,Math.min(14,h/3));ctx.fill();ctx.stroke();ctx.restore();};
export const formatClock=ms=>{const s=Math.max(0,Math.ceil(ms/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;};
// score/hp are required for the score panel; combo, multiplier and roundLeftMs are optional and simply not drawn when missing.
export function drawHud(ctx,rect,s,now=0,{panelAlpha=.62}={}){
  if(!s)return null;
  const st=stateFor(ctx),H=rect.height,u=rect.width/100,m=u*2,drawn=[];
  ctx.save();clipTo(ctx,rect);
  if(fin(s.roundLeftMs)){
    const size=Math.max(MIN_TEXT_PX,H/11),low=s.roundLeftMs<=10000,text=formatClock(s.roundLeftMs),w=size*2.9,h=size*1.5;
    panel(ctx,rect.x+m,rect.y+m,w,h,panelAlpha);
    const a=low?.7+.3*Math.sin(2*Math.PI*2*now/1000):1;
    strokedText(ctx,text,rect.x+m+w/2,rect.y+m+h*.72,size,low?COLORS.dangerText:COLORS.paper,{alpha:a});drawn.push('timer');
  }
  if(fin(s.score)){
    const size=Math.max(MIN_TEXT_PX,H/9),w=size*3.1,h=size*1.6,x=rect.x+rect.width-m-w,y=rect.y+m;
    if(st.score!==undefined&&s.score!==st.score){st.scoreAt=now;st.scoreUp=s.score>st.score;}
    st.score=s.score;
    const t=clamp((now-(st.scoreAt??-1e9))/120,0,1),pop=st.scoreAt===undefined?1:1+.15*Math.sin(Math.PI*t),flash=st.scoreUp&&now-(st.scoreAt??-1e9)<200;
    panel(ctx,x,y,w,h,panelAlpha);
    strokedText(ctx,'SCORE',x+w/2,y+h*.28,Math.max(MIN_TEXT_PX,size*.28),COLORS.lime);
    ctx.save();ctx.translate(x+w/2,y+h*.8);ctx.scale(pop,pop);strokedText(ctx,pad(s.score,3),0,0,size,flash?COLORS.gold:COLORS.paper);ctx.restore();
    drawn.push('score');
    if(fin(s.hp)){
      const bw=rect.width*.16,bh=Math.max(6,H/42),bx=rect.x+rect.width-m-bw,by=y+h+bh*.8,f=clamp(s.hp/100,0,1);
      if(st.hp!==undefined&&s.hp<st.hp){st.ghost=Math.max(st.ghost??0,st.hp);st.hurtAt=now;}
      if(st.hp!==undefined&&s.hp>st.hp)st.ghost=s.hp;
      st.hp=s.hp;
      const gt=easeOutQuad((now-(st.hurtAt??-1e9)-250)/250),ghost=st.ghost===undefined?s.hp:lerp(st.ghost,s.hp,gt);
      panel(ctx,bx-6,by-6,bw+12,bh+12,panelAlpha);
      ctx.fillStyle='rgba(255,255,255,.14)';ctx.beginPath();ctx.roundRect(bx,by,bw,bh,bh/2);ctx.fill();
      if(ghost>s.hp){ctx.fillStyle='rgba(255,255,255,.55)';ctx.beginPath();ctx.roundRect(bx,by,Math.max(bh,bw*clamp(ghost/100,0,1)),bh,bh/2);ctx.fill();}
      ctx.fillStyle=s.hp<=30?'#FF6B4A':COLORS.lime;ctx.beginPath();ctx.roundRect(bx,by,Math.max(bh,bw*f),bh,bh/2);ctx.fill();
      drawn.push('hp');
    }
  }
  if(fin(s.combo)){
    const size=Math.max(MIN_TEXT_PX,H/10),cx=rect.x+rect.width/2,cy=rect.y+m+size;
    if(st.combo!==undefined&&s.combo>st.combo)st.comboAt=now;
    if(st.combo!==undefined&&st.combo>=3&&s.combo<st.combo){st.lostAt=now;st.lostVal=st.combo;}
    st.combo=s.combo;
    if(s.combo>=3){
      const t=clamp((now-(st.comboAt??-1e9))/100,0,1),pop=st.comboAt===undefined?1:1+.2*Math.sin(Math.PI*t);
      ctx.save();ctx.translate(cx,cy);ctx.scale(pop,pop);strokedText(ctx,`×${Math.round(s.combo)}`,0,0,size,COLORS.gold);ctx.restore();
      strokedText(ctx,'COMBO',cx,cy-size*.95,size*.34,COLORS.paper);drawn.push('combo');
      if(fin(s.multiplier)&&s.multiplier>1){strokedText(ctx,`SCORE ×${Number.isInteger(s.multiplier)?s.multiplier:s.multiplier.toFixed(1)}`,cx,cy+size*.5,size*.4,COLORS.lime);drawn.push('multiplier');}
    }else if(st.lostAt!==undefined&&now-st.lostAt<200){
      const sx=4*Math.sin(2*Math.PI*20*(now-st.lostAt)/1000);
      strokedText(ctx,`×${Math.round(st.lostVal)}`,cx+sx,cy,size,COLORS.danger,{alpha:1-(now-st.lostAt)/200});drawn.push('comboLost');
    }
  }
  ctx.restore();
  return {drawn};
}

// ---------- round banner ----------
export const BANNER_PLAIN_MS=6000,BANNER_GRADE_MS=5100,BANNER_BIG_MS=1000;
const GRADE_COLOR={S:COLORS.gold,A:COLORS.lime,B:COLORS.paper};
// banner: {text,at,grade?:'S'|'A'|'B',big?:boolean,lines?:string[]}. big = countdown digits (large, no curtain). grade = full-screen result card.
export function drawBanner(ctx,rect,banner,now){
  if(!banner||!fin(banner.at)||!fin(now))return null;
  const age=now-banner.at;if(age<0)return null;
  const grade=GRADE_COLOR[banner.grade]?banner.grade:null;
  ctx.save();clipTo(ctx,rect);
  const cx=rect.x+rect.width/2,H=rect.height;
  let kind;
  if(banner.big){
    kind='big';const ms=fin(banner.ms)?banner.ms:BANNER_BIG_MS;
    if(age>=ms){ctx.restore();return null;}
    const size=H/2.6,scale=lerp(1.35,1,easeOutBack(age/200)),alpha=Math.min(1,age/80)*clamp((ms-age)/250,0,1);
    ctx.translate(cx,rect.y+H*.55);ctx.scale(scale,scale);strokedText(ctx,String(banner.text),0,0,size,grade?GRADE_COLOR[grade]:COLORS.paper,{alpha});
  }else if(grade){
    kind='grade';if(age>=BANNER_GRADE_MS){ctx.restore();return null;}
    const fade=age>4500?clamp(1-(age-4500)/600,0,1):1;
    ctx.globalAlpha=fade;ctx.fillStyle='rgba(10,16,10,.55)';ctx.fillRect(rect.x,rect.y,rect.width,H);
    const t=age/400,size=H/2.6,color=GRADE_COLOR[grade],scale=lerp(2.2,1,easeOutBack(t)),a=clamp(t,0,1),gy=rect.y+H*.42;
    if(grade==='S'){
      ctx.save();ctx.globalCompositeOperation='lighter';const g=ctx.createRadialGradient(cx,gy,0,cx,gy,H*.55);g.addColorStop(0,'rgba(255,210,63,.55)');g.addColorStop(1,'rgba(255,210,63,0)');ctx.globalAlpha=fade*a;ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,gy,H*.55,0,2*Math.PI);ctx.fill();ctx.restore();
    }
    ctx.save();ctx.translate(cx,gy+size*.35);ctx.scale(scale,scale);strokedText(ctx,grade,0,0,size,color,{alpha:a});ctx.restore();
    const lines=Array.isArray(banner.lines)&&banner.lines.length?banner.lines:[banner.text];
    lines.slice(0,4).forEach((line,i)=>{const la=clamp((age-400-i*150)/150,0,1);if(la>0)strokedText(ctx,String(line),cx,rect.y+H*.66+i*(H/12),Math.max(MIN_TEXT_PX,H/16),COLORS.paper,{alpha:la});});
  }else{
    kind='plain';if(age>=BANNER_PLAIN_MS){ctx.restore();return null;}
    const alpha=Math.min(1,age/300)*(age>5200?Math.max(0,1-(age-5200)/800):1),size=clamp(H/6,16,72);
    ctx.globalAlpha=alpha;ctx.fillStyle='rgba(10,16,10,.55)';ctx.fillRect(rect.x,rect.y+H*.38,rect.width,size*1.9);
    strokedText(ctx,String(banner.text),cx,rect.y+H*.38+size*1.3,size,COLORS.lime);
  }
  ctx.restore();
  return {kind,grade,age};
}
