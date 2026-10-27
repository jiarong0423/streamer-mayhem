// Opt-in Twitch CLI mock transport. All addresses and identities are synthetic.
import {chatSubscription} from './twitch_chat_contract.mjs';
import {LIVE_NETWORK_ENABLED,TWITCH_ENDPOINTS} from './twitch_endpoints.mjs';
const WS_URL='ws://127.0.0.1:8080/ws';
const API_URL='http://127.0.0.1:8080/eventsub/subscriptions';
const CLIENT_ID='streamer-mayhem-local-mock';
const SUBSCRIPTION={type:'channel.ban',version:'1',condition:{broadcaster_user_id:'synthetic-channel'}};
const CHAT_WS_URL='ws://127.0.0.1:8091/ws';
const CHAT_API_URL='http://127.0.0.1:8091/helix/eventsub/subscriptions';
const CHAT_CLIENT_ID='streamer-mayhem-mock';

function reconnectUrl(raw,port='8080',live=false) {
  const url=new URL(raw);
  if(live) {if(url.protocol!=='wss:' || url.hostname!=='eventsub.wss.twitch.tv' || url.port || !['/','/ws'].includes(url.pathname) || url.username || url.password || url.hash)throw new Error('INVALID_RECONNECT_URL');return raw;}
  if(url.protocol!=='ws:' || url.hostname!=='127.0.0.1' || url.port!==port || url.pathname!=='/ws' || url.username || url.password || url.hash) throw new Error('INVALID_RECONNECT_URL');
  return url.href;
}

