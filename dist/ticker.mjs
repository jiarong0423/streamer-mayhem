// Top marquee (theme): a strip across the top of the arena that scrolls the latest results with the viewer who made the shot.
// "ALICE  3PT ✓ +30  COMBO +4  ×2" = Alice sank a three-pointer, the combo is now 4, and it is her second shot in a row.
// Pure data plus one draw function; no timers. The newest entry is first in the text.
import {COLORS,FONT_STACK,strokedText} from './art.mjs';
import {cleanViewerName,sanitizeName} from './eventsub_adapter.mjs';
export const TICKER_H=.085;
export const VERSUS_H=.016;            // thin tug-of-war bar under the strip
export const CHAT_POINTS={MISS:10,BOMB:25};   // what chat earns when the streamer misses a ball / catches a pie              // height of the strip, as a fraction of the arena height
export const TICKER_MAX=8;              // entries kept
export const TICKER_TTL_MS=90000;       // an entry leaves the strip after this long
export const STREAK_GAP_MS=20000;       // two shots by the same viewer within this time are a streak
const SPEED=.055;                       // arena widths per second

// Entry colours by tone. The OBS overlay protocol carries the tone (an enum), never a colour string; both screens look the colour up here.
export const TONE_COLORS=Object.freeze({SCORE3:'#B58CFF',SCORE2:'#FFB36B',MISS:'#9AA39A',SPLAT:'#FF6B5A',DODGE:'#9BE15D',CHEER:'#FFD23F',REFUSED:'#9AA39A'});
export const REJECT_TEXT=Object.freeze({ACTOR_COOLDOWN:'WAIT 3S',GLOBAL_COOLDOWN:'TOO FAST',MODE_BUSY:'BUSY',PIE_COOLDOWN:'WAIT PIE',QUEUE_FULL:'BUSY'});
export const cleanName=cleanViewerName;   // the one shared name cleaner (eventsub_adapter.mjs): no star, no reserved words, no invisible characters

