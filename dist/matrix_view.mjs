// Pure geometry and Canvas drawing; this module does not access a camera or network.
import {dropTarget,dropY,DROP_FLOOR,DROP_CATCH_HALF,dropPoints,shotArc} from './drop_lanes.mjs';
import {drawGuide,drawLanding,drawOrb,drawBomb,drawPie,THREE_BALL_COLOR,STAR_BALL_COLOR} from './art.mjs';
export function containRect(viewWidth, viewHeight, sourceWidth, sourceHeight) {
  if (![viewWidth,viewHeight,sourceWidth,sourceHeight].every(n=>Number.isFinite(n) && n>0)) throw new RangeError('Invalid dimensions');
  const scale=Math.min(viewWidth/sourceWidth,viewHeight/sourceHeight);
  const width=sourceWidth*scale, height=sourceHeight*scale;
  return {x:(viewWidth-width)/2,y:(viewHeight-height)/2,width,height};
}

export function gridRects(rect) {
  return Array.from({length:9},(_,i)=>({cell:i+1,x:rect.x+(i%3)*rect.width/3,
    y:rect.y+Math.floor(i/3)*rect.height/3,width:rect.width/3,height:rect.height/3}));
}

export function mapPoint(point, rect, mirror = false) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {x:rect.x+(mirror ? 1-point.x : point.x)*rect.width,y:rect.y+point.y*rect.height};
}

export function audioStatus(enabled, unlocked) {
  return !enabled ? 'MUTED' : unlocked ? 'AUDIO READY' : 'AUDIO LOCKED';
}

export function drawMatrix(ctx, snapshot, { viewWidth, viewHeight, sourceWidth, sourceHeight,
  mirror = false, nose = null, simulated = true, soundEnabled = false, audioUnlocked = false } = {}) {
  const rect=containRect(viewWidth,viewHeight,sourceWidth,sourceHeight);
  const cells=gridRects(rect);
  ctx.save();
  ctx.beginPath(); ctx.rect(rect.x,rect.y,rect.width,rect.height); ctx.clip();
  ctx.strokeStyle='#ffffff'; ctx.lineWidth=2;
  for (const cell of cells) {
    ctx.strokeRect(cell.x,cell.y,cell.width,cell.height);
    ctx.fillStyle='#ffffff'; ctx.font='16px sans-serif';
    ctx.fillText(String(cell.cell),cell.x+8,cell.y+20);
  }
  for (const attack of snapshot.attacks) {
    for (const target of attack.cells ?? [attack.cell]) {
      const cell=cells[target-1];
      if (!cell) continue;
      ctx.fillStyle='rgba(255,40,40,0.35)'; ctx.fillRect(cell.x,cell.y,cell.width,cell.height);
    }
  }
  const position=mapPoint(nose,rect,mirror);
  if (position) { ctx.fillStyle='#00ffff'; ctx.beginPath(); ctx.arc(position.x,position.y,5,0,2*Math.PI); ctx.fill(); }
  const labels=[];
  if (simulated) labels.push('SIMULATED');
  if (snapshot.mode==='TRACKING_LOST') labels.push('TRACKING LOST');
  else if (snapshot.mode==='PAUSED') labels.push('PAUSED');
  else if (snapshot.mode==='RECOVERING') labels.push(`READY ${Math.ceil(snapshot.recoveryRemaining/1000)}`);
  if (snapshot.connection==='OFFLINE') labels.push('OFFLINE');
  if (snapshot.lastResult) labels.push(snapshot.lastResult.outcome);
  labels.push(`HP ${snapshot.hp} SCORE ${snapshot.score}`);
  labels.push(audioStatus(soundEnabled,audioUnlocked));
  ctx.fillStyle='#ffffff'; ctx.font='16px sans-serif';
  labels.forEach((label,i)=>ctx.fillText(label,rect.x+8,rect.y+rect.height-12-i*20));
  ctx.restore();
  return {rect,cells,position,labels};
}

