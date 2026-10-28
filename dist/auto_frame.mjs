// Automatic digital zoom: frames the seated streamer without any setup step.
// It applies a face-centred crop once the face has been steady for a few frames, then only re-frames when the face has stayed clearly
// bigger or smaller (the person moved closer or farther) for a while. Leaning sideways or up and down never re-frames, because that is the game.
import {centerCrop} from './camera_geometry.mjs';
const finite=Number.isFinite;

export class AutoFrame {
  constructor({frames=12,low=.7,high=1.4,holdMs=2000,span=6}={}) {
    if(!Number.isInteger(frames)||frames<1||!(low>0&&low<1)||!(high>1)||!(holdMs>=0)||!(span>0))throw new RangeError('INVALID_AUTO_FRAME');
    this.frames=frames;this.low=low;this.high=high;this.holdMs=holdMs;this.span=span;this.reset();
  }
  reset(){this.streak=0;this.reference=null;this.offSince=null;}
  // Marks the face width the current crop was built for (also used after a manual "Center me").
  adopt(face){this.reference=face&&face.fw>0?face.fw:null;this.streak=0;this.offSince=null;}
  // Call once per fresh camera frame with the latest face ({cx,cy,fw} normalized to the source frame) or null. Returns a crop to apply, or null.
  update(face,now) {
    const usable=face&&[face.cx,face.cy,face.fw].every(finite)&&face.fw>0;
    if(this.reference===null){
      this.streak=usable?this.streak+1:0;
      if(this.streak<this.frames)return null;
      const crop=centerCrop(face,this.span);this.adopt(face);return crop;
    }
    if(!usable){this.offSince=null;return null;}
    const ratio=face.fw/this.reference;
    if(ratio>=this.low&&ratio<=this.high){this.offSince=null;return null;}
    if(this.offSince===null){this.offSince=now;return null;}
    if(now-this.offSince<this.holdMs)return null;
    const crop=centerCrop(face,this.span);this.adopt(face);return crop;
  }
}
