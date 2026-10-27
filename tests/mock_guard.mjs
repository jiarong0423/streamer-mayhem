import {spawnSync} from 'node:child_process';

// Fail before connecting if the CLI RPC listener is not exclusively loopback.
export async function assertRpcLoopback(pid) {
  for(let i=0;i<60;i++) {
    const result=spawnSync('lsof',['-nP','-a','-p',String(pid),'-iTCP:44747','-sTCP:LISTEN'],{encoding:'utf8',timeout:1000});
    const lines=result.stdout?.split('\n').filter(line=>line.includes('LISTEN'))??[];
    if(lines.length){if(lines.length!==1 || !lines[0].includes('127.0.0.1:44747'))throw new Error('RPC_LISTENER_NOT_LOOPBACK');return;}
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  throw new Error('RPC_LISTENER_UNAVAILABLE');
}
