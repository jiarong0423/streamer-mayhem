import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraGeometry,projectCameraPoint,projectCameraFrame,canvasPointToSource,visiblePointToCanvas} from '../dist/camera_geometry.mjs';
import {gridCell,MatrixGame} from '../dist/matrix.mjs';
import {gridRects,drawCameraOverlay} from '../dist/matrix_view.mjs';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const make=(change={})=>createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:64,y:360,width:320,height:240},sourceWidth:1280,sourceHeight:720,...change});
test('contain and cover calculate the actual visible image, excluding letterbox and cropped parts',()=>{
  const contain=make();assert.deepEqual(contain.visible,{x:64,y:390,width:320,height:180});
  const cover=make({fit:'cover'});assert.deepEqual(cover.visible,{x:64,y:360,width:320,height:240});
  assert.equal(projectCameraPoint({x:0,y:.5,visibility:1},cover),null);
  assert.equal(canvasPointToSource({x:65,y:365},contain),null);
});
test('matrix grid centers round-trip through crop, contain, cover, mirror and rotation',()=>{
  let cases=0;
  for(const factor of [1,1.5])for(const dimensions of [[1280,720],[640,480]])for(const fit of ['contain','cover'])for(const mirror of [false,true])for(const rotation of [0,90,180,270])for(const crop of [{left:0,top:0,right:0,bottom:0},{left:.1,top:.15,right:.2,bottom:.05}]){
    const geometry=make({canvasWidth:1280*factor,canvasHeight:720*factor,viewport:{x:64*factor,y:360*factor,width:320*factor,height:240*factor},sourceWidth:dimensions[0],sourceHeight:dimensions[1],fit,mirror,rotation,crop});
    const cells=gridRects(geometry.visible);
    for(let i=0;i<9;i++){
      const point={x:cells[i].x+cells[i].width/2,y:cells[i].y+cells[i].height/2};
      const source=canvasPointToSource(point,geometry);assert.ok(source);
      const mapped=projectCameraPoint({...source,visibility:1},geometry);assert.equal(gridCell(mapped),i+1);
      const screen=visiblePointToCanvas(mapped,geometry);close(screen.x,point.x);close(screen.y,point.y);cases++;
    }
  }
  assert.equal(cases,1152);
});
test('corners and boundaries map to the same cells that the viewer sees',()=>{
  for(const mirror of [false,true]){
    const g=make({mirror,fit:'cover'});for(const [x,y,cell] of [[0,0,1],[1,0,3],[0,1,7],[1,1,9],[.5,.5,5]]){
      const p=visiblePointToCanvas({x,y},g),source=canvasPointToSource(p,g),mapped=projectCameraPoint({...source,visibility:1},g);
      close(mapped.x,x);close(mapped.y,y);assert.equal(gridCell(mapped),cell);
    }
    const left=projectCameraPoint({x:.25,y:.5,visibility:1},make({mirror,viewport:{x:0,y:0,width:1280,height:720}}));assert.equal(gridCell(left),mirror?6:4);
  }
});
test('invalid geometry and out-of-frame points fail closed',()=>{
  for(const patch of [{viewport:{x:-1,y:0,width:10,height:10}},{viewport:{x:0,y:0,width:0,height:10}},{viewport:{x:1200,y:0,width:100,height:10}},{crop:{left:.6,right:.4,top:0,bottom:0}},{fit:'stretch'},{mirror:'yes'},{rotation:45}])assert.throws(()=>make(patch));
  const g=make({crop:{left:.1,right:.2,top:.1,bottom:.1}});
  for(const p of [null,{x:NaN,y:0,visibility:1},{x:.05,y:.5,visibility:1},{x:2,y:.5,visibility:1},{x:.5,y:.5}])assert.equal(projectCameraPoint(p,g),null);
  assert.equal(canvasPointToSource({x:0,y:0},g),null);
});
test('calibration change cancels pending attacks as unknown and removes old tracking',()=>{
  let now=0;const game=new MatrixGame({clock:()=>now});game.setConnection(true);game.start();const g=make();
  const frame=(id,time,p)=>projectCameraFrame({frameId:id,captureTime:time,nose:p,leftShoulder:p,rightShoulder:p},g);
  const p={x:.5,y:.5,visibility:1};game.addFrame(frame('old',0,p));game.tick();
  assert.equal(game.receiveChat({notificationId:'n',messageId:'m',actorId:'a',text:'!throw 5',receivedAt:0}).accepted,true);
  now=100;game.invalidateTracking();assert.equal(game.mode,'TRACKING_LOST');assert.equal(game.latestFrame,null);assert.equal(game.attacks.length,0);
  assert.equal(game.results[0].outcome,'UNKNOWN');assert.equal(game.results[0].reason,'CALIBRATION_CHANGED');assert.equal(game.hp,100);assert.equal(game.score,0);
  assert.equal(game.addFrame(frame('delayed-before-change',50,p)),false);assert.equal(game.addFrame(frame('same-time-change',100,p)),false);
  now=150;game.addFrame(frame('lost',150,null));game.tick();assert.equal(game.mode,'TRACKING_LOST');assert.equal(game.hp,100);assert.equal(game.score,0);
  now=200;game.addFrame(frame('new',200,p));game.tick();assert.equal(game.mode,'RECOVERING');
});
test('overlay drawing is clipped to visible camera region',()=>{
  const calls=[],ctx={canvas:{width:1280,height:720},save(){},restore(){},clearRect(...v){calls.push(['clear',...v]);},beginPath(){},rect(...v){calls.push(['rect',...v]);},clip(){calls.push(['clip']);},strokeRect(){},fillText(){},roundRect(){},fill(){},stroke(){},fillRect(...v){calls.push(['fill',...v]);}};
  const g=make();const out=drawCameraOverlay(ctx,g,{mode:'TRACKING_LOST',attacks:[{cell:9}]});assert.deepEqual(calls[1],['rect',g.visible.x,g.visible.y,g.visible.width,g.visible.height]);assert.equal(out.cells.length,9);assert.ok(calls.some(c=>c[0]==='clip'));
  assert.deepEqual(drawCameraOverlay(ctx,null,{attacks:[]}),{rect:null,cells:[]});
});

