// Frame-difference motion probe: how much of a small region changed between two consecutive low-resolution frames.
// It is how a hand swatting at the mosquito (or slapping the face) is noticed without a hand model. Pure functions plus a small stateful class; no DOM.
const finite=Number.isFinite;

// RGBA bytes (from canvas getImageData) -> one luminance byte per pixel.
export function grayFromRgba(rgba,width,height){
  if(!rgba||!(width>0)||!(height>0)||rgba.length<width*height*4)return null;
  const out=new Uint8Array(width*height);
  for(let i=0,p=0;i<out.length;i++,p+=4)out[i]=(rgba[p]*77+rgba[p+1]*150+rgba[p+2]*29)>>8;
  return out;
}

export class MotionProbe {
  constructor({width=64,height=36,threshold=24,globalLimit=.45,ringWeight=.7}={}) {
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||!(threshold>0&&threshold<256)||!(globalLimit>0&&globalLimit<=1))throw new RangeError('INVALID_PROBE');
    if(!(ringWeight>=0&&ringWeight<=1.5))throw new RangeError('INVALID_PROBE');
    Object.assign(this,{width,height,threshold,globalLimit,ringWeight});this.reset();
  }
  reset(){this.prev=null;this.changed=null;this.globalChange=0;}
  // `gray` is width*height luminance bytes. The first frame only seeds the comparison.
  // The average brightness change of the whole frame (auto-exposure, a light turning on, a hand shadow over the lens) is subtracted before comparing,
  // so only change that differs from it counts as motion.
  push(gray){
    if(!gray||gray.length!==this.width*this.height)return false;
    if(this.prev){
      const n=gray.length,hist=new Int32Array(511);let sum=0;
      for(let i=0;i<n;i++){const d=gray[i]-this.prev[i];sum+=d;hist[d+255]++;}
      // The shift is the most common difference (a window of +-6 levels), not the mean: a big hand over the lens pulls the mean and would make the
      // whole background look changed. Ties go to the value nearest the mean.
      const mean=sum/n;let best=Math.round(mean),bestCount=-1,win=0;
      for(let k=0;k<=12&&k<511;k++)win+=hist[k];
      for(let c=-255;c<=255;c++){
        const lo=c-6+255,hi=c+6+255;
        if(c>-255){if(lo-1>=0)win-=hist[lo-1];if(hi<=510)win+=hist[hi];}
        if(win>bestCount||(win===bestCount&&Math.abs(c-mean)<Math.abs(best-mean))){bestCount=win;best=c;}
      }
      const shift=best,changed=new Uint8Array(n);let count=0;
      for(let i=0;i<n;i++){if(Math.abs(gray[i]-this.prev[i]-shift)>=this.threshold){changed[i]=1;count++;}}
      this.changed=changed;this.globalChange=count/n;
    }
    this.prev=Uint8Array.from(gray);return true;
  }
  #fraction(cx,cy,rIn,rOut){
    const w=this.width,h=this.height;let inside=0,hit=0;
    for(let py=Math.max(0,Math.floor(cy-rOut));py<=Math.min(h-1,Math.ceil(cy+rOut));py++){
      for(let px=Math.max(0,Math.floor(cx-rOut));px<=Math.min(w-1,Math.ceil(cx+rOut));px++){
        const dx=px+.5-cx,dy=py+.5-cy,d2=dx*dx+dy*dy;
        if(d2>rOut*rOut||d2<rIn*rIn)continue;
        inside++;if(this.changed[py*w+px])hit++;
      }
    }
    return inside?hit/inside:0;
  }
  // Motion in the circle (x,y,r in normalized 0..1, r in units of the width) minus 0.7 of the motion in the ring just around it.
  // Something moving over the whole neighbourhood (a person walking behind, camera noise, the head turning) is in both, a hand swatting at the
  // spot is mostly inside the circle. A change over most of the frame (even after the brightness compensation) is shake, not a hand, and reads as 0.
  level({x,y,r}){
    if(!this.changed||![x,y,r].every(finite)||!(r>0)||this.globalChange>this.globalLimit)return 0;
    const cx=x*this.width,cy=y*this.height,rad=r*this.width;
    const inner=this.#fraction(cx,cy,0,rad),ring=this.#fraction(cx,cy,rad,rad*1.7);
    return Math.max(0,inner-this.ringWeight*ring);
  }
}
