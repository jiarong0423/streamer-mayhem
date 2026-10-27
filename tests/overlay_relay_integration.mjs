// Loopback-only relay contract test; never logs session payloads.
import http from 'node:http';
import assert from 'node:assert/strict';
import {createOverlayRelay} from '../scripts/overlay-relay.mjs';
import {createCameraGeometry} from '../dist/camera_geometry.mjs';
import {makeOverlayState,OVERLAY_STATE_TYPE,OVERLAY_CLOSED_TYPE} from '../dist/overlay_protocol.mjs';
const relay=createOverlayRelay();const server=http.createServer((req,res)=>{if(!relay.handle(req,res)){res.writeHead(404);res.end();}});
const wait=ms=>new Promise(r=>setTimeout(r,ms));const timeout=setTimeout(()=>{console.error('FAIL relay test timeout');process.exit(1);},15000);
let reader;
try {
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`,id='a'.repeat(32);
  const g=createCameraGeometry({canvasWidth:1280,canvasHeight:720,viewport:{x:0,y:0,width:1280,height:720},sourceWidth:1280,sourceHeight:720});
  const state=makeOverlayState({session:id,sequence:1,geometry:g,snapshot:{mode:'PLAYING',attacks:[{cell:5,cells:[2,4,5,6,8]}]},sourcePoint:{x:.5,y:.5,visibility:1}});
  const post=(body,source=origin)=>fetch(origin+'/__overlay/state',{method:'POST',headers:{Origin:source,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post(state,'http://example.invalid')).status,403);
  assert.equal((await post({...state,scene:{...state.scene,viewport:{x:1,y:0,width:1,height:1}}})).status,400);
  for(const type of ['synthetic-state','synthetic-state-v1','synthetic-state-v3','synthetic-closed','synthetic-closed-v1','synthetic-closed-v3']){
    assert.equal((await post({...state,type,sequence:999999})).status,400);
  }
  const controller=new AbortController();const stream=await fetch(`${origin}/__overlay/events?session=${id}`,{signal:controller.signal});assert.equal(stream.status,200);reader=stream.body.getReader();
  assert.equal((await post({...state,extra:'private-field-should-not-pass'})).status,204);
  let text='';for(let i=0;i<30&&!text.includes(OVERLAY_STATE_TYPE);i++){const chunk=await reader.read();if(chunk.done)break;text+=new TextDecoder().decode(chunk.value);}
  assert.ok(text.includes(OVERLAY_STATE_TYPE));assert.equal(text.includes('private-field-should-not-pass'),false);
  const delivered=JSON.parse(text.split('\n').find(line=>line.startsWith('data: {')).slice(6));
  assert.equal(delivered.type,OVERLAY_STATE_TYPE);
  assert.deepEqual(delivered.snapshot.attacks,[{cell:5,cells:[2,4,5,6,8]}]);
  assert.equal((await post(state)).status,409);
  assert.equal((await post({type:OVERLAY_CLOSED_TYPE,session:id,sequence:2,extra:'private-field-should-not-pass'})).status,204);
  text='';for(let i=0;i<30&&!text.includes(OVERLAY_CLOSED_TYPE);i++){const chunk=await reader.read();if(chunk.done)break;text+=new TextDecoder().decode(chunk.value);}
  assert.ok(text.includes(OVERLAY_CLOSED_TYPE));assert.equal(text.includes('private-field-should-not-pass'),false);controller.abort();
  let last=0;for(let n=3;n<35;n++){last=(await post({...state,sequence:n})).status;if(last===429)break;await wait(1);}assert.equal(last,429);
  const second=await fetch(`${origin}/__overlay/events?session=${id}`);const secondReader=second.body.getReader();relay.close();let ended=false;for(let i=0;i<10;i++){const part=await secondReader.read();if(part.done){ended=true;break;}}assert.equal(ended,true);
  console.log('PASS loopback relay origin guard, invalid configuration, allowlisted payload, stale sequence, stop, rate limit, and active-stream shutdown');
} catch(error){console.error('FAIL',error.message);process.exitCode=1;}finally{clearTimeout(timeout);try{await reader?.cancel();}catch{}relay.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
