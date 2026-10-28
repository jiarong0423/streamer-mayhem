// Pure geometry and Canvas drawing; this module does not access a camera or network.
import {dropTarget,dropY,DROP_FLOOR,DROP_CATCH_HALF} from './drop_lanes.mjs';
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
export function drawCameraOverlay(ctx,geometry,snapshot,{clear=true,grid=false}={}) {
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
      const target=dropTarget(attack.cell-3);if(target===null)continue;
      const cx=rect.x+target*rect.width,radius=Math.max(4,Math.min(rect.width/36,rect.height/22)),p=Math.max(0,Math.min(1,attack.progress??0));
      const y=rect.y+dropY(p)*rect.height,floor=rect.y+DROP_FLOOR*rect.height,ringHalf=DROP_CATCH_HALF*rect.width;
      const guide=ctx.createLinearGradient(0,rect.y,0,floor);
      guide.addColorStop(0,'rgba(217,249,101,0)');guide.addColorStop(1,'rgba(217,249,101,.28)');
      ctx.fillStyle=guide;ctx.fillRect(cx-Math.max(1,radius/6),rect.y,Math.max(2,radius/3),floor-rect.y);
      ctx.strokeStyle=`rgba(217,249,101,${(.3+.5*p).toFixed(3)})`;ctx.lineWidth=Math.max(1.5,radius/4);
      ctx.beginPath();ctx.ellipse(cx,floor+radius*.4,ringHalf*(1.15-.15*p),radius*(1.0-.3*p),0,0,2*Math.PI);ctx.stroke();
      for(let i=3;i>=1;i--){ctx.fillStyle=`rgba(255,210,63,${(.09*(4-i)).toFixed(3)})`;ctx.beginPath();ctx.arc(cx,y-i*radius*1.1,radius*(1-.2*i),0,2*Math.PI);ctx.fill();}
      const glow=ctx.createRadialGradient(cx,y,radius*.2,cx,y,radius*2.8);
      glow.addColorStop(0,'rgba(255,214,90,.5)');glow.addColorStop(1,'rgba(255,214,90,0)');
      ctx.fillStyle=glow;ctx.beginPath();ctx.arc(cx,y,radius*2.8,0,2*Math.PI);ctx.fill();
      const orb=ctx.createRadialGradient(cx-radius*.35,y-radius*.4,radius*.1,cx,y,radius);
      orb.addColorStop(0,'#fff6bf');orb.addColorStop(.55,'#ffd23f');orb.addColorStop(1,'#e59a14');
      ctx.fillStyle=orb;ctx.beginPath();ctx.arc(cx,y,radius,0,2*Math.PI);ctx.fill();
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
    }else if(playing&&action.status==='ACTIVE'){
      const m=action.mosquito;if(m){dot(m,'#ffed6c',22);dot({x:m.x-.012,y:m.y-.018},'#fff',12);dot({x:m.x+.012,y:m.y-.018},'#fff',12);}
      dot(action.pose?.leftWrist,'#8fe8ff',16);dot(action.pose?.rightWrist,'#ffa5e1',16);line(action.pose?.leftWrist,action.pose?.rightWrist,'rgba(255,255,255,.3)',1);
    }
    label(`${action.kind} · ${action.status==='ACTIVE'?`${(action.remainingMs/1000).toFixed(1)}s`:action.status==='RECOVERING'?`READY ${(action.recoveryRemaining/1000).toFixed(1)}`:action.status}`,action.kind==='LAVA'?'#ffbd80':'#f9ef78');
  }
}
