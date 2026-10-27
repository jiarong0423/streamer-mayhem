import test from 'node:test';
import assert from 'node:assert/strict';
import {MockOAuth} from '../dist/mock_oauth.mjs';

const token='mock_'+'a'.repeat(48);
const metadata={client_id:'streamer-mayhem-mock',user_id:'synthetic-user',scopes:['user:read:chat'],expires_in:3600};
const fragment=url=>new URLSearchParams({state:new URL(url).searchParams.get('state'),access_token:token,token_type:'bearer'}).toString();
const response=data=>({ok:true,json:async()=>data});

test('authorization uses fixed local endpoint, scope, nonce and callback',async()=>{
  const oauth=new MockOAuth({fetchImpl:async()=>response(metadata)}),url=new URL(oauth.begin());
  assert.equal(url.origin,'http://127.0.0.1:8091');assert.equal(url.searchParams.get('scope'),'user:read:chat');
  assert.equal(url.searchParams.get('redirect_uri'),'http://127.0.0.1:4173/oauth-callback.html');
  assert.equal((await oauth.complete(fragment(url))).userId,'synthetic-user');oauth.clear();await assert.rejects(oauth.credentials(),{message:'AUTH_REQUIRED'});
});
test('missing chat scope, wrong user or expired token fail closed',async()=>{
  for(const change of [{scopes:[]},{user_id:'other'},{expires_in:0},{client_id:'other'}]){
    const oauth=new MockOAuth({fetchImpl:async()=>response({...metadata,...change})}),url=oauth.begin();
    await assert.rejects(oauth.complete(fragment(url)),{message:'AUTH_INVALID'});await assert.rejects(oauth.credentials(),{message:'AUTH_REQUIRED'});
  }
});
test('expired state and duplicate state parameters are rejected',async()=>{
  let now=0;const oauth=new MockOAuth({fetchImpl:async()=>response(metadata),clock:()=>now});let url=oauth.begin();now=120001;
  await assert.rejects(oauth.complete(fragment(url)),{message:'INVALID_STATE'});url=oauth.begin();const params=new URLSearchParams(fragment(url));params.append('state',params.get('state'));
  await assert.rejects(oauth.complete(params.toString()),{message:'INVALID_TOKEN'});
});
test('cancel during validation cannot authenticate or erase a subsequent authorization',async()=>{
  let finish;const oauth=new MockOAuth({fetchImpl:()=>new Promise(resolve=>{finish=resolve;})});const first=oauth.begin();const pending=oauth.complete(fragment(first));
  oauth.clear();const second=oauth.begin();finish(response(metadata));await assert.rejects(pending,{message:'AUTH_INVALID'});
  const next=oauth.complete(fragment(second));finish(response(metadata));assert.equal((await next).userId,'synthetic-user');oauth.clear();
});
