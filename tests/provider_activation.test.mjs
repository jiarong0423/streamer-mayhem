import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderActivation} from '../dist/provider_activation.mjs';

function fixture(mode='local',complete=async()=>{}) {
  const events=[];let opened=0;const popup={closed:false,postMessage(){},close(){this.closed=true;}};
  const provider={mode,starts:0,stops:0,oauth:{begin(){return 'http://127.0.0.1:8091/oauth2/authorize';},complete,clear(){}},start(){this.starts++;return true;},stop(){this.stops++;}};
  const activation=new ProviderActivation({provider,origin:'http://127.0.0.1:4173',openWindow(){opened++;return popup;},onState:state=>events.push(state)});
  const event={origin:'http://127.0.0.1:4173',source:popup,data:{type:'streamer-mayhem-local-oauth',fragment:'#test',query:''}};
  return {provider,activation,events,popup,event,opened:()=>opened};
}
test('default idle and live lock do not open a popup or subscribe',()=>{
  const f=fixture('live');assert.equal(f.opened(),0);assert.equal(f.activation.start(),false);
  assert.equal(f.opened(),0);assert.equal(f.provider.starts,0);assert.deepEqual(f.events,['LIVE_LOCKED']);f.activation.stop();
});
test('local activation subscribes only after validated callback and stops',async()=>{
  const f=fixture();assert.equal(f.activation.start(),true);assert.equal(f.provider.starts,0);assert.equal(f.activation.start(),false);
  assert.equal(await f.activation.handleMessage(f.event),true);assert.equal(f.provider.starts,1);
  assert.deepEqual(f.events,['PENDING','VALIDATING','AUTHORIZED']);f.activation.stop();assert.equal(f.provider.stops,1);
});
test('denial and cancel prevent subscription, including late validation',async()=>{
  const denied=fixture('local',async()=>{throw new Error('AUTH_DENIED');});denied.activation.start();assert.equal(await denied.activation.handleMessage(denied.event),false);assert.equal(denied.provider.starts,0);assert.equal(denied.events.at(-1),'DENIED');denied.activation.stop();
  let resolve;const f=fixture('local',()=>new Promise(r=>{resolve=r;}));f.activation.start();const pending=f.activation.handleMessage(f.event);f.activation.stop();resolve();assert.equal(await pending,false);assert.equal(f.provider.starts,0);
});
test('blocked popup and failed provider start leave activation inactive',async()=>{
  const f=fixture();f.provider.start=()=>{throw new Error('failure');};f.activation.start();await f.activation.handleMessage(f.event);assert.equal(f.activation.active,false);assert.equal(f.events.at(-1),'FAILED');f.activation.stop();
});
