// Anonymous, read-only Twitch chat over IRC WebSocket. No account, token, client ID or application is used.
// Messages are normalized into the same EventSub-shaped envelope as the OAuth path, so the game rules are identical.
import {EventSubAdapter,syntheticChat,syntheticWelcome} from './eventsub_adapter.mjs';
export const IRC_ENDPOINT='wss://irc-ws.chat.twitch.tv:443';
const CHANNEL_PATTERN=/^[a-z0-9_]{1,25}$/;
const MAX_LINE=8192;

export function normalizeChannel(input) {
  const channel=String(input??'').trim().replace(/^#/,'').toLowerCase();
  if(!CHANNEL_PATTERN.test(channel))throw new Error('INVALID_CHANNEL');
  return channel;
}
function unescapeTag(value) {
  return value.replace(/\\(.)/g,(_,c)=>({s:' ',n:'\n',r:'\r',':':';','\\':'\\'}[c]??c));
}
// Returns {tags,prefix,command,params,trailing} or null for lines that cannot be parsed.
export function parseIrcLine(line) {
  if(typeof line!=='string' || !line || line.length>MAX_LINE)return null;
  let rest=line,tags={},prefix='';
  if(rest.startsWith('@')){
    const end=rest.indexOf(' ');if(end<0)return null;
    for(const part of rest.slice(1,end).split(';')){const eq=part.indexOf('=');tags[eq<0?part:part.slice(0,eq)]=eq<0?'':unescapeTag(part.slice(eq+1));}
    rest=rest.slice(end+1);
  }
  if(rest.startsWith(':')){const end=rest.indexOf(' ');if(end<0)return null;prefix=rest.slice(1,end);rest=rest.slice(end+1);}
  let trailing=null;const t=rest.indexOf(' :');
  if(t>=0){trailing=rest.slice(t+2);rest=rest.slice(0,t);}
  const parts=rest.split(' ').filter(Boolean);
  if(!parts.length)return null;
  return {tags,prefix,command:parts[0],params:parts.slice(1),trailing};
}

export class IrcAnonymousChat {
  constructor({game,channel,WebSocketClass=globalThis.WebSocket,endpoint=IRC_ENDPOINT,clock=()=>performance.now(),onStatus=()=>{},onDelivery=()=>{},
    retryBaseMs=1000,retryMaxMs=15000,maxRetries=Infinity,joinTimeoutMs=10000,idleMs=360000,random=Math.random,setTimer=setTimeout,clearTimer=clearTimeout}={}) {
    if(typeof WebSocketClass!=='function')throw new TypeError('WebSocket implementation is required');
    this.channel=normalizeChannel(channel);this.endpoint=endpoint;this.WebSocketClass=WebSocketClass;
    this.adapter=new EventSubAdapter({game,clock,broadcasterId:'pending-room-id',onDelivery});
    this.onStatus=onStatus;this.retryBaseMs=retryBaseMs;this.retryMaxMs=retryMaxMs;this.maxRetries=maxRetries;this.joinTimeoutMs=joinTimeoutMs;this.idleMs=idleMs;this.watchdog=null;
    this.random=random;this.setTimer=setTimer;this.clearTimer=clearTimer;
    this.status='STOPPED';this.socket=null;this.timer=null;this.attempt=0;this.roomId=null;this.buffer='';
  }
  #set(status,detail){this.status=status;this.onStatus(status,detail);}
  start() {
    if(this.socket||this.timer)return false;
    this.attempt=0;this.#open();return true;
  }
  stop() {
    this.#cancelTimer();this.#close();this.adapter.disconnect();this.roomId=null;this.#set('STOPPED');
  }
  #cancelTimer(){if(this.timer!==null){this.clearTimer(this.timer);this.timer=null;}this.#cancelWatchdog();}
  #cancelWatchdog(){if(this.watchdog!==null){this.clearTimer(this.watchdog);this.watchdog=null;}}
  // One timer for liveness: before ROOMSTATE it is the join timeout, after it the idle limit (Twitch pings about every 5 minutes, so silence means a half-open socket).
  #arm(socket,ms,reason){
    this.#cancelWatchdog();
    this.watchdog=this.setTimer(()=>{this.watchdog=null;if(this.socket!==socket)return;this.#close();this.#retry(reason);},ms);
  }
  #close() {
    const socket=this.socket;this.socket=null;
    if(socket){socket.onopen=socket.onmessage=socket.onclose=socket.onerror=null;try{socket.close();}catch{/* already closed */}}
  }
  #open() {
    this.#set(this.attempt?'RETRYING':'CONNECTING');this.roomId=null;this.buffer='';
    let socket;
    try{socket=new this.WebSocketClass(this.endpoint);}catch{this.#retry('SOCKET_ERROR');return;}
    this.socket=socket;this.#arm(socket,this.joinTimeoutMs,'JOIN_TIMEOUT');
    socket.onopen=()=>{
      if(this.socket!==socket)return;
      const nick=`justinfan${10000+Math.floor(this.random()*80000)}`;
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');socket.send('PASS SCHMOOPIIE');socket.send(`NICK ${nick}`);socket.send(`JOIN #${this.channel}`);
    };
    socket.onmessage=event=>{if(this.socket!==socket)return;if(this.roomId)this.#arm(socket,this.idleMs,'IDLE_TIMEOUT');this.#receive(String(event.data));};
    const lost=()=>{if(this.socket!==socket)return;this.#cancelWatchdog();this.socket=null;this.adapter.disconnect();this.#retry('CONNECTION_LOST');};
    socket.onclose=lost;socket.onerror=lost;
  }
  #retry(reason) {
    this.adapter.disconnect();this.roomId=null;
    if(this.attempt>=this.maxRetries){this.#set('STOPPED',reason);return;}
    const delay=Math.min(this.retryMaxMs,this.retryBaseMs*2**this.attempt);this.attempt+=1;
    this.#set('RETRYING',reason);
    this.timer=this.setTimer(()=>{this.timer=null;this.#open();},delay);
  }
  #receive(data) {
    this.buffer+=data;
    if(this.buffer.length>MAX_LINE*16){this.buffer='';return;}
    const lines=this.buffer.split('\r\n');this.buffer=lines.pop();
    for(const line of lines){const message=parseIrcLine(line);if(message)this.#handle(message);}
  }
  #handle(message) {
    const {command,params,tags,trailing}=message;
    if(command==='PING'){this.socket?.send(`PONG :${trailing??'tmi.twitch.tv'}`);return;}
    if(command==='RECONNECT'){this.#close();this.adapter.disconnect();this.attempt=0;this.#open();return;}
    if(params[0]!==`#${this.channel}`)return;
    if(command==='ROOMSTATE' && /^[0-9]{1,20}$/.test(tags['room-id']??'') && !this.roomId){
      this.roomId=tags['room-id'];this.adapter.broadcasterId=this.roomId;this.attempt=0;this.#arm(this.socket,this.idleMs,'IDLE_TIMEOUT');
      this.adapter.ingest(syntheticWelcome());this.#set('ONLINE');return;
    }
    if(command!=='PRIVMSG' || !this.roomId || tags['room-id']!==this.roomId)return;
    const id=tags.id,userId=tags['user-id'],text=trailing;
    if(!id || !/^[0-9]{1,20}$/.test(userId??'') || typeof text!=='string' || text.startsWith('\u0001'))return;
    this.adapter.ingest(syntheticChat({notificationId:id,messageId:id,actorId:userId,chatterName:tags['display-name']||undefined,broadcasterId:this.roomId,text}));
  }
}
