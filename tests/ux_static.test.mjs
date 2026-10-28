import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=file=>readFileSync(resolve(root,file),'utf8');
const html=read('dist/index.html'),app=read('dist/app.mjs'),server=read('scripts/serve-local.mjs');

test('UX-01 every #id the page code looks up exists in index.html',()=>{
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const wanted=new Set([...app.matchAll(/\$\('#([A-Za-z][\w-]*)'\)/g)].map(m=>m[1]));
  for(const id of wanted)if(!ids.has(id)&&!/\$\{/.test(id))assert.fail(`app.mjs uses #${id} but index.html has no such id`);
  for(const id of ['start-playing','start-status','sound-toggle','sound-volume','camera-video'])assert.ok(ids.has(id),id);
});

test('UX-02 sound starts muted: nothing in the page code unlocks or enables audio without a click',()=>{
  const clicks=[...app.matchAll(/\.setEnabled\(true\)/g)].length;assert.equal(clicks,1,'only the sound button turns sound on');
  assert.match(app,/\$\('#sound-toggle'\)\.addEventListener\('click',async\(\)=>\{[\s\S]*?sfx\.setEnabled\(true\)/);
  assert.doesNotMatch(app,/AudioContext/,'the context lives in sfx.mjs only');
  assert.match(html,/id="sound-toggle"[^>]*aria-pressed="false"/);
});

test('UX-03 the local server serves the new files; the CSP is unchanged and allows the stylesheet',()=>{
  assert.match(server,/'\/ux\.css',\['ux\.css','text\/css/);assert.match(server,/'sfx\.mjs'/);
  assert.match(html,/<link rel="stylesheet" href="\.\/ux\.css">/);
  const csp=/Content-Security-Policy" content="([^"]+)"/.exec(html)[1];
  assert.match(csp,/default-src 'self'/);assert.match(csp,/style-src 'self' 'unsafe-inline'/);assert.match(csp,/script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(html,/<script(?![^>]*src=)/,'no inline scripts');
});

test('UX-04 every module app.mjs imports is served by serve-local.mjs',()=>{
  for(const m of app.matchAll(/from\s+'\.\/([\w.-]+\.mjs)'/g))assert.ok(server.includes(`'${m[1]}'`),`${m[1]} is not routed`);
});

test('UX-05 the one-click start is wired: face mode, mirror and auto-frame, 3-2-1, Esc, and the old controls stay under More options',()=>{
  assert.match(app,/\$\('#camera-kind'\)\.value='face'/);assert.match(app,/\$\('#camera-mirror'\)\.checked=true/);assert.match(app,/\$\('#camera-auto'\)\.checked=true/);
  assert.match(app,/big:true/);assert.match(app,/event\.key==='Escape'/);
  const more=html.indexOf('id="all-controls"'),start=html.indexOf('id="start-playing"');
  assert.ok(start>0&&more>start,'the start button comes first');
  for(const id of ['camera-toggle','irc-start','overlay-toggle','synthetic-cross','pause','auto-drops','swat','face-mosquito'])assert.ok(html.indexOf(`id="${id}"`)>more,`${id} is under More options`);
});

test('UX-06 the round banner carries the grade and the demo mosquito never books a bite',()=>{
  assert.match(app,/banner=\{text:`ROUND OVER · SCORE \$\{snapshot\.score\}`,at:now,grade\}/);
  assert.match(app,/mosquitoDemo&&result\.outcome==='BITE'/);assert.match(app,/outcome:'UNKNOWN',reason:'TUTORIAL_BITE'/);
});
