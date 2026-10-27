import test from 'node:test';
import assert from 'node:assert/strict';
import {AuthPopupController} from '../dist/auth_popup_controller.mjs';

function fixture({blocked=false}={}) {
  const states=[],popups=[],timers=new Map(),calls={begin:0,clear:0,success:0,complete:0};let serial=0,resolveValidation,rejectValidation;
  const oauth={begin(){calls.begin++;return 'http://127.0.0.1:8091/oauth2/authorize';},clear(){calls.clear++;},
    complete(){calls.complete++;return new Promise((resolve,reject)=>{resolveValidation=resolve;rejectValidation=reject;});}};
  const controller=new AuthPopupController({oauth,origin:'http://127.0.0.1:4173',
    openWindow:()=>{if(blocked)return null;const popup={closed:false,messages:[],close(){this.closed=true;},postMessage(data,origin){this.messages.push({data,origin});}};popups.push(popup);return popup;},
    onState:state=>states.push(state),onSuccess:()=>calls.success++,setIntervalImpl:fn=>{const id=++serial;timers.set(id,fn);return id;},clearIntervalImpl:id=>timers.delete(id)});
  const tick=()=>{for(const fn of [...timers.values()])fn();};
  const message=(popup=popups.at(-1),origin='http://127.0.0.1:4173')=>({origin,source:popup,data:{type:'streamer-mayhem-local-oauth',fragment:'#synthetic'}});
  return {controller,states,popups,timers,calls,tick,message,resolve:()=>resolveValidation(),reject:message=>rejectValidation(new Error(message))};
}

test('manual close resets once and rejects delayed callback',async()=>{
  const f=fixture();f.controller.start();const popup=f.popups[0];popup.closed=true;f.tick();f.tick();
  assert.deepEqual(f.states,['PENDING','CLOSED']);assert.equal(f.controller.pending,false);assert.equal(f.timers.size,0);
  assert.equal(await f.controller.handleMessage(f.message(popup)),false);assert.equal(f.calls.complete,0);assert.equal(f.calls.clear,1);
});
test('closed popup callback is rejected even if the poll has not run',async()=>{
  const f=fixture();f.controller.start();const popup=f.popups[0];popup.closed=true;
  assert.equal(await f.controller.handleMessage(f.message(popup)),false);assert.equal(f.calls.complete,0);assert.equal(f.states.at(-1),'CLOSED');
});
test('explicit cancel closes window, clears state and rejects stale callback after restart',async()=>{
  const f=fixture();f.controller.start();const old=f.popups[0];assert.equal(f.controller.cancel(),true);assert.equal(old.closed,true);
  assert.equal(f.controller.start(),true);assert.equal(await f.controller.handleMessage(f.message(old)),false);assert.equal(f.controller.pending,true);f.controller.cancel();
});
test('callback wins when received first, acknowledges before close and survives close polling',async()=>{
  const f=fixture();f.controller.start();const popup=f.popups[0],pending=f.controller.handleMessage(f.message());
  assert.equal(f.controller.phase,'VALIDATING');assert.equal(f.timers.size,0);assert.equal(popup.messages[0].data.type,'streamer-mayhem-local-oauth-ack');
  popup.closed=true;f.tick();f.resolve();assert.equal(await pending,true);assert.equal(f.calls.success,1);assert.deepEqual(f.states,['PENDING','VALIDATING','SUCCESS']);
});
test('cancel during validation overrides late success and a newer attempt remains pending',async()=>{
  const f=fixture();f.controller.start();const pending=f.controller.handleMessage(f.message());f.controller.cancel();f.controller.start();f.resolve();
  assert.equal(await pending,false);assert.equal(f.calls.success,0);assert.equal(f.controller.pending,true);assert.equal(f.controller.phase,'WAITING');f.controller.dispose();assert.equal(f.timers.size,0);
});
test('denied callback and forged origin/source fail closed',async()=>{
  const f=fixture();f.controller.start();const popup=f.popups[0];assert.equal(await f.controller.handleMessage(f.message(popup,'https://example.test')),false);
  assert.equal(await f.controller.handleMessage(f.message({},'http://127.0.0.1:4173')),false);assert.equal(f.calls.complete,0);
  const pending=f.controller.handleMessage(f.message());f.reject('AUTH_DENIED');assert.equal(await pending,false);
  assert.equal(f.states.at(-1),'DENIED');assert.equal(f.calls.success,0);assert.equal(f.timers.size,0);
});
test('popup block and dispose are inactive and do not create a timer',()=>{
  const f=fixture({blocked:true});assert.equal(f.controller.start(),false);assert.deepEqual(f.states,['BLOCKED']);
  assert.equal(f.timers.size,0);f.controller.dispose();assert.equal(f.calls.success,0);
});
test('browser timers are invoked without an invalid receiver',()=>{
  const oauth={begin:()=>'/local',complete:async()=>{},clear:()=>{}},popup={closed:false,close(){this.closed=true;}};
  const controller=new AuthPopupController({oauth,origin:'http://127.0.0.1:4173',openWindow:()=>popup,
    setIntervalImpl:function(){assert.equal(this,undefined);return 1;},clearIntervalImpl:function(){assert.equal(this,undefined);}});
  controller.start();controller.cancel();assert.equal(popup.closed,true);
});
test('popup passes query-based denial to OAuth and reports denied',async()=>{
  let argumentsSeen;const states=[];const popup={closed:false,postMessage(){},close(){}};
  const oauth={begin:()=>'/local',clear(){},async complete(fragment,query){argumentsSeen=[fragment,query];throw new Error('AUTH_DENIED');}};
  const controller=new AuthPopupController({oauth,origin:'http://127.0.0.1:4173',openWindow:()=>popup,onState:state=>states.push(state)});
  controller.start();assert.equal(await controller.handleMessage({origin:'http://127.0.0.1:4173',source:popup,data:{type:'streamer-mayhem-local-oauth',fragment:'',query:'?error=access_denied&state=test'}}),false);
  assert.deepEqual(argumentsSeen,['','?error=access_denied&state=test']);assert.equal(states.at(-1),'DENIED');
});