// Transparent compositing layer: only the calibrated visible camera rectangle is touched.
// The nine-cell grid is not drawn unless `grid` is true (calibration view); cells are still computed for judging and attack highlights.
export function drawCameraOverlay(ctx,geometry,snapshot,{clear=true,grid=false,now=0,face=null}={}) {
  if(clear)ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);
  if(!geometry)return {rect:null,cells:[]};
  const rect=geometry.visible,cells=gridRects(rect);
  const fontSize=Math.max(8,Math.min(28,rect.height/18,rect.width/24));
  ctx.save();ctx.beginPath();ctx.rect(rect.x,rect.y,rect.width,rect.height);ctx.clip();
  ctx.strokeStyle='rgba(220,238,210,.7)';ctx.lineWidth=Math.max(1,Math.min(3,rect.width/320));
  ctx.fillStyle='rgba(240,255,229,.9)';ctx.font=`700 ${fontSize}px monospace`;
  if(grid)for(const cell of cells){ctx.strokeRect(cell.x,cell.y,cell.width,cell.height);ctx.fillText(String(cell.cell),cell.x+4,cell.y+fontSize+3);}
  for(const attack of snapshot.attacks??[]){
    if(attack.kind==='DROP'){
      // Catch mode: a small golden orb falls from above the window to its target x near the bottom; the streamer's catcher (drawn by the arena) must cover it.
      // A faint guide line, a landing ring the width of the catcher, a short trail and a glow keep it readable without hiding the face.
      const target=Number.isFinite(attack.landX)?attack.landX:dropTarget(attack.cell-3);if(target===null)continue;
      const bomb=attack.variant==='BOMB',hue=bomb?'255,90,70':'217,249,101';
      const cx=rect.x+target*rect.width,radius=Math.max(4,Math.min(rect.width/36,rect.height/22)),p=Math.max(0,Math.min(1,attack.progress??0));
      // Three-point shot (theme): the ball or pie is thrown from the right edge, rises in an arc and comes down at its target x on the floor line; p still means "time until it lands".
      const floor=rect.y+DROP_FLOOR*rect.height,ringHalf=(attack.catchHalf??DROP_CATCH_HALF)*rect.width;
      const three=dropPoints(target)===3,arc=shotArc(attack.eventId??attack.id??attack.cell,three?3:2);   // see ARC_RANGES
      let sx,sy;
      if(three){   // left and right lanes: thrown from the lane's own side in a gentle arc
        const startX=target<.5?rect.x+(1-arc.reach)*rect.width:rect.x+arc.reach*rect.width,lift=4*((arc.startY+DROP_FLOOR)/2-arc.apex);
        sx=startX+(cx-startX)*p;sy=rect.y+(arc.startY+(DROP_FLOOR-arc.startY)*p-lift*p*(1-p))*rect.height;
      }else{       // middle lane: dropped from above with a little sideways drift
        sx=cx+arc.side*arc.drift*rect.width*(1-p);sy=rect.y+(arc.startY+(DROP_FLOOR-arc.startY)*p)*rect.height;
      }
      if(bomb){
        // Pie (theme): first the column flashes as a warning, then the pie appears directly at the target (no flight); it lands at p=1.
        const PIE_AT=.58;
        if(p<PIE_AT){
          const blink=Math.sin(now/1000*2*Math.PI*3)>0?.38:.12;
          ctx.fillStyle=`rgba(255,90,70,${blink})`;ctx.fillRect(cx-ringHalf,rect.y,ringHalf*2,floor-rect.y);
          ctx.fillStyle=`rgba(255,236,230,${blink+.4})`;ctx.font=`900 ${Math.max(14,radius*2.4)}px sans-serif`;ctx.textAlign='center';ctx.fillText('!',cx,rect.y+radius*3);ctx.textAlign='left';
        }
        drawLanding(ctx,cx,floor,radius,ringHalf,p,now,hue);
        if(p>=PIE_AT){
          // The pie is thrown straight at the camera: it starts small at the target column at face height and grows fast (ease-in) until it fills the view at impact (p=1).
          const q=Math.min(1,(p-PIE_AT)/(1-PIE_AT)),faceY=face&&Number.isFinite(face.y)?Math.max(rect.y,Math.min(face.y,floor)):rect.y+rect.height*.6;
          // A lob towards the camera: it starts small and high above the face, falls and swells quickly, and leaves a trail of fading earlier positions (consecutive frames) so it reads as thrown.
          const aimX=face&&Number.isFinite(face.x)&&Math.abs(face.x-cx)<=ringHalf?face.x:cx;   // a pie that will hit flies at the face, one that will miss flies down its lane
          // Thrown from the side edge farthest from the target, in a low arc across the screen, spinning and growing as it nears the camera.
          const fromX=arc.side>0?rect.x+rect.width+radius:rect.x-radius,dir=fromX>aimX?1:-1,startY=rect.y+radius;   // upper-left or upper-right corner, picked at random per pie (arc.side is seeded by the event id, so it stays put between frames)
          const pos=qq=>({x:fromX+(aimX-fromX)*qq,y:startY+(faceY-startY)*(.15*qq+.85*qq*qq)});   // a true projectile arc: constant sideways speed, gravity only on the vertical (y grows with time squared), so it always heads down and never rises
          // Thrown like a plate: it tumbles end over end (a turn and a half, spin direction follows the side it comes from), slows as it nears and lands cream-down on the face.
          const at=qq=>({...pos(qq),r:radius*(.6+3.9*qq*qq*qq),rot:Math.PI+dir*Math.PI*3*(1-qq),sy:1});
          for(let k=4;k>=0;k--){
            const qq=q-.06*k;if(qq<0)continue;
            const f=at(qq);ctx.save();ctx.translate(f.x,f.y);ctx.rotate(f.rot);ctx.scale(1,f.sy);ctx.globalAlpha=k?.1*(5-k)*(.4+.6*q):.55+.45*q;drawPie(ctx,0,0,f.r,now);ctx.restore();
          }
        }
        continue;
      }
      drawLanding(ctx,cx,floor,radius,ringHalf,p,now,hue);
      // A bomb is a dark core with a red breathing glow, spikes and a sparking fuse, so it reads as "keep away" and never as a gold item.
      if(bomb)drawBomb(ctx,sx,sy,radius,now,p);else{
        const star=Boolean(attack.label);
        drawOrb(ctx,sx,sy,radius,now,p,star?'star':three);
        ctx.save();ctx.textAlign='center';ctx.strokeStyle='rgba(10,16,10,.9)';
        if(star){const size=Math.max(10,radius*1.25),text=`★ ${attack.label}`;ctx.font=`900 ${size}px sans-serif`;ctx.lineWidth=Math.max(2.5,radius/4);ctx.fillStyle=STAR_BALL_COLOR;ctx.strokeText(text,sx,sy-radius*1.6);ctx.fillText(text,sx,sy-radius*1.6);}
        else{ctx.fillStyle=three?THREE_BALL_COLOR:'rgba(255,255,255,.85)';ctx.font=`900 ${Math.max(9,radius*1.1)}px sans-serif`;ctx.lineWidth=Math.max(2,radius/5);ctx.strokeText(three?'3PT':'2PT',sx,sy-radius*1.5);ctx.fillText(three?'3PT':'2PT',sx,sy-radius*1.5);}
        ctx.restore();
      }
      continue;
    }
    // Attack: only the targeted cells light up, with a soft rounded fill and the cell number, so no grid is needed on screen.
    for(const target of attack.cells??[attack.cell]){
      const cell=cells[target-1];if(!cell)continue;
      const inset=Math.max(2,cell.width/60);
      ctx.fillStyle='rgba(250,83,57,.30)';ctx.strokeStyle='rgba(255,140,112,.85)';ctx.lineWidth=Math.max(1.5,cell.width/160);
      ctx.beginPath();ctx.roundRect(cell.x+inset,cell.y+inset,cell.width-2*inset,cell.height-2*inset,Math.max(4,cell.width/24));ctx.fill();ctx.stroke();
      if(!attack.cells){ctx.fillStyle='rgba(255,236,230,.9)';ctx.font=`800 ${Math.max(10,cell.height/5)}px sans-serif`;ctx.textAlign='center';ctx.fillText(String(target),cell.x+cell.width/2,cell.y+cell.height/2+cell.height/16);ctx.textAlign='left';}
    }
  }
  drawChallengeOverlay(ctx,rect,snapshot,fontSize);
  if(snapshot.mode==='TRACKING_LOST'||snapshot.mode==='PAUSED'||snapshot.mode==='RECOVERING'){
    ctx.fillStyle='rgba(0,0,0,.65)';ctx.fillRect(rect.x,rect.y+rect.height-fontSize*1.6,rect.width,fontSize*1.6);
    ctx.fillStyle='#fff';ctx.font=`700 ${fontSize}px sans-serif`;
    ctx.fillText(snapshot.mode==='TRACKING_LOST'?'TRACKING LOST':snapshot.mode==='PAUSED'?'PAUSED':'READY',rect.x+4,rect.y+rect.height-fontSize*.4);
  }
  ctx.restore();return {rect,cells};
}

