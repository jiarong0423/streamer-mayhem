// Burst effect for a catch: sparkle particles flying out and a ring pulse, drawn from three CC0 sprites (Kenney Particle Pack, see
// vendor/kenney-particles/NOTICE.md). Pure state plus a draw function; sprites are optional so the effect degrades to plain glowing dots.
export const FX_SPRITES=Object.freeze({sparkle:'./vendor/kenney-particles/star_01.png',ring:'./vendor/kenney-particles/star_02.png',flare:'./vendor/kenney-particles/star_06.png'});
const finite=Number.isFinite;

// Small deterministic generator so bursts look the same for the same seed and tests can assert exact values.
function rng(seed){let x=(seed>>>0)||1;return()=>{x^=x<<13;x>>>=0;x^=x>>>17;x^=x<<5;x>>>=0;return x/4294967296;};}

export class CatchBurst {
  constructor({count=18,life=800,ringLife=500,maxBursts=6}={}) {
    if(!Number.isInteger(count)||count<1||count>64||!(life>0)||!(ringLife>0)||!Number.isInteger(maxBursts)||maxBursts<1)throw new RangeError('INVALID_BURST');
    this.count=count;this.life=life;this.ringLife=ringLife;this.maxBursts=maxBursts;this.bursts=[];this.serial=0;
  }
  // Starts a burst at canvas point (x,y); `size` is a length in px (about the width of a grid column) that scales the particles.
  spawn(x,y,now,size=120) {
    if(![x,y,now,size].every(finite)||size<=0)return false;
    const random=rng(0x9e3779b9^(++this.serial*2654435761)),particles=[];
    for(let i=0;i<this.count;i++){
      const angle=(i/this.count)*Math.PI*2+random()*.6,speed=size*(.9+random()*1.6);
      particles.push({vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-size*.6,spin:(random()-.5)*6,scale:.14+random()*.2,rotation:random()*Math.PI});
    }
    this.bursts.push({x,y,at:now,size,particles});
    while(this.bursts.length>this.maxBursts)this.bursts.shift();
    return true;
  }
  // Drops finished bursts; returns how many are still alive.
  prune(now){this.bursts=this.bursts.filter(b=>now-b.at<Math.max(this.life,this.ringLife));return this.bursts.length;}
  // Particle position at age t (ms): outward with drag, then falling a little.
  static position(burst,particle,age){
    const t=age/1000,drag=1-Math.exp(-3*t),gravity=burst.size*1.4*t*t;
    return {x:burst.x+particle.vx*drag/3,y:burst.y+particle.vy*drag/3+gravity};
  }
  draw(ctx,now,sprites={},clip=null) {
    if(this.prune(now)===0)return;
    ctx.save();
    if(clip){ctx.beginPath();ctx.rect(clip.x,clip.y,clip.width,clip.height);ctx.clip();}
    ctx.globalCompositeOperation='lighter';
    for(const burst of this.bursts){
      const age=now-burst.at;
      if(age<this.ringLife&&sprites.ring){
        const p=age/this.ringLife,r=burst.size*(.35+1.1*p);
        ctx.globalAlpha=Math.max(0,.6*(1-p));ctx.drawImage(sprites.ring,burst.x-r,burst.y-r,r*2,r*2);
      }
      if(age<this.life){
        const p=age/this.life,alpha=.75*Math.max(0,1-p*p);
        for(const particle of burst.particles){
          const pos=CatchBurst.position(burst,particle,age),s=burst.size*particle.scale*(1-.5*p);
          ctx.globalAlpha=alpha;
          if(sprites.sparkle){
            ctx.save();ctx.translate(pos.x,pos.y);ctx.rotate(particle.rotation+particle.spin*p);ctx.drawImage(sprites.sparkle,-s,-s,s*2,s*2);ctx.restore();
          }else{
            ctx.fillStyle='#ffd23f';ctx.beginPath();ctx.arc(pos.x,pos.y,Math.max(1.5,s/6),0,2*Math.PI);ctx.fill();
          }
        }
        if(sprites.flare&&age<160){const f=burst.size*(1.2-age/160*.6);ctx.globalAlpha=.7*(1-age/160);ctx.drawImage(sprites.flare,burst.x-f,burst.y-f,f*2,f*2);}
      }
    }
    ctx.restore();
  }
}

// Gold copy of a white-on-black sprite: multiplying keeps black black and turns white into the colour, and the additive draw above makes black invisible.
// Falls back to the original where no canvas is available.
function tinted(image,color,makeCanvas){
  try{
    const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;if(!(w>0&&h>0))return image;
    const canvas=makeCanvas(w,h),g=canvas.getContext('2d');g.drawImage(image,0,0);g.globalCompositeOperation='multiply';g.fillStyle=color;g.fillRect(0,0,w,h);return canvas;
  }catch{return image;}
}
const defaultCanvas=(w,h)=>{if(typeof OffscreenCanvas==='function')return new OffscreenCanvas(w,h);const c=document.createElement('canvas');c.width=w;c.height=h;return c;};

// Loads the sprites; any that fail are left out so the effect still works. `color` tints them (null keeps white).
export async function loadSprites(urls=FX_SPRITES,makeImage=()=>new Image(),{color='#ffd23f',makeCanvas=defaultCanvas}={}){
  const out={};
  await Promise.all(Object.entries(urls).map(([name,url])=>new Promise(resolve=>{
    const image=makeImage();image.onload=()=>{out[name]=color?tinted(image,color,makeCanvas):image;resolve();};image.onerror=()=>resolve();image.src=url;
  })));
  return out;
}
