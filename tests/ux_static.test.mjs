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

test('UX-02 sound is on by default but only from a click: nothing in the page code enables audio outside a click handler',()=>{
  const clicks=[...app.matchAll(/\.setEnabled\(true\)/g)].length;assert.equal(clicks,2,'only the sound button and the first Start click turn sound on');
  assert.match(app,/\$\('#start-playing'\)\.addEventListener\('click',\(\)=>\{[\s\S]*?localStorage\.getItem\(SFX_KEY\)[\s\S]*?sfx\.setEnabled\(true\)/);
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
  for(const id of ['camera-toggle','irc-start','overlay-toggle','synthetic-cross','pause','auto-drops'])assert.ok(html.indexOf(`id="${id}"`)>more,`${id} is under More options`);
});

test('UX-06 the round banner carries the grade',()=>{
  assert.match(app,/banner=\{text:`ROUND OVER · SCORE \$\{snapshot\.score\}[^`]*`,at:now,grade\}/);   // theme: the banner may end with who won
});

test('UX-07 the page text names the basketball commands and does not claim live chat while simulated',()=>{
  assert.doesNotMatch(html,/LIVE TWITCH CHAT/,'static label must not say LIVE');
  assert.doesNotMatch(html,/<code>!throw 1<\/code> to <code>!throw 9<\/code>/,'onboarding and rules use !drop and !pie');
  assert.match(html,/<code>!drop 1<\/code> to <code>!drop 3<\/code>/);assert.match(html,/<code>!pie 1<\/code> to <code>!pie 3<\/code>/);
  assert.doesNotMatch(html,/id="synthetic-mosquito"/,'the dead Mosquito button is gone');
  assert.doesNotMatch(app,/synthetic-mosquito|send\('!mosquito'\)/,'and nothing in the page code looks for it');
});

test('F-dead the face-mosquito and swat controls are gone from the page, and the user-visible texts no longer name removed commands',()=>{
  for(const id of ['face-mosquito','swat','swat-meter','swat-test'])assert.doesNotMatch(html,new RegExp(`id="${id}"`),`#${id} is gone`);
  assert.doesNotMatch(app,/MOSQUITO_ENABLED|FaceMosquito|MotionProbe/);
  const reasons=/INVALID_COMMAND:'([^']*)'/.exec(app)[1];assert.match(reasons,/!drop/);assert.match(reasons,/!pie/);assert.doesNotMatch(reasons,/!throw|!mosquito|!lava|!freeze/);
  assert.doesNotMatch(app,/1\.5 s to get under/);assert.doesNotMatch(app,/the grid now covers/);assert.doesNotMatch(app,/!bomb|OBS overlay carries the sound/);
  assert.doesNotMatch(app,/Wait a moment before throwing/);
});
