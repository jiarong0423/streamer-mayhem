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
  constructor({width=64,height=36,threshold=24,globalLimit=.7}={}) {
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||!(threshold>0&&threshold<256)||!(globalLimit>0&&globalLimit<=1))throw new RangeError('INVALID_PROBE');
    Object.assign(this,{width,height,threshold,globalLimit});this.reset();
  }
  reset(){this.prev=null;this.changed=null;this.globalChange=0;}
  // `gray` is width*height luminance bytes. The first frame only seeds the comparison.
  push(gray){
    if(!gray||gray.length!==this.width*this.height)return false;
    if(this.prev){
      const n=gray.length,changed=new Uint8Array(n);let count=0;
      for(let i=0;i<n;i++){if(Math.abs(gray[i]-this.prev[i])>=this.threshold){changed[i]=1;count++;}}
      this.changed=changed;this.globalChange=count/n;
    }
    this.prev=Uint8Array.from(gray);return true;
  }
  // Fraction (0..1) of pixels inside the circle (cx,cy,r in normalized 0..1, r in units of the width) that changed.
  // A change over most of the frame is lighting or camera shake, not a hand, and reads as 0.
  level({x,y,r}){
    if(!this.changed||![x,y,r].every(finite)||!(r>0)||this.globalChange>this.globalLimit)return 0;
    const w=this.width,h=this.height,cx=x*w,cy=y*h,rad=r*w;
    let inside=0,hit=0;
    for(let py=Math.max(0,Math.floor(cy-rad));py<=Math.min(h-1,Math.ceil(cy+rad));py++){
      for(let px=Math.max(0,Math.floor(cx-rad));px<=Math.min(w-1,Math.ceil(cx+rad));px++){
        const dx=px+.5-cx,dy=py+.5-cy;
        if(dx*dx+dy*dy>rad*rad)continue;
        inside++;if(this.changed[py*w+px])hit++;
      }
    }
    return inside?hit/inside:0;
  }
}
