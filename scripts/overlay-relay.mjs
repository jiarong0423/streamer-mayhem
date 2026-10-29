// Bounded in-memory loopback relay for synthetic overlay state only.
import {readOverlayState,makeOverlayState,OVERLAY_STATE_TYPE,OVERLAY_CLOSED_TYPE} from '../dist/overlay_protocol.mjs';
const SESSION=/^[a-f0-9]{32}$/;
export const MAX_BODY=8192;   // v4 adds up to 8 marquee items, a versus bar and a banner; tests/overlay_protocol.test.mjs sizes the largest legal state against this
export function createOverlayRelay() {
  const sessions=new Map();
  const remove=(id)=>{const entry=sessions.get(id);if(!entry)return;clearTimeout(entry.timer);for(const response of entry.clients)response.end();sessions.delete(id);};
  const touch=(id,entry)=>{clearTimeout(entry.timer);entry.timer=setTimeout(()=>remove(id),30000);entry.timer.unref?.();};
  const entryFor=id=>{let entry=sessions.get(id);if(!entry){if(sessions.size>=32)return null;entry={clients:new Set(),last:null,sequence:-1,lastAt:0,windowAt:0,count:0,timer:null};sessions.set(id,entry);}touch(id,entry);return entry;};
  function reject(res,status){res.writeHead(status,{'Cache-Control':'no-store'});res.end();}
  function handle(req,res){
    let path;try{path=new URL(req.url,'http://127.0.0.1').pathname;}catch{reject(res,400);return true;}
    if(!['/__overlay/events','/__overlay/state'].includes(path))return false;
    const host=req.headers.host??'';if(!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)){reject(res,403);return true;}
    if(path==='/__overlay/events'){
      const url=new URL(req.url,`http://${host}`),id=url.searchParams.get('session');
      if(req.method!=='GET'||!SESSION.test(id??'')||url.searchParams.getAll('session').length!==1||[...url.searchParams.keys()].some(k=>k!=='session')){reject(res,400);return true;}
      const entry=entryFor(id);if(!entry||entry.clients.size>=8){reject(res,429);return true;}
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});res.write(': connected\n\n');entry.clients.add(res);
      if(entry.last&&Date.now()-entry.lastAt<=1500)res.write(`data: ${JSON.stringify(entry.last)}\n\n`);
      req.on('close',()=>{entry.clients.delete(res);if(!entry.clients.size&&!entry.last)remove(id);});return true;
    }
    if(req.method!=='POST'||req.headers.origin!==`http://${host}` || req.headers['content-type']?.split(';')[0].trim()!=='application/json'){reject(res,403);return true;}
    let body='',oversize=false;req.setEncoding('utf8');
    req.on('data',chunk=>{if(oversize)return;body+=chunk;if(body.length>MAX_BODY){oversize=true;reject(res,413);req.destroy();}});
    req.on('end',()=>{
      if(oversize)return;
      let message;try{message=JSON.parse(body);}catch{reject(res,400);return;}
      const id=message?.session;if(!SESSION.test(id??'')||!Number.isSafeInteger(message.sequence)||message.sequence<0){reject(res,400);return;}
      if(message.type===OVERLAY_STATE_TYPE){try{const safe=readOverlayState(message,id,1280,720);message=makeOverlayState({session:id,sequence:safe.sequence,geometry:safe.geometry,snapshot:safe.snapshot,sourcePoint:safe.sourcePoint});}catch{reject(res,400);return;}}
      else if(message.type===OVERLAY_CLOSED_TYPE)message={type:OVERLAY_CLOSED_TYPE,session:id,sequence:message.sequence};
      else {reject(res,400);return;}
      const entry=entryFor(id);if(!entry){reject(res,429);return;}
      if(message.sequence<=entry.sequence){reject(res,409);return;}
      const now=Date.now();if(now-entry.windowAt>=1000){entry.windowAt=now;entry.count=0;}if(++entry.count>25){reject(res,429);return;}
      entry.sequence=message.sequence;entry.last=message;entry.lastAt=now;
      for(const client of entry.clients)if(!client.write(`data: ${JSON.stringify(message)}\n\n`)){entry.clients.delete(client);client.end();}
      res.writeHead(204,{'Cache-Control':'no-store'});res.end();
    });
    req.on('error',()=>{if(!res.headersSent)reject(res,400);});return true;
  }
  function close(){for(const id of [...sessions.keys()])remove(id);}
  return {handle,close};
}
