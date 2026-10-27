// EventSub-shaped synthetic messages only. This module creates no sockets or HTTP requests.
export class EventSubAdapter {
  constructor({ game, clock = () => performance.now(), onStatus = () => {}, onDelivery = () => {}, broadcasterId = 'synthetic-channel' }) {
    if (!game || typeof game.receiveChat !== 'function' || typeof game.setConnection !== 'function') throw new TypeError('Matrix game is required');
    if (typeof broadcasterId!=='string' || !broadcasterId || broadcasterId.length>128) throw new TypeError('A broadcaster ID is required');
    this.game=game; this.clock=clock; this.onStatus=onStatus; this.onDelivery=onDelivery;
    this.status='OFFLINE'; this.sessionId=null; this.broadcasterId=broadcasterId;
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
    const chat={notificationId:data.metadata.message_id,messageId:event?.message_id,
      actorId:event?.chatter_user_id,text:event?.message?.text,receivedAt:this.clock()};
    const delivery=this.game.receiveChat(chat);
    const output={...delivery,kind:'chat'};
    this.onDelivery(output);
    return output;
  }
  disconnect() { this.sessionId=null; this.update('OFFLINE'); }
}

export function syntheticWelcome() {
  return {metadata:{message_type:'session_welcome'},payload:{session:{id:'synthetic-session'}}};
}

export function syntheticChat({ notificationId, messageId, actorId='demo-viewer', broadcasterId='synthetic-channel', text }) {
  return {metadata:{message_type:'notification',message_id:notificationId,subscription_type:'channel.chat.message'},
    payload:{subscription:{type:'channel.chat.message',version:'1'},
      event:{message_id:messageId,broadcaster_user_id:broadcasterId,chatter_user_id:actorId,message:{text}}}};
}
