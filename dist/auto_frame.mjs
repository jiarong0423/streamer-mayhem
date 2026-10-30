// Automatic digital zoom: frames the seated streamer without any setup step.
// It applies a face-centred crop once the face has been steady for a few frames, then only re-frames when the face has stayed clearly
// bigger or smaller (the person moved closer or farther) for a while. Leaning sideways or up and down never re-frames, because that is the game.
import {centerCrop,DEFAULT_SPAN} from './camera_geometry.mjs';
const finite=Number.isFinite;

export class AutoFrame {
  // drift: how far (in face widths) the face may sit from where the crop was built before it counts as "moved", never a game lean (the widest lean is about 1.1 face widths).
  // lostMs: if the face is missing at least this long, the next steady face is framed again from scratch.
  constructor({frames=12,low=.7,high=1.4,holdMs=2000,span=DEFAULT_SPAN,drift=2.5,lostMs=1500}={}) {
    if(!Number.isInteger(frames)||frames<1||!(low>0&&low<1)||!(high>1)||!(holdMs>=0)||!(span>0)||!(drift>0)||!(lostMs>=0))throw new RangeError('INVALID_AUTO_FRAME');
    this.frames=frames;this.low=low;this.high=high;this.holdMs=holdMs;this.span=span;this.drift=drift;this.lostMs=lostMs;this.reset();
  }
  reset(){this.streak=0;this.reference=null;this.center=null;this.offSince=null;this.lostSince=null;}
  // Marks the face the current crop was built for (also used after a manual "Center me"): its size and its position.
  // The size reference is the face height when known: turning the head narrows the face but not its height, so a head turn must not look like moving away.
  static size(face){return face&&(face.fh>0?face.fh:face.fw>0?face.fw:null);}
  adopt(face){this.reference=AutoFrame.size(face);this.center=face&&finite(face.cx)&&finite(face.cy)?{cx:face.cx,cy:face.cy}:null;this.streak=0;this.offSince=null;this.lostSince=null;}
  // Call once per fresh camera frame with the latest face ({cx,cy,fw} normalized to the source frame) or null. Returns a crop to apply, or null.
  update(face,now) {
    const usable=face&&[face.cx,face.cy,face.fw].every(finite)&&face.fw>0;
    if(this.reference===null){
      this.streak=usable?this.streak+1:0;
      if(this.streak<this.frames)return null;
      const crop=centerCrop(face,this.span);this.adopt(face);return crop;
    }
    if(!usable){this.offSince=null;if(this.lostSince===null)this.lostSince=now;return null;}
    if(this.lostSince!==null){   // the face is back: after a long absence frame it again once it has been steady for a few frames
      const gap=now-this.lostSince;this.lostSince=null;
      if(gap>=this.lostMs){this.reference=null;this.center=null;this.streak=1;this.offSince=null;return null;}
    }
    const ratio=AutoFrame.size(face)/this.reference;
    const drift=this.center?Math.max(Math.abs(face.cx-this.center.cx)/face.fw,Math.abs(face.cy-this.center.cy)/(face.fh>0?face.fh:face.fw)):0;
    if(ratio>=this.low&&ratio<=this.high&&drift<=this.drift){this.offSince=null;return null;}
    if(this.offSince===null){this.offSince=now;return null;}
    if(now-this.offSince<this.holdMs)return null;
    const crop=centerCrop(face,this.span);this.adopt(face);return crop;
  }
}

// Theme: applying a new crop calls game.invalidateTracking(), which clears every ball on screen (the old coordinates no longer match). So a crop that auto-framing
// wants to apply while a shot is on screen is held and applied as soon as the field is clear. A newer crop replaces an older held one.
export function createCropGate() {
  let held=null;
  return {
    offer(crop){if(crop)held=crop;},
    // `busy` = a shot is on screen. Returns the crop to apply now, or null.
    take(busy){if(busy||!held)return null;const c=held;held=null;return c;},
    get pending(){return held!==null;},
    clear(){held=null;}
  };
}