export class MockEventSubTransport {
  constructor({adapter, onStatus=()=>{}, onDelivery=()=>{}, WebSocketClass=globalThis.WebSocket, fetchImpl=globalThis.fetch, retryBaseMs=500, retryMaxMs=5000, profile='official', oauth=null, config=null}={}) {
    if(!adapter || typeof adapter.ingest!=='function' || typeof adapter.disconnect!=='function') throw new TypeError('adapter required');
    if(typeof WebSocketClass!=='function' || typeof fetchImpl!=='function') throw new TypeError('WebSocket and fetch required');
    if(!Number.isFinite(retryBaseMs) || retryBaseMs<1 || !Number.isFinite(retryMaxMs) || retryMaxMs<retryBaseMs) throw new RangeError('invalid retry timing');
    if(!['official','chat','twitch-local','twitch-live'].includes(profile) || (profile!=='official' && typeof oauth?.credentials!=='function') || (profile.startsWith('twitch-') && (!config || adapter.broadcasterId!==config.channelId)))throw new TypeError('invalid mock profile');
    this.adapter=adapter;this.onStatus=onStatus;this.onDelivery=onDelivery;this.WS=WebSocketClass;this.fetch=(...args)=>fetchImpl(...args);
    this.profile=profile;this.oauth=oauth;this.config=config;this.isChat=profile!=='official';this.live=profile==='twitch-live';this.wsUrl=this.live?TWITCH_ENDPOINTS.socket:this.isChat?CHAT_WS_URL:WS_URL;this.wsPort=this.isChat?'8091':'8080';
    this.retryBaseMs=retryBaseMs;this.retryMaxMs=retryMaxMs;this.status='STOPPED';this.enabled=false;this.generation=0;
    this.active=null;this.candidate=null;this.retryTimer=null;this.watchdog=null;this.authTimer=null;this.retryCount=0;this.pending=[];this.abort=null;
  }
  report(status, detail='') {this.status=status;this.onStatus(status,detail);}
  start() {
    if(this.live && !LIVE_NETWORK_ENABLED)throw new Error('LIVE_CONNECTION_DISABLED');
    if(this.enabled)return false;
    this.enabled=true;this.generation++;this.retryCount=0;this.pending=[];this.adapter.disconnect();this.open(this.wsUrl,false,this.generation);return true;
  }
  stop(reason='') {
    this.enabled=false;this.generation++;clearTimeout(this.retryTimer);clearTimeout(this.watchdog);clearTimeout(this.authTimer);this.abort?.abort();this.abort=null;
    for(const connection of [this.active,this.candidate])if(connection){clearTimeout(connection.timer);try{connection.socket.close();}catch{}}
    this.active=null;this.candidate=null;this.pending=[];this.adapter.disconnect();this.report('STOPPED',reason);
  }
  open(url,migrating,generation) {
    if(!this.enabled || generation!==this.generation)return;
    this.report(migrating?'MIGRATING':'CONNECTING');
    let socket;try {socket=new this.WS(reconnectUrl(url,this.wsPort,this.live));} catch {this.fail('CONNECT_FAILED',generation);return;}
    const connection={socket,migrating,generation,ready:false,timer:null};this.candidate=connection;
    connection.timer=setTimeout(()=>this.fail('WELCOME_TIMEOUT',generation),9000);
    socket.addEventListener('message',event=>this.message(connection,event.data));
    socket.addEventListener('close',()=>{
      clearTimeout(connection.timer);
      if(!this.enabled || generation!==this.generation)return;
      if(this.active===connection || this.candidate===connection)this.fail('SOCKET_CLOSED',generation);
    });
    socket.addEventListener('error',()=>{}); // close or welcome timeout drives retry.
  }
  async message(connection,raw) {
    if(!this.enabled || connection.generation!==this.generation || (connection!==this.active && connection!==this.candidate))return;
    if(typeof raw!=='string' || raw.length>32768){this.fail('INVALID_MESSAGE',connection.generation);return;}
    let data;try{data=JSON.parse(raw);}catch{this.fail('INVALID_MESSAGE',connection.generation);return;}
    const type=data?.metadata?.message_type;
    if(connection===this.candidate && !connection.ready) {
      if(type!=='session_welcome' || typeof data.payload?.session?.id!=='string' || !data.payload.session.id || data.payload.session.id.length>128){this.fail('INVALID_WELCOME',connection.generation);return;}
      connection.ready=true;clearTimeout(connection.timer);
      if(!connection.migrating) {
        this.report('SUBSCRIBING');
        try {await this.subscribe(data.payload.session.id,connection.generation);} catch(error) {if(this.enabled && connection.generation===this.generation){if(['AUTH_INVALID','AUTH_REQUIRED','AUTH_VALIDATE_FAILED'].includes(error?.message)){this.oauth?.clear();this.stop('AUTH_REQUIRED');}else {const safe=['INVALID_SUBSCRIPTION','SUBSCRIPTION_HTTP_ERROR'];this.fail(safe.includes(error?.message)?error.message:'SUBSCRIPTION_NETWORK_ERROR',connection.generation);}}return;}
      }
      if(!this.enabled || connection.generation!==this.generation || this.candidate!==connection)return;
      const old=this.active;this.active=connection;this.candidate=null;this.retryCount=0;
      const accepted=this.adapter.ingest(data);if(!accepted.accepted){this.fail('INVALID_WELCOME',connection.generation);return;}
      this.report('ONLINE',connection.migrating?'MIGRATED':'SUBSCRIBED');this.armWatchdog(data.payload.session.keepalive_timeout_seconds,connection.generation);
      for(const queued of this.pending.splice(0))this.onDelivery(this.adapter.ingest(queued));
      if(old && old!==connection){clearTimeout(old.timer);try{old.socket.close();}catch{}}
      return;
    }
    if(connection===this.candidate && connection.ready && !connection.migrating && type==='notification') {
      if(this.pending.length>=256){this.fail('SUBSCRIPTION_QUEUE_FULL',connection.generation);return;}
      this.pending.push(data);return;
    }
    if(connection!==this.active)return;
    if(type==='session_reconnect') {
      if(this.candidate)return;
      let next;try{next=reconnectUrl(data.payload?.session?.reconnect_url,this.wsPort,this.live);}catch{this.fail('INVALID_RECONNECT_URL',connection.generation);return;}
      this.adapter.update('SIMULATED_RECONNECTING');this.open(next,true,connection.generation);return;
    }
    if(type==='revocation'){this.adapter.ingest(data);this.stop('REVOKED');return;}
    if(type==='notification' || type==='session_keepalive')this.armWatchdog(undefined,connection.generation);
    if(type==='notification' && this.candidate?.migrating){
      if(this.pending.length>=256){this.fail('MIGRATION_QUEUE_FULL',connection.generation);return;}
      this.pending.push(data);return;
    }
    const result=this.adapter.ingest(data);if(type==='notification')this.onDelivery(result);
  }
  async subscribe(sessionId,generation) {
    if(this.live && !LIVE_NETWORK_ENABLED)throw new Error('LIVE_CONNECTION_DISABLED');
    const controller=new AbortController();this.abort=controller;const timer=setTimeout(()=>controller.abort(),6000);
    try {
      const auth=this.isChat?await this.oauth.credentials():null;
      if(generation!==this.generation)throw new Error('AUTH_REQUIRED');
      const sub=this.isChat?chatSubscription({broadcasterId:this.config?.channelId??'synthetic-channel',userId:auth.userId,sessionId}):{...SUBSCRIPTION,transport:{method:'websocket',session_id:sessionId}};
      const headers={'Content-Type':'application/json','Client-Id':this.isChat?(this.config?.clientId??CHAT_CLIENT_ID):CLIENT_ID};
      if(auth)headers.Authorization=`Bearer ${auth.token}`;
      const response=await this.fetch(this.live?TWITCH_ENDPOINTS.subscriptions:this.isChat?CHAT_API_URL:API_URL,{method:'POST',headers,
        body:JSON.stringify(sub),signal:controller.signal,redirect:'error',credentials:'omit'});
      if(response.status===401 || response.status===403)throw new Error('AUTH_INVALID');
      if(!response.ok)throw new Error('SUBSCRIPTION_HTTP_ERROR');
      const body=await response.json(), item=body?.data?.[0];
      if(generation!==this.generation || !item || item.type!==sub.type || String(item.version)!=='1' || item.status!=='enabled' || item.transport?.session_id!==sessionId || typeof item.id!=='string' || !item.id)throw new Error('INVALID_SUBSCRIPTION');
      if(auth && (item.transport?.method!=='websocket' || item.condition?.broadcaster_user_id!==sub.condition.broadcaster_user_id || item.condition?.user_id!==auth.userId))throw new Error('INVALID_SUBSCRIPTION');
      if(auth)this.scheduleValidation(auth.expiresIn,generation);
    } finally {clearTimeout(timer);if(this.abort===controller)this.abort=null;}
  }
  scheduleValidation(expiresIn,generation) {
    clearTimeout(this.authTimer);const delay=Math.max(1000,Math.min(3600000,(expiresIn-1)*1000));
    this.authTimer=setTimeout(async()=>{try{const auth=await this.oauth.credentials();if(this.enabled && generation===this.generation)this.scheduleValidation(auth.expiresIn,generation);}catch{if(this.enabled && generation===this.generation){this.oauth.clear();this.stop('AUTH_REQUIRED');}}},delay);
  }
  armWatchdog(seconds,generation) {
    if(seconds!==undefined)this.keepaliveSeconds=Number.isFinite(seconds)&&seconds>=10&&seconds<=600?seconds:10;
    clearTimeout(this.watchdog);this.watchdog=setTimeout(()=>this.fail('KEEPALIVE_TIMEOUT',generation),((this.keepaliveSeconds??10)*1000)+1000);
  }
  fail(reason,generation) {
    if(!this.enabled || generation!==this.generation)return;
    this.generation++;clearTimeout(this.watchdog);clearTimeout(this.authTimer);this.abort?.abort();this.abort=null;
    for(const connection of [this.active,this.candidate])if(connection){clearTimeout(connection.timer);try{connection.socket.close();}catch{}}
    this.active=null;this.candidate=null;this.pending=[];this.adapter.disconnect();this.report('RETRYING',reason);
    const delay=Math.min(this.retryMaxMs,this.retryBaseMs*2**Math.min(this.retryCount++,10));
    const next=this.generation;this.retryTimer=setTimeout(()=>this.open(this.wsUrl,false,next),delay);
  }
}
