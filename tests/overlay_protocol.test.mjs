import test from 'node:test';
import assert from 'node:assert/strict';
import {createCameraGeometry,projectCameraPoint,canvasPointToSource,visiblePointToCanvas} from '../dist/camera_geometry.mjs';
import {makeOverlayState,parseOverlayQuery,readOverlayState} from '../dist/overlay_protocol.mjs';
import {gridCell} from '../dist/matrix.mjs';
const session='a'.repeat(32),snapshot={mode:'PLAYING',attacks:[{cell:5,eventId:'should-not-cross'}]};
const geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:64,y:396,width:320,height:216},sourceWidth:640,sourceHeight:480,fit:'cover',mirror:true,crop:{left:.1,top:.1,right:.1,bottom:.1}});
test('overlay default disabled and opt-in requires an exact synthetic session',()=>{
  assert.equal(parseOverlayQuery(''),null);assert.equal(parseOverlayQuery(`?mode=synthetic&session=${session}`),session);
  for(const q of ['?mode=live',`?mode=synthetic&session=${session}&mode=synthetic`,`?mode=synthetic&session=${session}&other=x`,'?mode=synthetic&session=short','?session='+session])assert.throws(()=>parseOverlayQuery(q));
});
test('only synthetic render fields are emitted, dimensions rescale and mirror preserves the game cell',()=>{
  const point=canvasPointToSource(visiblePointToCanvas({x:1/6,y:.5},geometry),geometry);
  const msg=makeOverlayState({session,sequence:2,geometry,snapshot,sourcePoint:{...point,visibility:1}});
  assert.deepEqual(msg.snapshot.attacks,[{cell:5}]);assert.equal(JSON.stringify(msg).includes('should-not-cross'),false);
  for(const [w,h] of [[1280,720],[1920,1080],[640,360]]){
    const state=readOverlayState(msg,session,w,h),mapped=projectCameraPoint(state.sourcePoint,state.geometry);
    assert.equal(gridCell(mapped),4);assert.equal(state.geometry.mirror,true);assert.equal(state.snapshot.attacks[0].cell,5);
    assert.ok(Math.abs(state.geometry.viewport.x/w-.05)<1e-12);
  }
});
test('invalid or mismatched input is rejected and uncalibrated state is empty',()=>{
  const msg=makeOverlayState({session,sequence:1,geometry,snapshot,sourcePoint:{x:.5,y:.5,visibility:1}});
  for(const invalid of [{...msg,session:'b'.repeat(32)},{...msg,sequence:-1},{...msg,snapshot:{mode:'PLAYING',attacks:[{cell:0}]}},{...msg,scene:{...msg.scene,viewport:{x:.9,y:0,width:.2,height:.2}}},{...msg,sourcePoint:{x:NaN,y:0,visibility:1}}])assert.throws(()=>readOverlayState(invalid,session,1280,720));
  const empty=readOverlayState({...msg,scene:null},session,1280,720);assert.equal(empty.geometry,null);assert.deepEqual(empty.snapshot.attacks,[]);assert.throws(()=>readOverlayState(msg,session,4097,720));
});

test('cross warning survives controller, relay normalization and overlay without private event fields',()=>{
  const cross={cell:5,cells:[2,4,5,6,8],kind:'CROSS',actorId:'private-viewer',eventId:'private-event'};
  const msg=makeOverlayState({session,sequence:3,geometry,snapshot:{mode:'PLAYING',attacks:[cross]},sourcePoint:null});
  const decoded=readOverlayState(msg,session,1920,1080);
  const relayed=makeOverlayState({session,sequence:3,...decoded});
  assert.deepEqual(relayed.snapshot.attacks,[{cell:5,cells:[2,4,5,6,8]}]);
  assert.equal(JSON.stringify(relayed).includes('private-'),false);
  decoded.snapshot.attacks[0].cells[0]=9;assert.equal(msg.snapshot.attacks[0].cells[0],2);
  for(const cells of [[],[2,4,5,6,8,9],[2,4,5,6,6],[1,4,5,6,8],'2,4,5,6,8']){
    assert.throws(()=>readOverlayState({...msg,snapshot:{mode:'PLAYING',attacks:[{cell:5,cells}]}},session,1280,720));
  }
  assert.throws(()=>readOverlayState({...msg,snapshot:{mode:'PLAYING',attacks:[{cell:1,cells:[2,4,5,6,8]}]}},session,1280,720));
  for(const mode of ['PAUSED','TRACKING_LOST','RECOVERING','ROUND_END']){
    const hidden=makeOverlayState({session,sequence:4,geometry,snapshot:{mode,attacks:[cross]},sourcePoint:null});
    assert.deepEqual(readOverlayState(hidden,session,1280,720).snapshot.attacks,[]);
  }
});
