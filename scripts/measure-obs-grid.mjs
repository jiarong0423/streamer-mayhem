// Measure OBS's rendered grid against the nine colored fixture markers.
// All three inputs must be task-owned, native-resolution OBS PNG screenshots.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const captureRoot=resolve(root,'output/isolation/current_runs/20261027_streamer_mayhem_mvp/obs_synthetic/alignment/captures');
const ffmpeg=process.env.OBS_GRID_FFMPEG||'/opt/homebrew/bin/ffmpeg';
const ffprobe=process.env.OBS_GRID_FFPROBE||'/opt/homebrew/bin/ffprobe';
const width=1280,height=720,channels=3,threshold=2;

async function loadScreenshot(path){
  const resolved=await realpath(path),rel=relative(captureRoot,resolved);
  if(!rel||rel.startsWith('..')||resolve(captureRoot,rel)!==resolved||!resolved.toLowerCase().endsWith('.png'))throw new Error('INPUT_OUTSIDE_CAPTURE_DIRECTORY');
  const metadata=execFileSync(ffprobe,['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','csv=p=0:s=x',resolved],{encoding:'utf8',timeout:5000}).trim();
  if(metadata!=='1280x720')throw new Error(`INVALID_IMAGE_SIZE ${metadata}`);
  const pixels=execFileSync(ffmpeg,['-v','error','-i',resolved,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{maxBuffer:width*height*channels+65536,timeout:10000});
  if(pixels.length!==width*height*channels)throw new Error('INVALID_PIXEL_BUFFER');
  return {path:resolved,pixels,sha256:createHash('sha256').update(await readFile(resolved)).digest('hex')};
}

function referenceMarkers(base){
  const markers=[];
  for(let row=0;row<3;row++)for(let col=0;col<3;col++){
    const expectedX=64+(col+.5)*320/3,expectedY=414+(row+.5)*60;
    const color=[255,100+row*50,80+col*60];let sx=0,sy=0,n=0;
    for(let y=Math.floor(expectedY-8);y<=Math.ceil(expectedY+8);y++)for(let x=Math.floor(expectedX-8);x<=Math.ceil(expectedX+8);x++){
      const p=(y*width+x)*channels;
      if(color.every((v,i)=>base[p+i]===v)){sx+=x+.5;sy+=y+.5;n++;}
    }
    if(n<16)throw new Error(`REFERENCE_MARKER_MISSING cell=${row*3+col+1} pixels=${n}`);
    markers.push({cell:row*3+col+1,x:sx/n,y:sy/n,pixels:n});
  }
  return markers;
}

function lineCenter(base,overlay,orientation,nominal,range,edge){
  let weighted=0,total=0,peak=0;
  const radius=edge?3:6;
  for(let pos=Math.floor(nominal-radius);pos<=Math.ceil(nominal+radius);pos++){
    let strength=0;
    const [start,end]=range;
    for(let k=start;k<=end;k++){
      const x=orientation==='x'?pos:k,y=orientation==='x'?k:pos,p=(y*width+x)*channels;
      strength+=edge?Math.abs(overlay[p]-base[p]):Math.max(0,overlay[p]-base[p]);
    }
    weighted+=(pos+.5)*strength;total+=strength;peak=Math.max(peak,strength);
  }
  if(total<400||peak<250)throw new Error(`GRID_LINE_MISSING axis=${orientation} nominal=${nominal} strength=${total}`);
  // The outer stroke is clipped at the rectangle edge, so its single visible
  // pixel is centered half a pixel inside the geometric boundary.
  return weighted/total+(edge==='start'?-.5:edge==='end'?.5:0);
}

function measure(base,overlay,markers){
  const xNominal=[64,64+320/3,64+640/3,384],yNominal=[414,474,534,594];
  const rowRanges=[[432,458],[492,518],[552,578]],colRanges=[[90,145],[195,250],[300,355]];
  const edges=[ 'start',null,null,'end' ];
  const xs=rowRanges.map(range=>xNominal.map((v,i)=>lineCenter(base,overlay,'x',v,range,edges[i])));
  const ys=colRanges.map(range=>yNominal.map((v,i)=>lineCenter(base,overlay,'y',v,range,edges[i])));
  for(const boundaries of xs)for(let i=0;i<3;i++)if(boundaries[i+1]-boundaries[i]<100||boundaries[i+1]-boundaries[i]>113)throw new Error('GRID_SPACING_INVALID_X');
  for(const boundaries of ys)for(let i=0;i<3;i++)if(boundaries[i+1]-boundaries[i]<55||boundaries[i+1]-boundaries[i]>65)throw new Error('GRID_SPACING_INVALID_Y');
  const cells=markers.map((m,i)=>{
    const row=Math.floor(i/3),col=i%3,x=(xs[row][col]+xs[row][col+1])/2,y=(ys[col][row]+ys[col][row+1])/2;
    const dx=x-m.x,dy=y-m.y;return {...m,gridX:x,gridY:y,dx,dy,error:Math.hypot(dx,dy)};
  });
  return {xs,ys,cells,maxError:Math.max(...cells.map(c=>c.error))};
}

function shiftedOverlay(base,overlay,dx){
  // Negative control: translate the measured OBS overlay delta; preserve reference markers.
  const out=Buffer.from(base);
  for(let y=410;y<598;y++)for(let x=58;x<390;x++){
    const from=x-dx;if(from<0||from>=width)continue;
    for(let c=0;c<channels;c++){
      const dst=(y*width+x)*channels+c,src=(y*width+from)*channels+c;
      out[dst]=Math.max(0,Math.min(255,base[dst]+overlay[src]-base[src]));
    }
  }
  return out;
}

try{
  if(process.argv.length!==5)throw new Error('USAGE: node scripts/measure-obs-grid.mjs REFERENCE.png OVERLAY_720.png OVERLAY_1080.png');
  const [reference,small,large]=await Promise.all(process.argv.slice(2).map(loadScreenshot));
  const markers=referenceMarkers(reference.pixels),results=[measure(reference.pixels,small.pixels,markers),measure(reference.pixels,large.pixels,markers)];
  let rejectedMissing=false;try{measure(reference.pixels,reference.pixels,markers);}catch(e){if(!String(e.message).startsWith('GRID_LINE_MISSING'))throw e;rejectedMissing=true;}
  if(!rejectedMissing)throw new Error('NEGATIVE_CONTROL_MISSING_OVERLAY_ACCEPTED');
  const shifted=measure(reference.pixels,shiftedOverlay(reference.pixels,small.pixels,3),markers);
  if(shifted.maxError<=threshold)throw new Error('NEGATIVE_CONTROL_SHIFT_NOT_DETECTED');
  console.log('coordinate_system=1280x720 OBS output, pixel centers at index+0.5; error=Euclidean distance in output pixels');
  for(const [label,shot] of [['reference',reference],['source_1280x720',small],['source_1920x1080_fit',large]])console.log(`${label}=${shot.path} sha256=${shot.sha256}`);
  console.log(`negative_controls=PASS missing_overlay=REJECTED shifted_3px_max=${shifted.maxError.toFixed(3)}px`);
  for(let i=0;i<results.length;i++){
    const r=results[i],label=i===0?'source_1280x720':'source_1920x1080_fit';
    r.xs.forEach((values,row)=>console.log(`${label} row=${row+1} vertical_boundaries=${values.map(x=>x.toFixed(3)).join(',')}`));
    r.ys.forEach((values,col)=>console.log(`${label} col=${col+1} horizontal_boundaries=${values.map(y=>y.toFixed(3)).join(',')}`));
    for(const c of r.cells)console.log(`${label} cell=${c.cell} marker=(${c.x.toFixed(3)},${c.y.toFixed(3)}) grid=(${c.gridX.toFixed(3)},${c.gridY.toFixed(3)}) delta=(${c.dx.toFixed(3)},${c.dy.toFixed(3)}) error=${c.error.toFixed(3)}px`);
    console.log(`${label} max_error=${r.maxError.toFixed(3)}px limit=${threshold}px result=${r.maxError<=threshold?'PASS':'FAIL'}`);
  }
  if(results.some(r=>r.maxError>threshold))process.exitCode=1;
}catch(error){console.error(`FAIL OBS alignment: ${error.message}`);process.exitCode=1;}
