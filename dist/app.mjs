import { MatrixGame } from './matrix.mjs';
import { EventSubAdapter, syntheticChat, syntheticWelcome } from './eventsub_adapter.mjs';
import { MockEventSubTransport } from './mock_eventsub_transport.mjs';
import { MockOAuth } from './mock_oauth.mjs';
import { AuthPopupController } from './auth_popup_controller.mjs';
import { TwitchProvider, LOCAL_CONFIG, LIVE_NETWORK_ENABLED, validateProviderConfig } from './twitch_provider.mjs';
import { ProviderActivation } from './provider_activation.mjs';
import { drawArena } from './arena_draw.mjs';
import {createCameraGeometry,projectCameraPoint,projectCameraFrame,canvasPointToSource,visiblePointToCanvas} from './camera_geometry.mjs';
import {makeOverlayState,OVERLAY_CLOSED_TYPE} from './overlay_protocol.mjs';
import {SyntheticFrameSource} from './frame_source.mjs';

const $ = selector => document.querySelector(selector);
const canvas=$('#arena'),ctx=canvas.getContext('2d');
const player={x:.5,y:.5};
const poseControls={spread:.1,hip:.5,leftWrist:{x:.25,y:.55},rightWrist:{x:.75,y:.55}};
const challengeNames={CROSS:'烈焰大十字',FREEZE:'定格挑戰',MOSQUITO:'拍蚊子',LAVA:'熔岩'};
let cameraGeometry=createCameraGeometry({canvasWidth:canvas.width,canvasHeight:canvas.height,viewport:{x:0,y:0,width:canvas.width,height:canvas.height},sourceWidth:1280,sourceHeight:720});
let eventId=0,tracking=true,lastEffect=null,animationId=0,mockMode=false,chatMode=false,providerActivation=null,configuredProvider=null;
let overlaySession=null,overlaySequence=0,lastOverlayUpdate=0,overlayInFlight=0,overlayEnabled=false;
const modeNames={IDLE:'準備就緒',PLAYING:'進行中',PAUSED:'已暫停',TRACKING_LOST:'追蹤失效',RECOVERING:'準備中',ROUND_END:'回合結束'};
const reasons={MODE_BUSY:'請先完成目前挑戰',POSE_UNKNOWN:'關節不足或水位已到上限，請恢復對應關節',FREEZE_COOLDOWN:'定格挑戰冷卻中',GAME_COOLDOWN:'這個遊戲仍在冷卻',INVALID_LEVEL:'熔岩水位須介於 0.1 與 0.8',INVALID_COMMAND:'請輸入 !throw 1–9、!freeze、!mosquito 或 !lava',ACTOR_COOLDOWN:'這位觀眾稍後再試',GLOBAL_COOLDOWN:'請稍等一下再投擲',QUEUE_FULL:'攻擊佇列已滿',OFFLINE:'模擬聊天室已斷線',NOT_PLAYING:'遊戲目前無法接收攻擊',DUPLICATE:'已略過重複事件',INVALID_EVENT:'模擬事件格式錯誤'};

function feed(title,detail) {
  const li=document.createElement('li'),dot=document.createElement('span'),body=document.createElement('div');
  const name=document.createElement('b'),description=document.createElement('small'),time=document.createElement('time');
  dot.className='feed-dot';name.textContent=title;description.textContent=detail;time.textContent='NOW';
  body.append(name,description);li.append(dot,body,time);const list=$('#activity');list.prepend(li);
  while(list.children.length>3)list.lastElementChild.remove();
}

