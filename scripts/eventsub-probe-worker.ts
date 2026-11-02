import {parentPort,workerData} from 'node:worker_threads';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {ReceiptTiming,receiptMetadata,sanitizeRecord} from './eventsub-probe-timing.ts';
import type {ProbePhase} from './eventsub-probe-timing.ts';
const config=workerData as {phase:ProbePhase;durationMs:number;token?:string;clientId?:string;userId?:string};
const mono=()=>Number(process.hrtime.bigint())/1e6;
const histogram=monitorEventLoopDelay({resolution:10});histogram.enable();
const timing=new ReceiptTiming(Date.now(),mono());let socket:WebSocket|null=null,finished=false,welcomed=false;
const timers:NodeJS.Timeout[]=[];
const emit=(raw:Record<string,unknown>)=>{const safe=sanitizeRecord({...raw,wallMs:Date.now(),monoMs:mono()},config.phase);if(safe)parentPort!.postMessage(safe);};
function done(category='duration_complete'){if(finished)return;finished=true;for(const t of timers)clearInterval(t);histogram.disable();try{socket?.close();}catch{}emit({kind:'done',category});}
parentPort!.on('message',()=>done('observation_aborted'));
timers.push(setTimeout(()=>done(),config.durationMs));
timers.push(setInterval(()=>emit({kind:'heartbeat'}),250));
timers.push(setInterval(()=>{emit({kind:'watchdog',...timing.watchdog(Date.now(),mono()),workerLoopMaxMs:histogram.max/1e6});histogram.reset();},1000));
if(config.phase==='synthetic'){
  welcomed=true;timing.timeoutMs=1000;emit({kind:'negotiated',timeoutMs:1000});
  timers.push(setInterval(()=>{const interval=timing.receipt(Date.now(),mono());emit({kind:'receipt',messageType:'session_keepalive',receiptIntervalMs:interval});},20));
}else{
  // Only one fixed Twitch destination; no raw URL, payload, identity or session ID crosses to the parent.
  const endpoint='wss://eventsub.wss.twitch.tv/ws'+(config.phase==='requested30'?'?keepalive_timeout_seconds=30':'');
  socket=new WebSocket(endpoint);
  socket.addEventListener('open',()=>emit({kind:'open'}));
  socket.addEventListener('error',()=>{emit({kind:'error',category:'network'});done('network');});
  socket.addEventListener('close',event=>{emit({kind:'close',closeCode:event.code});if(!finished)done('network');});
  socket.addEventListener('message',event=>{
    if(finished)return;
    const wall=Date.now(),received=mono(),metadata=receiptMetadata(event.data);if(!metadata){emit({kind:'error',category:'invalid_response'});return;}
    const interval=timing.receipt(wall,received);
    emit({kind:'receipt',messageType:metadata.messageType,receiptIntervalMs:interval,
      ...(metadata.serverTimeMs!==null?{serverToWorkerMs:wall-metadata.serverTimeMs}:{})});
    if(metadata.messageType==='session_welcome'){
      if(welcomed||metadata.timeoutMs===null){done('invalid_response');return;}welcomed=true;timing.timeoutMs=metadata.timeoutMs;emit({kind:'negotiated',timeoutMs:metadata.timeoutMs});
      // Raw session ID is used only for this subscription. Never forwarded or persisted.
      const sessionId=JSON.parse(event.data as string).payload.session.id;
      void fetch('https://api.twitch.tv/helix/eventsub/subscriptions',{method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${config.token}`,'Client-Id':config.clientId!,'Content-Type':'application/json'},
        body:JSON.stringify({type:'channel.chat.message',version:'1',condition:{broadcaster_user_id:config.userId,user_id:config.userId},transport:{method:'websocket',session_id:sessionId}})})
        .then(response=>{emit({kind:'subscription',httpStatus:response.status});if(response.status!==202)done(response.status===401||response.status===403?'authorization':'network');}).catch(()=>{emit({kind:'error',category:'network'});done('network');});
    }else if(metadata.messageType==='session_reconnect')done('reconnect_requested');
    else if(metadata.messageType==='revocation')done('revocation');
  });
  timers.push(setTimeout(()=>{if(!welcomed)done('network');},15000));
}
// Deliberately do not close on a shadow watchdog expiry. This bounded observation-only
// probe records late receipts and creates no bookmarks; it is NOT the production policy.
