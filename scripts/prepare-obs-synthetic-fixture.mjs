// Reproducible, offline, CPU-only 1280×720 image for a future OBS test scene.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const target=resolve(root,'output/isolation/current_runs/20261027_streamer_mayhem_mvp/obs_synthetic/background.png');
const width=1280,height=720;
function crc32(buf){let crc=0xffffffff;for(const byte of buf){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(name,data){const label=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([label,data])));return Buffer.concat([length,label,data,checksum]);}
function color(x,y){
  let c=(Math.floor(x/80)+Math.floor(y/80))%2?[35,52,74]:[50,70,91];
  if(x>=64&&x<384&&y>=414&&y<594){
    c=[26,92,117];
    if(x<68||x>=380||y<418||y>=590)c=[255,221,60];
    const localX=x-64,localY=y-414;
    for(let row=0;row<3;row++)for(let col=0;col<3;col++){
      const cx=(col+.5)*320/3,cy=(row+.5)*60;
      if(Math.abs(localX-cx)<4&&Math.abs(localY-cy)<4)c=[255,100+row*50,80+col*60];
    }
  }
  return c;
}
try {
  if(process.argv.length!==2)throw new Error('No arguments are accepted');
  const raw=Buffer.alloc((width*3+1)*height);for(let y=0;y<height;y++){const offset=y*(width*3+1);raw[offset]=0;for(let x=0;x<width;x++){const rgb=color(x,y),p=offset+1+x*3;raw[p]=rgb[0];raw[p+1]=rgb[1];raw[p+2]=rgb[2];}}
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw,{level:6})),chunk('IEND',Buffer.alloc(0))]);
  await mkdir(dirname(target),{recursive:true});let previous=null;try{previous=await readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous&&!previous.equals(png))throw new Error('Existing fixture differs; refusing overwrite');
  if(!previous)await writeFile(target,png,{flag:'wx'});
  process.stdout.write(`PASS synthetic background ${width}x${height}; ${png.length} bytes; sha256 ${createHash('sha256').update(png).digest('hex')}; ${previous?'unchanged':'created'}\n`);
} catch(error){process.stderr.write(`FAIL fixture: ${error.message}\n`);process.exitCode=1;}
