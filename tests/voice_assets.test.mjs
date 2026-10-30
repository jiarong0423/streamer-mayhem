import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,statSync} from 'node:fs';
const clips=['good_shot','nice_shot','three_points','thanks','pie_alarm'];
test('VOICE-01 (theme) the announcer clips exist, are small mono 24 kHz PCM WAV files and are referenced by the app and the local server',()=>{
  const app=readFileSync(new URL('../dist/app.mjs',import.meta.url),'utf8'),server=readFileSync(new URL('../scripts/serve-local.mjs',import.meta.url),'utf8');
  for(const name of clips){
    const path=new URL(`../dist/voice/${name}.wav`,import.meta.url);assert.ok(existsSync(path),`${name} exists`);
    const b=readFileSync(path);assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');
    assert.equal(b.readUInt16LE(22),1,'mono');assert.equal(b.readUInt32LE(24),24000,'24 kHz');assert.ok(statSync(path).size<200000,'small');
    assert.ok(app.includes(name),`${name} is used by app.mjs`);assert.ok(server.includes(`${name}.wav`),`${name} is served`);
  }
  assert.ok(existsSync(new URL('../dist/voice/NOTICE.md',import.meta.url)));
});
