// Camera-to-scene transform. All values are synthetic; no camera or network access.
const finite=Number.isFinite;
const inside=(x,y,r)=>x>=r.x-1e-9&&y>=r.y-1e-9&&x<=r.x+r.width+1e-9&&y<=r.y+r.height+1e-9;
const clamp01=n=>Math.max(0,Math.min(1,n));

export function createCameraGeometry({canvasWidth,canvasHeight,viewport,sourceWidth,sourceHeight,crop={left:0,top:0,right:0,bottom:0},fit='contain',mirror=false,rotation=0}={}) {
  if(![canvasWidth,canvasHeight,sourceWidth,sourceHeight].every(n=>finite(n)&&n>0))throw new RangeError('INVALID_DIMENSIONS');
  if(!viewport || ![viewport.x,viewport.y,viewport.width,viewport.height].every(finite) || viewport.x<0 || viewport.y<0 || viewport.width<=0 || viewport.height<=0 || viewport.x+viewport.width>canvasWidth || viewport.y+viewport.height>canvasHeight)throw new RangeError('INVALID_VIEWPORT');
  if(!crop || ![crop.left,crop.top,crop.right,crop.bottom].every(n=>finite(n)&&n>=0&&n<1) || crop.left+crop.right>=1 || crop.top+crop.bottom>=1)throw new RangeError('INVALID_CROP');
  if(!['contain','cover'].includes(fit) || typeof mirror!=='boolean' || ![0,90,180,270].includes(rotation))throw new RangeError('INVALID_TRANSFORM');
  const sw=sourceWidth*(1-crop.left-crop.right),sh=sourceHeight*(1-crop.top-crop.bottom);
  const rw=rotation%180?sh:sw,rh=rotation%180?sw:sh;
  const scale=(fit==='contain'?Math.min:Math.max)(viewport.width/rw,viewport.height/rh);
  const image={x:viewport.x+(viewport.width-rw*scale)/2,y:viewport.y+(viewport.height-rh*scale)/2,width:rw*scale,height:rh*scale};
  const x=Math.max(viewport.x,image.x),y=Math.max(viewport.y,image.y);
  const visible={x,y,width:Math.min(viewport.x+viewport.width,image.x+image.width)-x,height:Math.min(viewport.y+viewport.height,image.y+image.height)-y};
  if(![image.x,image.y,image.width,image.height,visible.x,visible.y,visible.width,visible.height].every(finite) || visible.width<=0 || visible.height<=0)throw new RangeError('INVALID_GEOMETRY');
  return Object.freeze({canvasWidth,canvasHeight,viewport:Object.freeze({...viewport}),sourceWidth,sourceHeight,crop:Object.freeze({...crop}),fit,mirror,rotation,image:Object.freeze(image),visible:Object.freeze(visible)});
}
function rotate(u,v,r){switch(r){case 90:return [1-v,u];case 180:return [1-u,1-v];case 270:return [v,1-u];default:return [u,v];}}
function unrotate(u,v,r){switch(r){case 90:return [v,1-u];case 180:return [1-u,1-v];case 270:return [1-v,u];default:return [u,v];}}

// Normalized source point -> visible camera coordinates used by both engine and overlay.
export function projectCameraPoint(point,g) {
  if(!g || !point || !finite(point.x) || !finite(point.y) || point.x<0 || point.x>1 || point.y<0 || point.y>1 || !finite(point.visibility))return null;
  const c=g.crop;
  if(point.x<c.left || point.x>1-c.right || point.y<c.top || point.y>1-c.bottom)return null;
  let u=(point.x-c.left)/(1-c.left-c.right),v=(point.y-c.top)/(1-c.top-c.bottom);
  [u,v]=rotate(u,v,g.rotation);if(g.mirror)u=1-u;
  const x=g.image.x+u*g.image.width,y=g.image.y+v*g.image.height;
  if(!inside(x,y,g.visible))return null;
  return {x:clamp01((x-g.visible.x)/g.visible.width),y:clamp01((y-g.visible.y)/g.visible.height),visibility:point.visibility};
}
export function canvasPointToSource(point,g) {
  if(!g || !point || !finite(point.x) || !finite(point.y) || !inside(point.x,point.y,g.visible))return null;
  let u=(point.x-g.image.x)/g.image.width,v=(point.y-g.image.y)/g.image.height;
  if(g.mirror)u=1-u;[u,v]=unrotate(u,v,g.rotation);const c=g.crop;
  return {x:clamp01(c.left+u*(1-c.left-c.right)),y:clamp01(c.top+v*(1-c.top-c.bottom))};
}
export function projectCameraFrame(frame,g) {
  if(!frame || !g)return null;
  const projected={...frame,nose:projectCameraPoint(frame.nose,g),leftShoulder:projectCameraPoint(frame.leftShoulder,g),rightShoulder:projectCameraPoint(frame.rightShoulder,g)};
  for(const joint of ['leftElbow','rightElbow','leftWrist','rightWrist','leftHip','rightHip'])if(Object.hasOwn(frame,joint))projected[joint]=projectCameraPoint(frame[joint],g);
  return projected;
}
export function visiblePointToCanvas(point,g) {
  if(!g || !point || !finite(point.x)||!finite(point.y)||point.x<0||point.x>1||point.y<0||point.y>1)return null;
  return {x:g.visible.x+point.x*g.visible.width,y:g.visible.y+point.y*g.visible.height};
}
