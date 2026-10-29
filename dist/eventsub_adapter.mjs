// EventSub-shaped synthetic messages only. This module creates no sockets or HTTP requests.
export class EventSubAdapter {
  constructor({ game, clock = () => performance.now(), onStatus = () => {}, onDelivery = () => {}, broadcasterId = 'synthetic-channel' }) {
    if (!game || typeof game.receiveChat !== 'function' || typeof game.setConnection !== 'function') throw new TypeError('Matrix game is required');
    if (typeof broadcasterId!=='string' || !broadcasterId || broadcasterId.length>128) throw new TypeError('A broadcaster ID is required');
    this.game=game; this.clock=clock; this.onStatus=onStatus; this.onDelivery=onDelivery;
    this.status='OFFLINE'; this.sessionId=null; this.broadcasterId=broadcasterId;
    this.seenNotifications=new Map();   // EventSub delivers at least once: a repeated notification id is dropped here (bounded LRU of 200)
  }
  update(status) {
    this.status=status;
    this.game.setConnection(status==='SIMULATED_ONLINE');
    this.onStatus(status);
  }
  ingest(input) {
    let data=input;
    if (typeof input==='string') {
      if (input.length>32768) return {accepted:false,reason:'MESSAGE_TOO_LARGE'};
      try { data=JSON.parse(input); } catch { return {accepted:false,reason:'INVALID_JSON'}; }
    }
    if (!data || typeof data!=='object' || Array.isArray(data) || !data.metadata || !data.payload) return {accepted:false,reason:'INVALID_ENVELOPE'};
    const type=data.metadata.message_type;
    if (type==='session_welcome') {
      const session=data.payload.session;
      if (typeof session?.id!=='string' || !session.id || session.id.length>128) return {accepted:false,reason:'INVALID_SESSION'};
      this.sessionId=session.id; this.update('SIMULATED_ONLINE');
      return {accepted:true,kind:'welcome'};
    }
    if (type==='session_keepalive') return this.status==='SIMULATED_ONLINE' ? {accepted:true,kind:'keepalive'} : {accepted:false,reason:'OFFLINE'};
    if (type==='session_reconnect') { this.update('SIMULATED_RECONNECTING'); return {accepted:true,kind:'reconnect'}; }
    if (type==='revocation') { this.update('SIMULATED_REVOKED'); return {accepted:true,kind:'revocation'}; }
    if (type!=='notification') return {accepted:false,reason:'UNSUPPORTED_MESSAGE'};
    if (this.status!=='SIMULATED_ONLINE') return {accepted:false,reason:'OFFLINE'};
    const subscription=data.payload.subscription, event=data.payload.event;
    if (subscription?.type!=='channel.chat.message' || String(subscription.version)!=='1') return {accepted:false,reason:'UNSUPPORTED_SUBSCRIPTION'};
    if (data.metadata.subscription_type && data.metadata.subscription_type!==subscription.type) return {accepted:false,reason:'SUBSCRIPTION_MISMATCH'};
    if (event?.broadcaster_user_id!==this.broadcasterId) return {accepted:false,reason:'WRONG_CHANNEL'};
    // Supporter facts come in the same chat event, so no extra permission is needed: a cheer (Bits) object, and subscriber/founder badges.
    const nid=data.metadata.message_id;
    if(typeof nid==='string'&&nid){
      if(this.seenNotifications.has(nid)){this.seenNotifications.delete(nid);this.seenNotifications.set(nid,true);return {accepted:false,reason:'DUPLICATE'};}
      this.seenNotifications.set(nid,true);if(this.seenNotifications.size>200)this.seenNotifications.delete(this.seenNotifications.keys().next().value);
    }
    const cheerBits=Number.isInteger(event?.cheer?.bits)&&event.cheer.bits>0&&event.cheer.bits<=1000000?event.cheer.bits:0;
    const subscriber=Array.isArray(event?.badges)&&event.badges.some(b=>b?.set_id==='subscriber'||b?.set_id==='founder');
    const viewer=cleanViewerName(event?.chatter_user_name);
    const chat={notificationId:data.metadata.message_id,messageId:event?.message_id,
      actorId:event?.chatter_user_id,text:event?.message?.text,receivedAt:this.clock(),viewer,cheerBits};
    const delivery=this.game.receiveChat(chat);
    const output={kind:'chat',...delivery,viewer,actorId:chat.actorId,supporter:cheerBits>0||subscriber,...(cheerBits?{cheerBits}:{})};
    try{this.onDelivery(output);}catch{/* a display callback must not drop the rest of the chat lines */}
    return output;
  }
  disconnect() { this.sessionId=null; this.update('OFFLINE'); }
}

export function syntheticWelcome() {
  return {metadata:{message_type:'session_welcome'},payload:{session:{id:'synthetic-session'}}};
}

// A chatter's display name is shown on stream (and may be spoken), so it is cut down to something safe. ONE function for every path (EventSub, IRC, ticker, voice).
// Removed: control, bidi, zero-width, tag and variation characters; symbols/dingbats (U+2600-27BF, U+2B50: a name must not be able to draw the supporter star);
// the invisible "blank" letters (Hangul fillers, braille blank, soft hyphen ...). At most 2 combining marks in a row, spaces collapsed, at most 20 characters.
const STRIP_NAME=/[\u0000-\u001f\u007f-\u009f\u00a0\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u2028-\u202f\u2060-\u206f\u2600-\u27bf\u2800\u2b50\u3164\ufe00-\ufe0f\uffa0\ufeff\ufff9-\ufffb\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
export const RESERVED_NAME=/\b(CHEERED|BITS|WAIT|BUSY|MISS)\b/i;
export const NAME_FALLBACK='viewer';
// '' when nothing usable is left (also for the reserved words); sanitizeName is the pure cleaner, cleanViewerName adds the neutral fallback.
export function sanitizeName(value){
  if(typeof value!=='string')return '';
  const t=Array.from(value.replace(STRIP_NAME,'').replace(/(\p{M}{2})\p{M}+/gu,'$1').replace(/\s+/g,' ').trim()).slice(0,20).join('').trim();
  if(!/[\p{L}\p{N}]/u.test(t)||/^AUTO$/i.test(t)||RESERVED_NAME.test(t))return '';
  return t;
}
export function cleanViewerName(value){
  if(typeof value!=='string'||!value.trim())return '';
  return sanitizeName(value)||NAME_FALLBACK;
}
export function syntheticChat({ notificationId, messageId, actorId='demo-viewer', chatterName, broadcasterId='synthetic-channel', text, badges, cheerBits }) {
  return {metadata:{message_type:'notification',message_id:notificationId,subscription_type:'channel.chat.message'},
    payload:{subscription:{type:'channel.chat.message',version:'1'},
      event:{message_id:messageId,broadcaster_user_id:broadcasterId,chatter_user_id:actorId,...(chatterName?{chatter_user_name:chatterName}:{}),...(badges?{badges}:{}),...(cheerBits?{cheer:{bits:cheerBits}}:{}),message:{text}}}};
}
