// Explicitly scoped OBS synthetic-scene runner; never starts streaming or recording.
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,open} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {guardOwnedChild,sampleOwnedTree,sampleDisk} from './obs-resource-guard.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scratch=resolve(root,'output/isolation/current_runs/20261027_streamer_mayhem_mvp/obs_synthetic');
const config=process.env.OBS_CONFIG_DIR||(process.env.HOME+'/Library/Application Support/obs-studio');
const executable=resolve(scratch,'OBS.app/Contents/MacOS/OBS');
const profile=resolve(config,'basic/profiles/StreamerMayhem-Synthetic/basic.ini');
const logPath=resolve(root,'logs/runtime/obs_guard_runtime.log');const exec=promisify(execFile);
let log,guard,child;
try {
  if(process.argv.length!==2)throw new Error('No arguments accepted');
  const ini=await readFile(profile,'utf8');
  for(const entry of ['Name=StreamerMayhem-Synthetic','BaseCX=1280','BaseCY=720','OutputCX=1280','OutputCY=720','FPSCommon=30'])if(!ini.split(/\r?\n/).includes(entry))throw new Error('TEST_PROFILE_INVALID');
  try {const found=await exec('/usr/bin/pgrep',['-x','OBS'],{timeout:1500});if(found.stdout.trim())throw new Error('OTHER_OBS_RUNNING');}
  catch(error){if(error.message==='OTHER_OBS_RUNNING')throw error;if(error.code!==1||String(error.stderr??'').trim())throw new Error('OBS_PROCESS_CHECK_FAILED');}
  await exec('/usr/bin/codesign',['--verify','--deep','--strict',resolve(scratch,'OBS.app')],{timeout:20000,maxBuffer:65536});
  const metrics=await sampleOwnedTree(process.pid),disk=await sampleDisk([scratch,config]);if(metrics.rss<=0 || disk>=2048*1024*1024)throw new Error('RESOURCE_PREFLIGHT_FAILED');
  log=await open(logPath,'a',0o600);
  const record=message=>{const line=`${new Date().toISOString()} ${message}\n`;process.stdout.write(line);log.write(line).catch(()=>{});};
  child=spawn(executable,['--safe-mode','--disable-updater','--only-bundled-plugins','--disable-missing-files-check','--profile','StreamerMayhem-Synthetic'],{stdio:'ignore'});
  child.on('error',()=>{});if(!child.pid)throw new Error('OBS_SPAWN_FAILED');
  record(`START owned_pid=${child.pid} profile=StreamerMayhem-Synthetic`);
  guard=guardOwnedChild(child,{scratchPath:[scratch,config],onLog:record});
  for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>guard.stop('OPERATOR_STOP'));
  const result=await guard.result;
  if(result.reason!=='NORMAL'&&result.reason!=='OPERATOR_STOP')process.exitCode=1;
  else if(result.reason==='NORMAL'&&result.code!==0)process.exitCode=1;
  await log.close();
}catch(error){if(child?.pid&&!child.killed)child.kill('SIGTERM');try{await log?.close();}catch{}process.stderr.write(`FAIL OBS runner: ${error.message}\n`);process.exitCode=1;}
