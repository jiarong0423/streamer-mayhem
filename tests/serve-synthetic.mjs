import { createOverlayRelay } from '../scripts/overlay-relay.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const routes=new Map([
  ['/tests/overlay_page.html',['tests/overlay_page.html','text/html; charset=utf-8']],
  ['/overlay.html',['dist/overlay.html','text/html; charset=utf-8']],
  ['/overlay.css',['dist/overlay.css','text/css; charset=utf-8']],
  ...['overlay.mjs','overlay_protocol.mjs','camera_geometry.mjs','matrix.mjs','pose_freeze.mjs','action_games.mjs','matrix_view.mjs'].map(name=>[`/${name}`,[`dist/${name}`,'text/javascript; charset=utf-8']]),
  ['/tests/real_canvas.html',['tests/real_canvas.html','text/html; charset=utf-8']],
  ['/tests/calibration_canvas.html',['tests/calibration_canvas.html','text/html; charset=utf-8']],
  ['/dist/camera_geometry.mjs',['dist/camera_geometry.mjs','text/javascript; charset=utf-8']],
  ['/dist/action_games.mjs',['dist/action_games.mjs','text/javascript; charset=utf-8']],
  ['/dist/pose_freeze.mjs',['dist/pose_freeze.mjs','text/javascript; charset=utf-8']],
  ['/dist/matrix.mjs',['dist/matrix.mjs','text/javascript; charset=utf-8']],
  ['/dist/matrix_view.mjs',['dist/matrix_view.mjs','text/javascript; charset=utf-8']],
]);
const relay=createOverlayRelay();
const server=http.createServer(async (request,response)=>{
  if(relay.handle(request,response))return;
  const route=routes.get(new URL(request.url,'http://127.0.0.1').pathname);
  if(request.method!=='GET' || !route){response.writeHead(404);response.end('Not found');return;}
  try {const body=await readFile(resolve(root,route[0]));response.writeHead(200,{'Content-Type':route[1],'Cache-Control':'no-store'});response.end(body);}
  catch {response.writeHead(500);response.end('Read error');}
});
server.on('close',()=>relay.close());
server.on('error',error=>{process.stderr.write(`Server error: ${error.message}\n`);process.exitCode=1;});
server.listen(0,'127.0.0.1',()=>process.stdout.write(`http://127.0.0.1:${server.address().port}/tests/real_canvas.html\n`));
setTimeout(()=>{relay.close();server.close();},55000).unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{relay.close();server.close();});