// Name for the browser's speech voice (opt-in): letters, digits, spaces, "_" and "-" only, at most 20 characters; '' when nothing speakable is left.
export function speakableName(n){
  const c=sanitizeName(n);if(!c||Array.from(c).length>16)return '';
  const t=c.replace(/[^\p{L}\p{N} _-]/gu,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim().slice(0,20);
  return /\p{L}/u.test(t)?t:'';   // digits only (a number read out loud) is not a name
}

export function createTicker({max=TICKER_MAX,ttl=TICKER_TTL_MS,gap=STREAK_GAP_MS}={}){
  const entries=[],byEvent=new Map();let last={name:'',at:-Infinity,streak:0};
  // A viewer's shot was accepted: remember who, and count the streak (same viewer again within `gap`; anyone else resets it).
  function noteShot(eventId,name,now,supporter=false){
    const who=cleanName(name);if(!who)return 0;
    const streak=last.name===who&&now-last.at<=gap?last.streak+1:1;last={name:who,at:now,streak};
    byEvent.set(eventId,{name:who,streak,supporter:Boolean(supporter)});if(byEvent.size>200)byEvent.delete(byEvent.keys().next().value);return streak;
  }
  // A shot was settled. `event` is the game's result; auto drops have no viewer and show as AUTO.
  function noteResult(event,now){
    if(!event||event.kind!=='DROP')return null;
    const who=byEvent.get(event.eventId);byEvent.delete(event.eventId);
    const pie=event.variant==='BOMB',name=who?.name??'AUTO',streak=who?.streak??0;
    let text,tone;
    if(event.outcome==='CATCH'){text=`${event.points===3?'3PT':'2PT'} ✓ +${Math.abs(event.scoreDelta??0)}`;tone=event.points===3?'SCORE3':'SCORE2';}
    else if(event.outcome==='MISS'){text='MISS';tone='MISS';}
    else if(event.outcome==='BOMB'){text=`PIE SPLAT${Number.isFinite(event.scoreDelta)&&event.scoreDelta<0?` -${Math.abs(event.scoreDelta)}`:''}`;tone='SPLAT';}
    else if(event.outcome==='AVOID'){text='PIE DODGED';tone='DODGE';}
    else return null;
    if(!pie&&event.outcome==='CATCH'&&Number.isFinite(event.combo)&&event.combo>0)text+=`  COMBO +${event.combo}`;
    if(streak>1)text+=`  ×${streak}`;
    const entry={name,text,tone,color:TONE_COLORS[tone],at:now,...(who?.supporter?{star:true}:{})};entries.unshift(entry);if(entries.length>max)entries.pop();return entry;
  }
  // A chat message that carries Bits shows up on the strip even when it is not a command: "★ Mika  CHEERED 100 BITS".
  const seenSupport=new Map();
  function noteSupport(delivery,now,id){
    const who=cleanName(delivery?.viewer),bits=delivery?.cheerBits;
    if(!who||!Number.isInteger(bits)||bits<=0)return null;
    if(typeof id==='string'&&id){if(seenSupport.has(id))return null;seenSupport.set(id,true);if(seenSupport.size>200)seenSupport.delete(seenSupport.keys().next().value);}
    const entry={name:who,star:true,text:`CHEERED ${bits} BITS`,tone:'CHEER',color:TONE_COLORS.CHEER,at:now};entries.unshift(entry);if(entries.length>max)entries.pop();return entry;
  }
  // A real command that the game refused (too soon, too many at once, the other kind is on screen) is shown, so a viewer can tell "my command arrived but had to wait"
  // from "nothing arrived". Chat that is not a command (INVALID_COMMAND and the like) is never shown. At most one note per viewer every 3 s.
  const lastReject=new Map();
  function noteReject(delivery,now){
    const text=Object.hasOwn(REJECT_TEXT,delivery?.reason)?REJECT_TEXT[delivery.reason]:undefined,who=cleanName(delivery?.viewer);
    const key=typeof delivery?.actorId==='string'&&delivery.actorId?delivery.actorId:who;
    if(delivery?.accepted||!text||!who)return null;
    if(now-(lastReject.get(key)??-Infinity)<3000)return null;
    lastReject.set(key,now);if(lastReject.size>200)lastReject.delete(lastReject.keys().next().value);
    const entry={name:who,text,tone:'REFUSED',color:TONE_COLORS.REFUSED,at:now};entries.unshift(entry);if(entries.length>max)entries.pop();return entry;
  }
  const live=now=>entries.filter(e=>now-e.at<ttl);
  return {noteShot,noteResult,noteSupport,noteReject,live,reset(){entries.length=0;byEvent.clear();last={name:'',at:-Infinity,streak:0};}};
}

export const HINT='!drop 1 = 3PT left   ◆   !drop 2 = 2PT middle   ◆   !drop 3 = 3PT right   ◆   !pie 1-3 = throw a pie';

// Draws the strip at the top of `rect`: a dark band with the entries scrolling right to left and looping.
export function drawTicker(ctx,rect,entries,now=0){
  const h=rect.height*TICKER_H,size=Math.max(11,h*.62),y=rect.y+h*.5;
  ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,h);ctx.clip();
  ctx.fillStyle='rgba(8,12,8,.72)';ctx.fillRect(rect.x,rect.y,rect.width,h);
  ctx.font=`800 ${size}px ${FONT_STACK}`;ctx.textBaseline='middle';ctx.textAlign='left';
  const parts=entries.length?entries.map(e=>({name:e.name,star:e.star===true,text:e.text,color:e.color})):[{name:'',text:HINT,color:'#E7F1DC'}];
  const sep='      ◆      ';const sepW=ctx.measureText?.(sep)?.width??size*8;
  const label=p=>`${p.star?'★ ':''}${p.name}`;
  const widths=parts.map(p=>(ctx.measureText?.(`${p.name?label(p)+'  ':''}${p.text}`)?.width??size*12));
  const total=widths.reduce((a,b)=>a+b+sepW,0)||1;
  let x=rect.x+rect.width-((now/1000*SPEED*rect.width)%(total+rect.width));
  for(let pass=0;pass<2&&x<rect.x+rect.width;pass++){
    parts.forEach((p,i)=>{
      if(p.name){ctx.fillStyle=COLORS.paper??'#F4F1E6';ctx.fillText(label(p)+'  ',x,y);const nw=ctx.measureText?.(label(p)+'  ')?.width??size*4;ctx.fillStyle=p.color;ctx.fillText(p.text,x+nw,y);}
      else{ctx.fillStyle=p.color;ctx.fillText(p.text,x,y);}
      x+=widths[i]+sepW;
    });
  }
  ctx.restore();
}

// Chat's points for one settled shot (0 for everything that is the streamer's win).
export const chatPointsFor=outcome=>CHAT_POINTS[outcome]??0;
// Tug-of-war bar: the streamer's share (green, left) against chat's share (pink, right), with both numbers. Empty bar when nobody has scored.
export function drawVersus(ctx,rect,streamer,chat){
  const top=rect.y+rect.height*TICKER_H,h=rect.height*VERSUS_H,total=Math.max(0,streamer)+Math.max(0,chat),share=total>0?Math.max(0,streamer)/total:.5;
  ctx.save();ctx.beginPath();ctx.rect(rect.x,top,rect.width,h);ctx.clip();
  ctx.fillStyle='rgba(8,12,8,.72)';ctx.fillRect(rect.x,top,rect.width,h);
  ctx.fillStyle='#9BE15D';ctx.fillRect(rect.x,top,rect.width*share,h);
  ctx.fillStyle='#FF6B9A';ctx.fillRect(rect.x+rect.width*share,top,rect.width*(1-share),h);
  ctx.restore();
  const size=Math.max(9,rect.height*.034);ctx.save();ctx.textBaseline='top';
  strokedText(ctx,`STREAMER ${streamer}`,rect.x+rect.width*.02,top+h+size*.15,size,'#9BE15D',{align:'left',weight:900});
  strokedText(ctx,`CHAT ${chat}`,rect.x+rect.width*.98,top+h+size*.15,size,'#FF6B9A',{align:'right',weight:900});
  ctx.restore();
}
