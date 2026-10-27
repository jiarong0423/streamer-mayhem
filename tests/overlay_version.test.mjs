import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCameraGeometry} from '../dist/camera_geometry.mjs';
import {makeOverlayState,readOverlayState,OVERLAY_STATE_TYPE,OVERLAY_CLOSED_TYPE} from '../dist/overlay_protocol.mjs';
import {readOverlayState as v2Reader} from './fixtures/overlay_protocol_v2.mjs';
import {readOverlayState as preCrossReader} from './fixtures/overlay_protocol_v1.mjs';
import {readOverlayState as crossV1Reader} from './fixtures/overlay_protocol_cross_v1.mjs';

const session='b'.repeat(32),geometry=createCameraGeometry({canvasWidth:1280,canvasHeight:720,
  viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
const state=()=>makeOverlayState({session,sequence:1,geometry,
  snapshot:{mode:'PLAYING',attacks:[{cell:5,cells:[2,4,5,6,8]}]},sourcePoint:{x:1/6,y:1/6,visibility:1}});

test('v3 uses new state and close wire identities, preserving the five-cell roundtrip',()=>{
  assert.equal(OVERLAY_STATE_TYPE,'synthetic-state-v3');assert.equal(OVERLAY_CLOSED_TYPE,'synthetic-closed-v3');
  const message=state();assert.equal(message.type,OVERLAY_STATE_TYPE);
  for(const [width,height] of [[1280,720],[1920,1080]]){
    const decoded=readOverlayState(message,session,width,height);
    assert.deepEqual(decoded.snapshot.attacks,[{cell:5,cells:[2,4,5,6,8]}]);
    assert.deepEqual(makeOverlayState({session,...decoded}).snapshot.attacks,message.snapshot.attacks);
  }
});

test('v3 rejects both v1 payload variants even if an extra version field claims v2',()=>{
  for(const attacks of [[{cell:5}],[{cell:5,cells:[2,4,5,6,8]}]]){
    const legacy={...state(),type:'synthetic-state',snapshot:{mode:'PLAYING',attacks}};
    assert.throws(()=>readOverlayState(legacy,session,1280,720),/INVALID_OVERLAY_STATE/);
    assert.throws(()=>readOverlayState({...legacy,version:2},session,1280,720),/INVALID_OVERLAY_STATE/);
  }
});

test('both actual historical readers reject v3 instead of silently reducing Cross to center',()=>{
  const message=state(),legacy={...message,type:'synthetic-state'};
  // Positive controls prove the fixtures still implement their historical behavior.
  assert.deepEqual(preCrossReader(legacy,session,1280,720).snapshot.attacks,[{cell:5}]);
  assert.deepEqual(crossV1Reader(legacy,session,1280,720).snapshot.attacks,[{cell:5,cells:[2,4,5,6,8]}]);
  assert.equal(v2Reader({...message,type:'synthetic-state-v2'},session,1280,720).sequence,1);
  for(const reader of [preCrossReader,crossV1Reader,v2Reader])assert.throws(()=>reader(message,session,1280,720),/INVALID_OVERLAY_STATE/);
});

test('unknown wire identities fail closed without compatibility fallback',()=>{
  for(const type of ['synthetic-state-v2',undefined,null,2,'synthetic-state-v1','synthetic-state-v4','synthetic-state-v2-extra','synthetic-closed',OVERLAY_CLOSED_TYPE]){
    assert.throws(()=>readOverlayState({...state(),type},session,1280,720),/INVALID_OVERLAY_STATE/);
  }
  const good=state();assert.equal(readOverlayState(good,session,1280,720).sequence,1);
});

test('historical fixtures retain the exact source bytes except documented import normalization',async()=>{
  for(const [path,expected] of [
    ['./fixtures/overlay_protocol_v1.mjs','eb477d03d7f60cbb6801b31a81ae2046b18b03d388e406975f3082f393a9d857'],
    ['./fixtures/overlay_protocol_cross_v1.mjs','302c5ff9b768e66e33120437aedb5693636ffe92cccc308198f05d51daf9d9a4']]){
    const fixture=await readFile(new URL(path,import.meta.url),'utf8');
    const original=fixture.split('\n').slice(2).join('\n').replace("'../../dist/camera_geometry.mjs'","'./camera_geometry.mjs'").replace("'../../dist/matrix.mjs'","'./matrix.mjs'");
    assert.equal(createHash('sha256').update(original).digest('hex'),expected);
  }
});