const game=new MatrixGame({onEvent:event=>{
  if(event.type==='result'){
    lastEffect={outcome:event.outcome,at:performance.now()};
    feed(event.outcome==='HIT'?'哎呀，命中了！':event.outcome==='DODGE'?'漂亮閃躲':'無法判定',`${challengeNames[event.kind]??`目標格 ${event.cell}`} · ${event.outcome}`);
  } else if(event.type==='lavaBurn')feed('熔岩灼傷',`生命 ${event.hpDelta} · 站起避開水位`);
  else if(event.type==='ringOut')feed('角色離開範圍','出界扣血');
}});
const frameSource=new SyntheticFrameSource({game,maxAge:game.config.maxAge,project:frame=>cameraGeometry?projectCameraFrame(frame,cameraGeometry):{...frame,nose:null,leftShoulder:null,rightShoulder:null}});
game.beforeTick=()=>frameSource.sync();
const adapter=new EventSubAdapter({game,onStatus:status=>{
  if(mockMode||chatMode||providerActivation)return;
  const online=status==='SIMULATED_ONLINE';$('#connection-badge').textContent=online?'模擬連線中':'模擬已斷線';
  $('#connection').textContent=online?'↯ 模擬斷線':'↻ 恢復模擬';
}});
const oauth=new MockOAuth();
const chatTransport=new MockEventSubTransport({adapter,oauth,profile:'chat',onStatus:(status,detail)=>{
  const labels={CONNECTING:'本機聊天室連線中',SUBSCRIBING:'本機聊天室訂閱中',ONLINE:'本機聊天室已訂閱',MIGRATING:'本機訂閱遷移中',RETRYING:'本機聊天室重連中',STOPPED:'本機聊天室已停止'};
  if(chatMode)$('#connection-badge').textContent=labels[status]??status;
  if(detail==='AUTH_REQUIRED')feed('模擬授權已失效','請停止並重新授權');
},onDelivery:result=>{if(result.accepted)feed('本機聊天室投出攻擊',`!throw ${result.cell} · 0.5 秒警報`);}});
const popupController=location.origin==='http://127.0.0.1:4173'?new AuthPopupController({oauth,origin:location.origin,
  openWindow:url=>window.open(url,'streamer-mayhem-local-auth','popup,width=520,height=420'),
  onState:state=>{
    if(state==='PENDING'){$('#mock-toggle').disabled=true;$('#auth-mock-toggle').textContent='取消本機授權';syncProviderControls();}
    else if(['CANCELLED','CLOSED','DENIED','FAILED','BLOCKED'].includes(state)){
      $('#mock-toggle').disabled=false;$('#auth-mock-toggle').textContent='啟動本機聊天室授權測試';syncProviderControls();
      if(state==='CANCELLED'||state==='CLOSED')feed('本機授權已取消','可重新開始測試');
      else feed('本機模擬授權未完成',state==='DENIED'?'使用者拒絕授權':state==='BLOCKED'?'請允許此本機頁面的彈出視窗':'授權驗證失敗');
    }
  },
  onSuccess:()=>{chatMode=true;$('#connection').disabled=true;$('#mock-toggle').disabled=true;$('#auth-mock-toggle').textContent='停止本機聊天室測試';syncProviderControls();chatTransport.start();}
}):null;
const transport=new MockEventSubTransport({adapter,onStatus:(status,detail)=>{
  const labels={CONNECTING:'CLI 連線中',SUBSCRIBING:'CLI 訂閱中',ONLINE:'CLI mock 已連線',MIGRATING:'CLI 訂閱遷移中',RETRYING:'CLI 重新連線中',STOPPED:'CLI 已停止'};
  if(mockMode)$('#connection-badge').textContent=status==='RETRYING' && detail.startsWith('SUBSCRIPTION_')?'CLI 訂閱失敗，重試中':labels[status]??status;
  if(detail==='REVOKED')feed('mock 訂閱已撤銷','已停止自動重連');
},onDelivery:result=>{
  if(result.accepted)feed('本機 mock 投出攻擊',`!throw ${result.cell} · 0.5 秒警報`);
}});

