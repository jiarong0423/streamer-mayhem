// Fake request/response objects for driving the relay's handle() without sockets.
import {EventEmitter} from 'node:events';
export function fakeResponse(){
  const res=new EventEmitter();res.status=null;res.chunks=[];res.ended=false;res.headersSent=false;
  res.writeHead=(status)=>{res.status=status;res.headersSent=true;};
  res.write=chunk=>{res.chunks.push(String(chunk));return true;};
  res.end=chunk=>{if(chunk)res.chunks.push(String(chunk));res.ended=true;};
  return res;
}
export function fakeRequest({method='POST',url='/__overlay/state',host,origin,body,contentType='application/json'}){
  const req=new EventEmitter();req.method=method;req.url=url;req.headers={};
  if(host!==undefined)req.headers.host=host;if(origin!==undefined)req.headers.origin=origin;if(contentType)req.headers['content-type']=contentType;
  req.setEncoding=()=>{};req.destroy=()=>{req.destroyed=true;};
  req.send=()=>{if(body!==undefined)req.emit('data',typeof body==='string'?body:JSON.stringify(body));req.emit('end');};
  return req;
}