test('cropped or low-confidence nose at impact is unknown without score or damage',()=>{
  for(const point of [{x:0,y:.5,visibility:1},{x:.5,y:.5,visibility:.1},null]){
    let now=0;const game=new MatrixGame({clock:()=>now}),g=make({fit:'cover'});const p={x:.5,y:.5,visibility:1};
    const frame=(id,time,nose)=>projectCameraFrame({frameId:id,captureTime:time,nose,leftShoulder:p,rightShoulder:p},g);
    game.setConnection(true);game.start();game.addFrame(frame('initial',0,p));game.tick();
    game.receiveChat({notificationId:'n',messageId:'m',actorId:'a',text:'!throw 5',receivedAt:0});
    now=250;assert.equal(game.addFrame(frame('continuity',now,p)),true);game.tick();
    now=500;assert.equal(game.addFrame(frame('impact',now,point)),true);game.tick();
    assert.equal(game.results[0].outcome,'UNKNOWN');assert.equal(game.results[0].sampledFrameId,'impact');assert.equal(game.hp,100);assert.equal(game.score,0);assert.equal(game.mode,'TRACKING_LOST');
  }
});

test('CENTER-01 centerCrop makes a face-centred window about 5 face widths wide with the aspect kept',async()=>{
  const {centerCrop,createCameraGeometry,projectCameraPoint}=await import('../dist/camera_geometry.mjs');
  const crop=centerCrop({cx:.5,cy:.6,fw:.166});
  const size=1-crop.left-crop.right;
  assert.ok(Math.abs(size-.83)<.001);assert.ok(Math.abs((1-crop.top-crop.bottom)-size)<1e-9);
  assert.ok(Math.abs(crop.left+size/2-.5)<1e-9);assert.ok(Math.abs(crop.top+size*.55-.6)<1e-9);
  const g=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720,crop});
  const centre=projectCameraPoint({x:.5,y:.6,visibility:1},g);
  assert.ok(Math.abs(centre.x-.5)<1e-9&&Math.abs(centre.y-.55)<1e-9);
  // One face width to the side moves the point by 1/5 of the visible width, i.e. a bit over half of a grid column (a column is 1/3).
  const side=projectCameraPoint({x:.5+.166,y:.6,visibility:1},g);
  assert.ok(Math.abs(side.x-(.5+1/5))<1e-9);
});
test('CENTER-02 centerCrop clamps at the frame edges, enforces a minimum window and rejects bad faces',async()=>{
  const {centerCrop}=await import('../dist/camera_geometry.mjs');
  const edge=centerCrop({cx:.05,cy:.95,fw:.2});
  for(const side of ['left','right','top','bottom'])assert.ok(edge[side]>=0&&edge[side]<1);
  assert.ok(edge.left===0&&edge.bottom===0);
  const tiny=centerCrop({cx:.5,cy:.5,fw:.01});assert.ok(Math.abs((1-tiny.left-tiny.right)-.3)<1e-9);
  const huge=centerCrop({cx:.5,cy:.5,fw:.9});assert.deepEqual(huge,{left:0,right:0,top:0,bottom:0});
  for(const face of [null,undefined,{cx:.5,cy:.5,fw:0},{cx:NaN,cy:.5,fw:.2},{cx:.5,cy:.5,fw:-1}])assert.equal(centerCrop(face),null);
});
