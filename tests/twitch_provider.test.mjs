import test from 'node:test';
import assert from 'node:assert/strict';
import {TwitchProvider,TwitchOAuth,LOCAL_CONFIG,validateProviderConfig,previewAuthorizationUrl,LIVE_NETWORK_ENABLED} from '../dist/twitch_provider.mjs';
import {chatSubscription} from '../dist/twitch_chat_contract.mjs';
const config={clientId:'test_client',channelId:'123456',redirectUri:'http://127.0.0.1:4173/custom/oauth-callback.html'};
const game={receiveChat(){},setConnection(){}};
const never=()=>{throw new Error('unexpected network');};
class NeverSocket {constructor(){never();}}
test('live provider is locked at OAuth and transport, including direct calls',async()=>{
  assert.equal(LIVE_NETWORK_ENABLED,true);
  const provider=new TwitchProvider({config,game,fetchImpl:never,WebSocketClass:NeverSocket});
  assert.throws(()=>provider.oauth.begin(),{message:'LIVE_CONNECTION_DISABLED'});
  assert.throws(()=>provider.start(),{message:'LIVE_CONNECTION_DISABLED'});
  assert.throws(()=>provider.transport.start(),{message:'LIVE_CONNECTION_DISABLED'});
  await assert.rejects(provider.oauth.credentials(),{message:'LIVE_CONNECTION_DISABLED'});
  await assert.rejects(provider.transport.subscribe('session',0),{message:'LIVE_CONNECTION_DISABLED'});
});
test('formal authorization and chat subscription use configured values',()=>{
  const url=new URL(previewAuthorizationUrl(config,'a'.repeat(64)));
  assert.equal(url.origin,'https://id.twitch.tv');assert.equal(url.searchParams.get('client_id'),config.clientId);
  assert.equal(url.searchParams.get('redirect_uri'),config.redirectUri);assert.equal(url.searchParams.get('scope'),'user:read:chat');
  const sub=chatSubscription({broadcasterId:config.channelId,userId:'987',sessionId:'session'});
  assert.deepEqual(sub.condition,{broadcaster_user_id:config.channelId,user_id:'987'});assert.equal(sub.transport.session_id,'session');
});
test('reject malformed configuration and off-origin callbacks',()=>{
  for(const value of [{...config,clientId:'x y'},{...config,channelId:'channel'},{...config,redirectUri:'https://example.com/oauth-callback.html'},{...config,redirectUri:'http://127.0.0.1:4173/x?y=1'},{...config,redirectUri:'http://user@127.0.0.1:4173/oauth-callback.html'},{...config,redirectUri:'http://127.0.0.1:4173/oauth-callback.html#x'}])assert.throws(()=>validateProviderConfig(value));
  assert.equal(validateProviderConfig(config).redirectUri,config.redirectUri);
});
test('query denial, conflicting callback and replay fail closed',async()=>{
  const oauth=new TwitchOAuth({config:LOCAL_CONFIG,fetchImpl:never});
  let state=new URL(oauth.begin()).searchParams.get('state');
  await assert.rejects(oauth.complete('',`?error=access_denied&state=${state}`),{message:'AUTH_DENIED'});
  await assert.rejects(oauth.complete('',`?error=access_denied&state=${state}`),{message:'INVALID_STATE'});
  state=new URL(oauth.begin()).searchParams.get('state');
  await assert.rejects(oauth.complete(`#access_token=mock_${'a'.repeat(48)}&state=${state}&token_type=bearer`,`?error=access_denied&state=${state}`),{message:'INVALID_TOKEN'});
  state=new URL(oauth.begin()).searchParams.get('state');
  await assert.rejects(oauth.complete('',`?access_token=x&state=${state}`),{message:'INVALID_STATE'});
});
