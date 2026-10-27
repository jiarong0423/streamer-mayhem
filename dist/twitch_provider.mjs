// Twitch provider contract. Live networking remains deliberately locked.
import {authorizationUrl,validateUserToken} from './twitch_chat_contract.mjs';
import {EventSubAdapter} from './eventsub_adapter.mjs';
import {MockEventSubTransport} from './mock_eventsub_transport.mjs';
import {LIVE_NETWORK_ENABLED,TWITCH_ENDPOINTS} from './twitch_endpoints.mjs';
export {LIVE_NETWORK_ENABLED,TWITCH_ENDPOINTS} from './twitch_endpoints.mjs';

const LOCAL=Object.freeze({authorize:'http://127.0.0.1:8091/oauth2/authorize',validate:'http://127.0.0.1:8091/oauth2/validate'});
export const LOCAL_CONFIG=Object.freeze({clientId:'streamer-mayhem-mock',channelId:'synthetic-channel',redirectUri:'http://127.0.0.1:4173/oauth-callback.html'});

export function validateProviderConfig(config,{local=false}={}) {
  if(!config || typeof config.clientId!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(config.clientId))throw new Error('INVALID_CLIENT_ID');
  if(typeof config.channelId!=='string' || !(local?config.channelId==='synthetic-channel':/^[0-9]{1,20}$/.test(config.channelId)))throw new Error('INVALID_CHANNEL_ID');
  let callback;try{callback=new URL(config.redirectUri);}catch{throw new Error('INVALID_CALLBACK');}
  if(callback.origin!=='http://127.0.0.1:4173' || callback.username || callback.password || callback.search || callback.hash || !/^\/(?:[A-Za-z0-9_-]+\/)*oauth-callback\.html$/.test(callback.pathname))throw new Error('INVALID_CALLBACK');
  if(local && (config.clientId!==LOCAL_CONFIG.clientId || callback.href!==LOCAL_CONFIG.redirectUri))throw new Error('INVALID_LOCAL_CONFIG');
  return Object.freeze({clientId:config.clientId,channelId:config.channelId,redirectUri:callback.href});
}
export function previewAuthorizationUrl(config,state) {
  const safe=validateProviderConfig(config);
  return authorizationUrl({endpoint:TWITCH_ENDPOINTS.authorize,clientId:safe.clientId,redirectUri:safe.redirectUri,state});
}
export class TwitchOAuth {
  #token=null; #pending=null;
  constructor({config=LOCAL_CONFIG,mode='local',fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,clock=()=>Date.now()}={}) {
    if(!['local','live'].includes(mode) || typeof fetchImpl!=='function' || typeof cryptoImpl?.getRandomValues!=='function')throw new TypeError('invalid OAuth dependencies');
    this.mode=mode;this.config=validateProviderConfig(config,{local:mode==='local'});this.fetch=(...args)=>fetchImpl(...args);this.crypto=cryptoImpl;this.clock=clock;
  }
  begin() {
    if(this.mode==='live' && !LIVE_NETWORK_ENABLED)throw new Error('LIVE_CONNECTION_DISABLED');
    this.clear();const bytes=new Uint8Array(32);this.crypto.getRandomValues(bytes);
    const state=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');this.#pending={state,until:this.clock()+120000};
    return authorizationUrl({endpoint:this.mode==='local'?LOCAL.authorize:TWITCH_ENDPOINTS.authorize,clientId:this.config.clientId,redirectUri:this.config.redirectUri,state});
  }
  async complete(fragment,query='') {
    const pending=this.#pending;this.#pending=null;
    const hash=new URLSearchParams(typeof fragment==='string'?fragment.replace(/^#/,''):'');
    const search=new URLSearchParams(typeof query==='string'?query.replace(/^\?/,''):'');
    const denied=search.has('error') || hash.has('error');
    const params=search.has('error')?search:hash;
    if(!pending || this.clock()>pending.until || params.get('state')!==pending.state)throw new Error('INVALID_STATE');
    if(denied){if(params.getAll('state').length!==1 || params.getAll('error').length!==1 || hash.has('access_token') || search.has('access_token') || (search.has('error') && hash.has('error')))throw new Error('INVALID_TOKEN');throw new Error('AUTH_DENIED');}
    const token=hash.get('access_token');
    if(search.has('access_token') || search.has('state') || hash.getAll('access_token').length!==1 || hash.getAll('state').length!==1 || !(this.mode==='local'?/^mock_[a-f0-9]{48}$/:/^[A-Za-z0-9._~-]{1,2048}$/).test(token??'') || hash.get('token_type')?.toLowerCase()!=='bearer')throw new Error('INVALID_TOKEN');
    this.#token=token;try{return await this.credentials();}catch(error){if(this.#token===token)this.clear();throw error;}
  }
  async credentials() {
    if(this.mode==='live' && !LIVE_NETWORK_ENABLED)throw new Error('LIVE_CONNECTION_DISABLED');
    if(!this.#token)throw new Error('AUTH_REQUIRED');const token=this.#token;
    let response;try{response=await this.fetch(this.mode==='local'?LOCAL.validate:TWITCH_ENDPOINTS.validate,{headers:{Authorization:`OAuth ${token}`},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(5000)});}catch{throw new Error('AUTH_VALIDATE_FAILED');}
    if(!response.ok)throw new Error('AUTH_INVALID');const data=await response.json();
    if(this.#token!==token || !validateUserToken(data,{clientId:this.config.clientId,userId:this.mode==='local'?'synthetic-user':undefined}))throw new Error('AUTH_INVALID');
    return {token,userId:data.user_id,expiresIn:data.expires_in};
  }
  clear(){this.#token=null;this.#pending=null;}
}
export class TwitchProvider {
  constructor({config,mode='live',game,onStatus,onDelivery,WebSocketClass,fetchImpl,cryptoImpl,clock,retryBaseMs,retryMaxMs}={}) {
    this.config=validateProviderConfig(config,{local:mode==='local'});this.mode=mode;
    this.oauth=new TwitchOAuth({config:this.config,mode,fetchImpl,cryptoImpl,clock});
    this.adapter=new EventSubAdapter({game,clock,broadcasterId:this.config.channelId});
    this.transport=new MockEventSubTransport({adapter:this.adapter,oauth:this.oauth,profile:mode==='local'?'twitch-local':'twitch-live',config:this.config,onStatus,onDelivery,WebSocketClass,fetchImpl,retryBaseMs,retryMaxMs});
  }
  start(){if(this.mode==='live'&&!LIVE_NETWORK_ENABLED)throw new Error('LIVE_CONNECTION_DISABLED');return this.transport.start();}
  stop(){this.transport.stop();this.oauth.clear();}
}
