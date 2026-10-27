// Pure Twitch OAuth/EventSub request contract: no network, credentials or storage.
export function authorizationUrl({endpoint,clientId,redirectUri,state}) {
  const base=new URL(endpoint),redirect=new URL(redirectUri);
  if(!clientId || !/^[A-Za-z0-9_-]{1,128}$/.test(clientId) || !/^[a-f0-9]{64}$/.test(state) || base.username || base.password || base.hash || base.search || redirect.hash || redirect.username || redirect.password)throw new Error('INVALID_AUTH_REQUEST');
  if(!['http:','https:'].includes(base.protocol) || !['http:','https:'].includes(redirect.protocol))throw new Error('INVALID_AUTH_REQUEST');
  base.search=new URLSearchParams({client_id:clientId,redirect_uri:redirect.href,response_type:'token',scope:'user:read:chat',state}).toString();return base.href;
}
export function validateUserToken(data,{clientId,userId}={}) {
  return Boolean(data && data.client_id===clientId && typeof data.user_id==='string' && data.user_id.length>0 && (!userId||data.user_id===userId) && Array.isArray(data.scopes) && data.scopes.includes('user:read:chat') && Number.isFinite(data.expires_in) && data.expires_in>0);
}
export function chatSubscription({broadcasterId,userId,sessionId}) {
  if([broadcasterId,userId,sessionId].some(value=>typeof value!=='string'||!value||value.length>128))throw new TypeError('INVALID_SUBSCRIPTION');
  return {type:'channel.chat.message',version:'1',condition:{broadcaster_user_id:broadcasterId,user_id:userId},transport:{method:'websocket',session_id:sessionId}};
}
