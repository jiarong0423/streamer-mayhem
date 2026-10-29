import { createOverlayRelay } from '../scripts/overlay-relay.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const routes=new Map([
  ['/',['index.html','text/html; charset=utf-8']], ['/index.html',['index.html','text/html; charset=utf-8']],
  ['/styles.css',['styles.css','text/css; charset=utf-8']], ['/ux.css',['ux.css','text/css; charset=utf-8']],
  ['/overlay.html',['overlay.html','text/html; charset=utf-8']], ['/overlay.css',['overlay.css','text/css; charset=utf-8']],
  ['/oauth-callback.html',['oauth-callback.html','text/html; charset=utf-8']],
  ...['app.mjs','ticker.mjs','frame_source.mjs','overlay.mjs','overlay_protocol.mjs','overlay_publisher.mjs','overlay_scene.mjs','matrix.mjs','pose_freeze.mjs','action_games.mjs','matrix_view.mjs','camera_geometry.mjs','arena_draw.mjs','eventsub_adapter.mjs','mock_eventsub_transport.mjs','mock_oauth.mjs','oauth-callback.mjs','twitch_chat_contract.mjs','twitch_provider.mjs','twitch_endpoints.mjs','provider_activation.mjs','auth_popup_controller.mjs','irc_anonymous.mjs','camera_tracker.mjs','auto_frame.mjs','catch_fx.mjs','drop_lanes.mjs','art.mjs','drop_waves.mjs','sfx.mjs'].map(name=>[`/${name}`,[name,'text/javascript; charset=utf-8']]),
]);
for(const [file,type] of [['vision_bundle.mjs','text/javascript; charset=utf-8'],['wasm/vision_wasm_internal.js','text/javascript; charset=utf-8'],['wasm/vision_wasm_internal.wasm','application/wasm'],['pose_landmarker_lite.task','application/octet-stream'],['blaze_face_short_range.tflite','application/octet-stream'],['face_landmarker.task','application/octet-stream']])routes.set(`/vendor/mediapipe/${file}`,[`vendor/mediapipe/${file}`,type]);
for(const file of ['star_01.png','star_02.png','star_06.png'])routes.set(`/vendor/kenney-particles/${file}`,[`vendor/kenney-particles/${file}`,'image/png']);
for(const file of ['good_shot.wav','nice_shot.wav','three_points.wav','thanks.wav'])routes.set(`/voice/${file}`,[`voice/${file}`,'audio/wav']);
const smoke=process.argv.includes('--smoke');
const extra=process.argv.slice(2).filter(arg=>arg!=='--smoke');
if(extra.length){process.stderr.write('Usage: node scripts/serve-local.mjs [--smoke]\n');process.exit(2);}
const relay=createOverlayRelay();
const server=http.createServer(async (request,response)=>{
  if(relay.handle(request,response))return;
  let pathname;
  try {pathname=new URL(request.url,'http://127.0.0.1').pathname;} catch {response.writeHead(400);response.end('Bad request');return;}
  const route=routes.get(pathname) ?? (/^\/(?:[A-Za-z0-9_-]+\/)*oauth-callback\.html$/.test(pathname)?['oauth-callback.html','text/html; charset=utf-8']:undefined);
  if(request.method!=='GET' || !route){response.writeHead(404);response.end('Not found');return;}
  try {const body=await readFile(resolve(root,route[0]));response.writeHead(200,{'Content-Type':route[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(body);}
  catch(error){process.stderr.write(`Read error: ${error.code??'unknown'}\n`);response.writeHead(500);response.end('Read error');}
});
server.on('close',()=>relay.close());
server.on('error',error=>{process.stderr.write(`Server error: ${error.message}\n`);process.exitCode=1;});
server.listen(smoke?0:Number(process.env.PORT||4173),'127.0.0.1',()=>process.stdout.write(`Streamer Mayhem: http://127.0.0.1:${server.address().port}/\n`));
if(smoke)setTimeout(()=>{relay.close();server.close();},55000).unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{relay.close();server.close();});
