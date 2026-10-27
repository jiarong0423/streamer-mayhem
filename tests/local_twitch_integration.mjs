// Synthetic-only end-to-end OAuth + channel.chat.message tests.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {MockOAuth} from '../dist/mock_oauth.mjs';
import {MockEventSubTransport} from '../dist/mock_eventsub_transport.mjs';
import {EventSubAdapter} from '../dist/eventsub_adapter.mjs';
import {MatrixGame} from '../dist/matrix.mjs';
import {TwitchProvider,LOCAL_CONFIG} from '../dist/twitch_provider.mjs';
import {ProviderActivation} from '../dist/provider_activation.mjs';

const binary=process.env.SIMULATOR_BIN;if(!binary)throw new Error('SIMULATOR_BIN required');
const child=spawn(binary,[],{stdio:['ignore','pipe','pipe']});let closed=false;child.on('close',()=>{closed=true;});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(fn,label)=>{for(let i=0;i<200;i++){if(await fn())return;await sleep(25);}throw new Error(`timeout: ${label}`);};
const request=async (path,body)=>{const r=await fetch(`http://127.0.0.1:8091/__mock/control`,{method:body?'POST':'GET',headers:{'X-Mock-Control':'synthetic-only',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.ok,true);return r.json();};
const authorize=async(oauth,decision='allow')=>{const url=new URL(oauth.begin());url.searchParams.set('decision',decision);const res=await fetch(url,{redirect:'manual'});assert.equal(res.status,302);const callback=new URL(res.headers.get('location'));return callback.hash || callback.search;};
let transport;const timer=setTimeout(()=>{console.error('FAIL overall timeout');transport?.stop();child.kill('SIGINT');process.exitCode=1;},25000);
try {
  await until(async()=>{try{await fetch('http://127.0.0.1:8091/oauth2/validate');return true;}catch{return false;}},'simulator');
  const denied=new MockOAuth();await assert.rejects(denied.complete('',await authorize(denied,'deny')),{message:'AUTH_DENIED'});
  const wrong=new MockOAuth();const validFragment=await authorize(wrong);const bad=new URLSearchParams(validFragment.slice(1));bad.set('state','0'.repeat(64));await assert.rejects(wrong.complete(bad.toString()),{message:'INVALID_STATE'});await assert.rejects(wrong.complete(validFragment),{message:'INVALID_STATE'});
  const forged=new MockOAuth();const forgedUrl=new URL(forged.begin());await assert.rejects(forged.complete(new URLSearchParams({state:forgedUrl.searchParams.get('state'),access_token:'mock_'+'0'.repeat(48),token_type:'bearer'}).toString()),{message:'AUTH_INVALID'});
  const oauth=new MockOAuth();await oauth.complete(await authorize(oauth));const auth=await oauth.credentials();assert.equal(auth.userId,'synthetic-user');
  const invalid=await fetch('http://127.0.0.1:8091/helix/eventsub/subscriptions',{method:'POST',headers:{'Content-Type':'application/json','Client-Id':'streamer-mayhem-mock',Authorization:'Bearer mock_'+ '0'.repeat(48)},body:'{}'});assert.equal(invalid.status,401);
  console.log('PASS local OAuth consent, denied consent, state mismatch/replay and invalid token');
  let now=0;const clock=()=>now,p={x:.5,y:.5,visibility:1};const game=new MatrixGame({clock,options:{actorCooldown:0,globalCooldown:0}});game.start();game.addFrame({frameId:'start',captureTime:0,nose:p,leftShoulder:p,rightShoulder:p});game.tick();
  const deliveries=[];const provider=new TwitchProvider({game,clock,config:LOCAL_CONFIG,mode:'local',retryBaseMs:30,retryMaxMs:100,onDelivery:r=>deliveries.push(r)});const adapter=provider.adapter;transport=provider.transport;
  let popup;const states=[];const activation=new ProviderActivation({provider,origin:'http://127.0.0.1:4173',onState:state=>states.push(state),openWindow:url=>(popup={url,closed:false,postMessage(){},close(){this.closed=true;}})});
  assert.equal((await request()).data.length,0);assert.equal(activation.start(),true);
  const consent=new URL(popup.url);consent.searchParams.set('decision','allow');const reply=await fetch(consent,{redirect:'manual'});assert.equal(reply.status,302);
  const callback=new URL(reply.headers.get('location'));assert.equal(await activation.handleMessage({origin:'http://127.0.0.1:4173',source:popup,data:{type:'streamer-mayhem-local-oauth',fragment:callback.hash,query:callback.search}}),true);
  assert.deepEqual(states,['PENDING','VALIDATING','AUTHORIZED']);await until(()=>transport.status==='ONLINE','chat subscribe');
  console.log('PASS activation popup callback starts the local provider and subscription');
  let subs=(await request()).data;assert.equal(subs.length,1);assert.equal(subs[0].type,'channel.chat.message');assert.deepEqual(subs[0].condition,{broadcaster_user_id:'synthetic-channel',user_id:'synthetic-user'});let id=subs[0].id,session=adapter.sessionId;
  await request('',{action:'chat',session,text:'!throw 5',message_id:'m1',notification_id:'n1'});await until(()=>deliveries.length===1,'first message');assert.equal(deliveries[0].accepted,true);
  await request('',{action:'chat',session,text:'!throw 5',message_id:'m2',notification_id:'n1'});await request('',{action:'chat',session,text:'!throw 5',message_id:'m1',notification_id:'n2'});await until(()=>deliveries.length===3,'duplicates');assert.deepEqual(deliveries.slice(1).map(x=>x.reason),['DUPLICATE','DUPLICATE']);
  assert.equal(game.attacks.length,1);console.log('PASS authenticated channel.chat.message subscription and both delivery ID dedupe paths');
  await request('',{action:'disconnect',session});await until(()=>transport.status==='ONLINE' && adapter.sessionId!==session,'resubscribe');subs=(await request()).data;assert.equal(subs.length,1);assert.notEqual(subs[0].id,id);session=adapter.sessionId;id=subs[0].id;
  await request('',{action:'chat',session,text:'!throw 5',message_id:'m1',notification_id:'n3'});await until(()=>deliveries.length===4,'duplicate after disconnect');assert.equal(deliveries[3].reason,'DUPLICATE');
  console.log('PASS forced disconnect creates authenticated new subscription and preserves dedupe');
  await request('',{action:'reconnect',session});await until(()=>transport.status==='ONLINE' && adapter.sessionId!==session,'migration');subs=(await request()).data;assert.equal(subs.length,1);assert.equal(subs[0].id,id);session=adapter.sessionId;
  await request('',{action:'chat',session,text:'!throw 1',message_id:'m3',notification_id:'n4'});await until(()=>deliveries.length===5,'delivery after migration');assert.equal(deliveries[4].cell,1);
  console.log('PASS planned reconnect migrates same chat subscription and delivers new event');
  provider.oauth.clear();await request('',{action:'disconnect',session});await until(()=>transport.status==='STOPPED','invalid auth stops retry');assert.equal(game.connection,'OFFLINE');
  console.log('PASS missing authorization stops reconnect and leaves game offline');
}catch(error){console.error('FAIL',error.message);process.exitCode=1;}finally{clearTimeout(timer);transport?.stop();if(!closed)child.kill('SIGINT');for(let i=0;i<80&&!closed;i++)await sleep(25);if(!closed){console.error('FAIL simulator did not exit');process.exitCode=1;}}