// Synthetic state is relayed only through the same loopback server, in memory.
try {
  if(typeof crypto?.getRandomValues!=='function')throw new Error('SECURE_RANDOM_UNAVAILABLE');
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);overlaySession=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  $('#overlay-link').removeAttribute('href');
} catch {overlaySession=null;$('#overlay-link').removeAttribute('href');$('#overlay-hint').textContent='此瀏覽器無法使用合成頁面同步。';}
function publishOverlay(snapshot,{force=false}={}){
  if(!overlayEnabled||!overlaySession||(overlayInFlight&&!force))return;
  const sourcePoint=snapshot.mode==='PLAYING'&&frameSource.running&&cameraGeometry?frameSource.lastFrame?.nose??null:null;
  const message=makeOverlayState({session:overlaySession,sequence:++overlaySequence,geometry:cameraGeometry,snapshot,sourcePoint});
  overlayInFlight++;fetch('./__overlay/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(message),credentials:'omit',redirect:'error',signal:AbortSignal.timeout(1000)}).then(response=>{if(!response.ok)throw new Error('RELAY_UNAVAILABLE');if(overlayEnabled)$('#overlay-hint').textContent='本機合成資料已送出；保持此控制頁開啟。';}).catch(()=>{if(overlayEnabled)$('#overlay-hint').textContent='本機疊圖中轉無法連線，請確認本機服務。';}).finally(()=>{overlayInFlight--;});
}

function stopOverlaySync(){
  if(!overlayEnabled)return;overlayEnabled=false;
  fetch('./__overlay/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:OVERLAY_CLOSED_TYPE,session:overlaySession,sequence:++overlaySequence}),credentials:'omit',redirect:'error',keepalive:true}).catch(()=>{});
  $('#overlay-link').removeAttribute('href');$('#overlay-toggle').textContent='啟用本機合成疊圖同步';$('#overlay-hint').textContent='合成疊圖同步已停止。';
}
$('#overlay-toggle').addEventListener('click',()=>{
  if(overlayEnabled){stopOverlaySync();return;}
  if(!overlaySession){$('#overlay-hint').textContent='此瀏覽器無法使用合成頁面同步。';return;}
  overlayEnabled=true;const link=new URL('./overlay.html',location.href);link.search=new URLSearchParams({mode:'synthetic',session:overlaySession}).toString();$('#overlay-link').href=link.href;
  $('#overlay-toggle').textContent='停止本機合成疊圖同步';$('#overlay-hint').textContent='正在連接本機合成疊圖。';publishOverlay(game.tick());
});

function addSyntheticFrame(){
  const visible=tracking&&cameraGeometry?projectCameraPoint({...player,visibility:1},cameraGeometry):null;
  const source=p=>{
    if(!visible||!p)return null;
    const mapped=canvasPointToSource(visiblePointToCanvas(p,cameraGeometry),cameraGeometry);
    return mapped?{...mapped,visibility:1}:null;
  };
  const nose=visible?{...player,visibility:1}:null;
  const leftShoulder=visible?source({x:visible.x-.06,y:visible.y+.1}):null;
  const rightShoulder=visible?source({x:visible.x+.06,y:visible.y+.1}):null;
  const elbows=$('#elbow-known').checked,hands=$('#wrist-known').checked,hips=$('#hip-known').checked;
  return frameSource.capture({nose,leftShoulder,rightShoulder,
    leftElbow:visible&&elbows?source({x:visible.x-poseControls.spread,y:visible.y+.2}):null,
    rightElbow:visible&&elbows?source({x:visible.x+poseControls.spread,y:visible.y+.2}):null,
    leftWrist:hands?source(poseControls.leftWrist):null,rightWrist:hands?source(poseControls.rightWrist):null,
    leftHip:visible&&hips?source({x:visible.x-.035,y:poseControls.hip}):null,
    rightHip:visible&&hips?source({x:visible.x+.035,y:poseControls.hip}):null});
}

function updateScreen(snapshot){
  const mode=modeNames[snapshot.mode]??snapshot.mode;if($('#game-status').textContent!==mode)$('#game-status').textContent=mode;
  $('#health').textContent=String(snapshot.hp);$('#health-fill').style.width=`${snapshot.hp}%`;
  $('#score').textContent=String(snapshot.score).padStart(3,'0');
  $('#last-result').textContent=snapshot.lastResult?.outcome??'—';
  $('#pause').textContent=snapshot.mode==='PAUSED'?'▶ 繼續遊戲':'Ⅱ 暫停遊戲';
  $('#tracking').textContent=tracking?'◎ 模擬失追':'◎ 恢復追蹤';
  const sourceStatus=!frameSource.running?'合成影格已中斷':snapshot.mode==='RECOVERING'?'合成影格恢復中':frameSource.lastFrame?'合成影格更新中':'合成影格等待中';
  if($('#frame-source-status').textContent!==sourceStatus)$('#frame-source-status').textContent=sourceStatus;
  const challenge=snapshot.freeze?.active?snapshot.freeze:snapshot.actionGame?.active?snapshot.actionGame:null;
  const kind=snapshot.freeze?.active?'FREEZE':challenge?.kind;
  $('#challenge-status').textContent=challenge?`${challengeNames[kind]} · ${challenge.status} · ${(challenge.remainingMs/1000).toFixed(1)} 秒${challenge.recoveryRemaining?` · 準備 ${(challenge.recoveryRemaining/1000).toFixed(1)} 秒`:''}`:'選擇遊戲開始；同時只進行一種挑戰。';
  canvas.dataset.challenge=kind??'';canvas.dataset.phase=challenge?.phase??challenge?.status??'';canvas.dataset.lastKind=snapshot.lastResult?.kind??'';
  $('#frame-source-toggle').textContent=frameSource.running?'模擬影格中斷':'恢復合成影格';
}

function loop(){
  const now=performance.now();addSyntheticFrame();const snapshot=game.tick();
  drawArena(ctx,snapshot,frameSource.lastFrame?.nose??null,{now,lastEffect,tracking:frameSource.running&&Boolean(frameSource.lastFrame?.nose),geometry:cameraGeometry});updateScreen(snapshot);
  if(now-lastOverlayUpdate>=100){lastOverlayUpdate=now;publishOverlay(snapshot);}
  animationId=requestAnimationFrame(loop);
}

function send(text){
  const command=typeof text==='string'?text.trim():'';
  if(/^!freeze$/i.test(command)){sendChallenge('FREEZE');return;}
  if(/^!mosquito$/i.test(command)){sendChallenge('MOSQUITO');return;}
  const lava=/^!lava(?:\s+(0\.[1-8]))?$/i.exec(command);
  if(lava){sendChallenge('LAVA',lava[1]?Number(lava[1]):.45);return;}
  const serial=++eventId;
  const result=adapter.ingest(syntheticChat({notificationId:`notification-${serial}`,messageId:`message-${serial}`,
    actorId:`viewer-${serial%16}`,text}));
  const feedback=$('#command-feedback');
  if(result.accepted){feedback.textContent=`合成指令已送出：目標 ${result.cell} 號格`;feed('觀眾投出攻擊',`!throw ${result.cell} · 0.5 秒警報`);}
  else feedback.textContent=reasons[result.reason]??'事件無法處理';
}

function move(dx,dy){
  if(!cameraGeometry)return;
  const mapped=projectCameraPoint({...player,visibility:1},cameraGeometry)??{x:.5,y:.5};
  const visible={x:Math.max(1/6,Math.min(5/6,mapped.x+dx/3)),y:Math.max(1/6,Math.min(5/6,mapped.y+dy/3))};
  const source=canvasPointToSource(visiblePointToCanvas(visible,cameraGeometry),cameraGeometry);if(source)Object.assign(player,source);
}
const movement={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]};
document.querySelectorAll('[data-move]').forEach(button=>button.addEventListener('click',()=>move(...movement[button.dataset.move])));
document.querySelectorAll('[data-throw]').forEach(button=>button.addEventListener('click',()=>send(`!throw ${button.dataset.throw}`)));
$('#synthetic-cross').addEventListener('click',()=>{
  if(mockMode||chatMode||providerActivation)return;
  const serial=++eventId;
  const result=game.receiveSyntheticCross({notificationId:`notification-${serial}`,messageId:`message-${serial}`,
    actorId:'synthetic-cross-viewer',receivedAt:performance.now()});
  $('#command-feedback').textContent=result.accepted?'烈焰大十字！1.5 秒內移到四角 1、3、7、9。':reasons[result.reason]??'事件無法處理';
  if(result.accepted)feed('合成烈焰大十字','1.5 秒警報 · 四角安全 · 單次判定');
});
function sendChallenge(kind,level=.45){
  if(mockMode||chatMode||providerActivation||popupController?.pending){$('#command-feedback').textContent='合成挑戰請先停止本機聊天室授權測試';return;}
  const serial=++eventId,event={notificationId:`notification-${serial}`,messageId:`message-${serial}`,actorId:`synthetic-${kind}-viewer`,receivedAt:performance.now()};
  const result=kind==='FREEZE'?game.receiveSyntheticFreeze(event):kind==='MOSQUITO'?game.receiveSyntheticMosquito(event):game.receiveSyntheticLava(event,{level});
  $('#command-feedback').textContent=result.accepted?`${challengeNames[kind]}${result.raised?'水位已提高':'已開始'}`:reasons[result.reason]??'事件無法處理';
  if(result.accepted)feed(challengeNames[kind],result.raised?'提高目標水位':'使用合成關節操作');
}
for(const [id,kind] of [['synthetic-freeze','FREEZE'],['synthetic-mosquito','MOSQUITO'],['synthetic-lava','LAVA']])$(`#${id}`).addEventListener('click',()=>sendChallenge(kind));
$('#elbow-spread').addEventListener('input',()=>{poseControls.spread=Number($('#elbow-spread').value)/100;$('#elbow-value').textContent=`${Math.round(poseControls.spread*100)}%`;});
$('#hip-stand').addEventListener('click',()=>{poseControls.hip=.5;});
$('#hip-crouch').addEventListener('click',()=>{poseControls.hip=.93;});
$('#synthetic-clap').addEventListener('click',()=>{
  const p={x:(poseControls.leftWrist.x+poseControls.rightWrist.x)/2,y:(poseControls.leftWrist.y+poseControls.rightWrist.y)/2};
  poseControls.leftWrist={...p,x:p.x-.015};poseControls.rightWrist={...p,x:p.x+.015};
});
$('#chat-form').addEventListener('submit',event=>{event.preventDefault();send($('#chat-input').value);});
$('#calibration-form').addEventListener('input',()=>{$('#calibration-status').textContent='設定已變更；請按套用校準。';});
$('#calibration-form').addEventListener('submit',event=>{
  event.preventDefault();game.invalidateTracking();frameSource.reset();lastEffect=null;
  const percent=id=>{const element=$(`#${id}`);if(element.value.trim()==='')throw new Error('EMPTY_VALUE');return Number(element.value)/100;};
  try {
    const aspect=$('#cal-aspect').value;const dimensions=aspect==='16:9'?[1280,720]:aspect==='4:3'?[640,480]:null;
    if(!dimensions)throw new Error('INVALID_ASPECT');
    cameraGeometry=createCameraGeometry({canvasWidth:canvas.width,canvasHeight:canvas.height,
      viewport:{x:percent('cal-x')*canvas.width,y:percent('cal-y')*canvas.height,width:percent('cal-width')*canvas.width,height:percent('cal-height')*canvas.height},
      sourceWidth:dimensions[0],sourceHeight:dimensions[1],
      crop:{left:percent('crop-left'),right:percent('crop-right'),top:percent('crop-top'),bottom:percent('crop-bottom')},
      fit:$('#cal-fit').value,rotation:Number($('#cal-rotation').value),mirror:$('#cal-mirror').checked});
    const center=canvasPointToSource(visiblePointToCanvas({x:.5,y:.5},cameraGeometry),cameraGeometry);Object.assign(player,center);
    $('#calibration-status').textContent='校準已套用；追蹤恢復後繼續。';
  } catch {cameraGeometry=null;$('#calibration-status').textContent='校準無效：請確認區域在畫面內、寬高大於零，裁切比例總和小於 100%。';}
});
$('#provider-form').addEventListener('input',()=>{configuredProvider=null;$('#provider-feedback').textContent='設定已變更，請重新驗證。';syncProviderControls();});
$('#provider-form').addEventListener('submit',event=>{
  event.preventDefault();configuredProvider=null;
  try {
    configuredProvider=validateProviderConfig({clientId:$('#provider-client-id').value.trim(),channelId:$('#provider-channel-id').value.trim(),redirectUri:$('#provider-callback').value.trim()});
    $('#provider-feedback').textContent='設定已驗證；正式連線仍鎖定。';
  } catch(error) {
    const errors={INVALID_CLIENT_ID:'Client ID 格式錯誤',INVALID_CHANNEL_ID:'頻道 ID 必須是數字',INVALID_CALLBACK:'回呼網址須使用本機 127.0.0.1:4173 的 oauth-callback.html'};
    $('#provider-feedback').textContent=errors[error.message]??'設定無法使用';
  }
  syncProviderControls();
});
// Both buttons use the same lifecycle; the live button cannot bypass the hard lock.
function syncProviderControls(){
  const busy=Boolean(providerActivation),otherBusy=mockMode||chatMode||Boolean(popupController?.pending);
  $('#provider-local').disabled=otherBusy;
  $('#provider-local').textContent=busy?'停止／取消本機模擬':'以本機模擬測試授權';
  $('#provider-live').disabled=!LIVE_NETWORK_ENABLED||!configuredProvider||busy||otherBusy;
  $('#provider-live').textContent=LIVE_NETWORK_ENABLED?'正式授權並訂閱':'正式授權並訂閱（尚未開放）';
  for(const element of $('#provider-form').elements)element.disabled=busy;
  $('#mock-toggle').disabled=busy||chatMode||Boolean(popupController?.pending);
  $('#auth-mock-toggle').disabled=busy||mockMode;
  $('#connection').disabled=busy||mockMode||chatMode;
  for(const button of document.querySelectorAll('[data-throw], #chat-input, #chat-form button'))button.disabled=busy;
  for(const button of document.querySelectorAll('#synthetic-cross,#synthetic-freeze,#synthetic-mosquito,#synthetic-lava'))button.disabled=busy||mockMode||chatMode||Boolean(popupController?.pending);
}
function finishProvider(message){
  const current=providerActivation;if(!current)return;
  providerActivation=null;current.stop();adapter.ingest(syntheticWelcome());
  $('#provider-status').textContent=message;syncProviderControls();
}
function startProvider(mode){
  if(providerActivation||mockMode||chatMode||popupController?.pending)return;
  if(mode==='live'&&(!LIVE_NETWORK_ENABLED||!configuredProvider)){$('#provider-status').textContent='正式連線尚未開放或設定未驗證。';return;}
  if(location.origin!=='http://127.0.0.1:4173'){$('#provider-status').textContent='請使用 127.0.0.1:4173 開啟頁面。';return;}
  const prefix=mode==='local'?'本機模擬':'Twitch';
  const provider=new TwitchProvider({mode,game,config:mode==='local'?LOCAL_CONFIG:configuredProvider,
    onStatus:(status,detail)=>{
      if(!providerActivation)return;
      const labels={CONNECTING:'連線中',SUBSCRIBING:'訂閱中',ONLINE:'聊天室已訂閱',MIGRATING:'訂閱遷移中',RETRYING:'重新連線中'};
      if(labels[status]){$('#provider-status').textContent=`${prefix}：${labels[status]}`;$('#connection-badge').textContent=`${prefix}：${labels[status]}`;}
      if(status==='STOPPED'&&detail)finishProvider(detail==='AUTH_REQUIRED'?'授權失效，請重新授權。':'訂閱已停止，請重新授權。');
    },
    onDelivery:result=>{if(result.accepted)feed(`${prefix}聊天室投出攻擊`,`!throw ${result.cell} · 0.5 秒警報`);}
  });
  const activation=new ProviderActivation({provider,origin:location.origin,
    openWindow:url=>window.open(url,'streamer-mayhem-provider-auth','popup,width=520,height=420'),
    onState:state=>{
      const messages={PENDING:'等待授權；可按停止／取消。',VALIDATING:'驗證授權中。',AUTHORIZED:'授權成功，正在訂閱。'};
      if(messages[state])$('#provider-status').textContent=`${prefix}：${messages[state]}`;
      if(['CANCELLED','CLOSED','DENIED','FAILED','BLOCKED','LIVE_LOCKED'].includes(state)){
        const errors={CANCELLED:'授權已取消。',CLOSED:'授權視窗已關閉。',DENIED:'使用者拒絕授權。',FAILED:'授權或訂閱啟動失敗。',BLOCKED:'請允許本機彈出視窗。',LIVE_LOCKED:'正式連線尚未開放。'};
        finishProvider(`${prefix}：${errors[state]}`);
      }
    }});
  providerActivation=activation;adapter.disconnect();syncProviderControls();
  if(!activation.start() && providerActivation)finishProvider(`${prefix}：無法啟動授權。`);
}
$('#provider-local').addEventListener('click',()=>{if(providerActivation)finishProvider('本機模擬已停止。');else startProvider('local');});
$('#provider-live').addEventListener('click',()=>startProvider('live'));

function pointInput(event){
  const rect=canvas.getBoundingClientRect();const source=canvasPointToSource({x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height},cameraGeometry);
  if(!source)return;
  const target=$('#pointer-control').value;
  if(target==='body')Object.assign(player,source);
  else {const visible=projectCameraPoint({...source,visibility:1},cameraGeometry);if(visible)poseControls[target]={x:visible.x,y:visible.y};}
}
canvas.addEventListener('pointerdown',event=>{pointInput(event);canvas.setPointerCapture?.(event.pointerId);canvas.focus();});
canvas.addEventListener('pointermove',event=>{if(event.buttons===1)pointInput(event);});
canvas.addEventListener('keydown',event=>{
  const keys={ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'};
  if(keys[event.key]){event.preventDefault();move(...movement[keys[event.key]]);}
});
$('#pause').addEventListener('click',()=>{
  if(game.mode==='PAUSED'){game.resume();feed('遊戲準備繼續','保持位置，倒數後恢復');}
  else if(game.pause())feed('遊戲已暫停','聊天室攻擊暫不接收');
});
$('#tracking').addEventListener('click',()=>{tracking=!tracking;if(!tracking)game.loseLandmarks();const snapshot=game.tick();updateScreen(snapshot);publishOverlay(snapshot,{force:true});feed(tracking?'合成追蹤已恢復':'合成追蹤已中斷',tracking?'準備倒數後繼續':'不會判定命中或出界');});
$('#frame-source-toggle').addEventListener('click',()=>{
  if(frameSource.running){frameSource.stop();lastEffect=null;feed('合成影格已中斷','等待攻擊已取消，不計分或扣血');}
  else {frameSource.start();feed('合成影格準備恢復','收到新影格後開始準備倒數');}
  const snapshot=game.tick();updateScreen(snapshot);publishOverlay(snapshot,{force:true});
});
$('#connection').addEventListener('click',()=>{
  if(adapter.status==='SIMULATED_ONLINE'){adapter.disconnect();feed('模擬聊天室已斷線','不會接收新攻擊');}
  else {adapter.ingest(syntheticWelcome());feed('模擬聊天室已恢復','已重新開啟合成事件');}
});
$('#mock-toggle').addEventListener('click',()=>{
  if(!mockMode){mockMode=true;syncProviderControls();$('#connection').disabled=true;$('#auth-mock-toggle').disabled=true;$('#mock-toggle').textContent='停止本機 CLI mock';transport.start();}
  else {transport.stop();mockMode=false;syncProviderControls();$('#connection').disabled=false;$('#auth-mock-toggle').disabled=false;$('#mock-toggle').textContent='連接本機 CLI mock';adapter.ingest(syntheticWelcome());}
});
$('#auth-mock-toggle').addEventListener('click',()=>{
  if(chatMode){chatTransport.stop();oauth.clear();chatMode=false;syncProviderControls();$('#connection').disabled=false;$('#mock-toggle').disabled=false;$('#auth-mock-toggle').textContent='啟動本機聊天室授權測試';adapter.ingest(syntheticWelcome());return;}
  if(!popupController){feed('本機授權無法啟動','請以 127.0.0.1:4173 開啟遊戲');return;}
  if(popupController.pending)popupController.cancel();else popupController.start();
});
window.addEventListener('message',event=>{popupController?.handleMessage(event);providerActivation?.handleMessage(event);});
$('#reset').addEventListener('click',()=>{
  game.reset();frameSource.reset();player.x=.5;player.y=.5;tracking=true;lastEffect=null;game.start();
  if(providerActivation)game.setConnection(providerActivation.provider.transport.status==='ONLINE');else if(mockMode||chatMode)game.setConnection((chatMode?chatTransport:transport).status==='ONLINE');else adapter.ingest(syntheticWelcome());
  poseControls.spread=.1;poseControls.hip=.5;poseControls.leftWrist={x:.25,y:.55};poseControls.rightWrist={x:.75,y:.55};
  $('#elbow-spread').value='10';$('#elbow-value').textContent='10%';for(const id of ['elbow-known','wrist-known','hip-known'])$(`#${id}`).checked=true;
  addSyntheticFrame();game.tick();
  $('#command-feedback').textContent='可輸入 !throw 1–9、!freeze、!mosquito、!lava';feed('回合已重置','生命與分數已重設');
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){frameSource.stop();if(game.mode==='PLAYING'||game.mode==='TRACKING_LOST'||game.mode==='RECOVERING')game.pause();feed('遊戲已暫停','頁面隱藏時不會繼續判定');const snapshot=game.tick();updateScreen(snapshot);publishOverlay(snapshot,{force:true});}
});
window.addEventListener('pagehide',()=>{stopOverlaySync();cancelAnimationFrame(animationId);transport.stop();chatTransport.stop();popupController?.dispose();providerActivation?.stop();oauth.clear();});

syncProviderControls();game.start();addSyntheticFrame();game.tick();adapter.ingest(syntheticWelcome());animationId=requestAnimationFrame(loop);