export function drawChallengeOverlay(ctx,rect,snapshot,fontSize=20){
  const freeze=snapshot.freeze,action=snapshot.actionGame,playing=snapshot.mode==='PLAYING';
  const point=p=>p?mapPoint(p,rect):null;
  const line=(a,b,color,width=3)=>{a=point(a);b=point(b);if(!a||!b)return;ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();};
  const dot=(p,color,r=6)=>{p=point(p);if(!p)return;ctx.fillStyle=color;ctx.beginPath();ctx.arc(p.x,p.y,Math.max(2,r*rect.width/1280),0,Math.PI*2);ctx.fill();};
  const label=(text,color)=>{ctx.fillStyle='rgba(10,15,10,.82)';ctx.fillRect(rect.x,rect.y+rect.height*.08,rect.width,fontSize*2);ctx.fillStyle=color;ctx.font=`bold ${fontSize}px sans-serif`;ctx.textAlign='center';ctx.fillText(text,rect.x+rect.width/2,rect.y+rect.height*.08+fontSize*1.35);ctx.textAlign='left';};
  if(freeze?.active){
    const b=freeze.box,color=freeze.phase==='RED'?'#ff7359':'#f7df68';
    ctx.fillStyle=freeze.phase==='RED'?'rgba(255,70,40,.12)':'rgba(255,222,80,.12)';
    ctx.fillRect(rect.x+b.left*rect.width,rect.y+b.top*rect.height,(b.right-b.left)*rect.width,(b.bottom-b.top)*rect.height);
    ctx.strokeStyle=color;ctx.lineWidth=3;ctx.strokeRect(rect.x+b.left*rect.width,rect.y+b.top*rect.height,(b.right-b.left)*rect.width,(b.bottom-b.top)*rect.height);
    if(playing&&['YELLOW','RED'].includes(freeze.status)){
      for(const [pose,ink] of [[freeze.anchor,'rgba(255,255,255,.45)'],[freeze.pose,color]])if(pose){
        line(pose.leftElbow,pose.leftShoulder,ink);line(pose.leftShoulder,pose.rightShoulder,ink);line(pose.rightShoulder,pose.rightElbow,ink);line(pose.nose,pose.leftShoulder,ink);line(pose.nose,pose.rightShoulder,ink);
        for(const p of Object.values(pose))dot(p,ink,8);
      }
    }
    const text=freeze.status==='UNKNOWN'?'FREEZE · UNKNOWN':freeze.status==='RECOVERING'?`FREEZE · READY ${(freeze.recoveryRemaining/1000).toFixed(1)}`:freeze.status==='PAUSED'?'FREEZE · PAUSED':`FREEZE · ${freeze.phase} ${(freeze.remainingMs/1000).toFixed(1)}s`;
    label(text,color);
  }
  if(action?.active){
    if(action.kind==='LAVA'){
      const height=rect.height*action.level;ctx.fillStyle='rgba(255,74,22,.48)';ctx.fillRect(rect.x,rect.y+rect.height-height,rect.width,height);
      ctx.strokeStyle='#ffb14e';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(rect.x,rect.y+rect.height-height);ctx.lineTo(rect.x+rect.width,rect.y+rect.height-height);ctx.stroke();
      if(playing&&action.status==='ACTIVE')dot(action.pose?.leftHip,'#baf477',14);
    }
    label(`${action.kind} · ${action.status==='ACTIVE'?`${(action.remainingMs/1000).toFixed(1)}s`:action.status==='RECOVERING'?`READY ${(action.recoveryRemaining/1000).toFixed(1)}`:action.status}`,action.kind==='LAVA'?'#ffbd80':'#f9ef78');
  }
}
