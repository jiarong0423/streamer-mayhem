import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const dist=resolve(dirname(fileURLToPath(import.meta.url)),'../dist');
const modules=readdirSync(dist).filter(f=>f.endsWith('.mjs'));

test('STATIC-01 every dist module parses',()=>{
  for(const f of modules)assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',resolve(dist,f)],{stdio:'pipe'}),f);
});

// Page code (app.mjs, overlay.mjs) cannot run under Node, so this catches the class of mistake that once swallowed a declaration into a trailing comment:
// every top-level `let`/`const` name that the page code uses must be declared on a line that is not inside a `//` comment.
test('STATIC-02 a declaration is never hidden behind a trailing // comment on the same line',()=>{
  for(const f of ['app.mjs','overlay.mjs']){
    const lines=readFileSync(resolve(dist,f),'utf8').split('\n');
    lines.forEach((line,i)=>{
      const code=line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g,'""');                  // blank out string literals first
      const m=/\/\/(.*)$/.exec(code);
      if(!m)return;
      assert.equal(/[A-Za-z.;)](let|const)\s+[A-Za-z_$][\w$]*\s*=/.test(m[1]),false,`${f}:${i+1} has a keyword glued to the end of a // comment`);
      assert.equal(/(^|[;\s])(let|const|function)\s+[A-Za-z_$][\w$]*\s*[=(;]/.test(m[1]),false,`${f}:${i+1} has a declaration inside a // comment: ${line.trim().slice(0,100)}`);
    });
  }
});
