import {Worker} from 'node:worker_threads';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {readFileSync,writeFileSync,appendFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';import {pathToFileURL} from 'node:url';
import {sanitizeRecord,classify,restoreIfUnchanged} from './eventsub-probe-timing.ts';
import type {ProbePhase,ProbeRecord} from './eventsub-probe-timing.ts';
const mono=()=>Number(process.hrtime.bigint())/1e6;
export async function runPhase(config:{phase:ProbePhase;durationMs:number;token?:string;clientId?:string;userId?:string},record:(event:ProbeRecord)=>void,signal?:AbortSignal){
  const worker=new Worker(new URL('./eventsub-probe-worker.ts',import.meta.url),{workerData:config,env:{},execArgv:[]});
  const histogram=monitorEventLoopDelay({resolution:10});histogram.enable();let previous=mono(),settled=false;
  let fail:()=>void=()=>{};
  const emit=(raw:unknown)=>{if(settled)return;try{const safe=sanitizeRecord(raw,config.phase);if(safe){safe.classification=classify(safe);record(safe);}}catch{fail();}};
  const timer=setInterval(()=>{const now=mono();emit({kind:'main_timer',wallMs:Date.now(),monoMs:now,mainTimerOvershootMs:Math.max(0,now-previous-250),mainLoopMaxMs:histogram.max/1e6});previous=now;histogram.reset();},250);
  const stop=()=>{if(!settled)worker.postMessage('stop');};signal?.addEventListener('abort',stop,{once:true});
  try{await new Promise<void>((done,reject)=>{
    const finish=(message?:string)=>{if(settled)return;settled=true;clearTimeout(deadline);message?reject(new Error(message)):done();};
    const deadline=setTimeout(()=>finish('Diagnostic worker exceeded bound'),config.durationMs+5000);
    fail=()=>finish('Diagnostic evidence sink failed');
    worker.on('message',raw=>{if(settled)return;const safe=sanitizeRecord(raw,config.phase);if(!safe)return;emit({...safe,mainDispatchLagMs:Math.max(0,mono()-Number(safe.monoMs)),mainLoopMaxMs:histogram.max/1e6});if(safe.kind==='done')finish();});
    worker.on('error',()=>finish('Diagnostic worker failed'));
    worker.on('exit',()=>{if(!settled)finish('Diagnostic worker exited');});
    if(signal?.aborted)stop();
  });}finally{settled=true;clearInterval(timer);histogram.disable();signal?.removeEventListener('abort',stop);await worker.terminate();}
}
export interface ProbeCleanup {disconnectAttempted:boolean;reconnectRequested:boolean;observationAborted?:boolean;abortCategory?:'external_signal'|'readiness_changed'|'status_check_failed'}
export function createEvidenceDirectory(folder:string){mkdirSync(dirname(folder),{recursive:true});mkdirSync(folder);}
export async function withProbeConnection(originalUser:string,wasConnected:boolean,api:(action?:string)=>Promise<any>,observe:(signal:AbortSignal)=>Promise<void>,signal?:AbortSignal,cleanup:ProbeCleanup={disconnectAttempted:false,reconnectRequested:false},restoreApi=api){
  const controller=new AbortController();let monitoringActive=true,checking=false;
  const abortWith=(category:NonNullable<ProbeCleanup['abortCategory']>)=>{if(controller.signal.aborted)return;cleanup.observationAborted=true;cleanup.abortCategory=category;controller.abort();};
  const abort=()=>abortWith('external_signal');signal?.addEventListener('abort',abort,{once:true});
  let monitor:NodeJS.Timeout|undefined,disconnectAttempted=false,restored=false;
  const valid=(s:any)=>s.auth.authenticated&&s.auth.userId===originalUser&&s.stream==='offline';
  try{
    if(signal?.aborted)abort();
    const before=await api();if(!valid(before))throw Error('Offline diagnostic readiness changed');
    if(controller.signal.aborted)return false;
    disconnectAttempted=true;cleanup.disconnectAttempted=true;await api('disconnect');
    const after=await api();if(!valid(after)||after.connection!=='disconnected')throw Error('Diagnostic disconnect not confirmed');
    monitor=setInterval(()=>{if(checking||!monitoringActive||controller.signal.aborted)return;checking=true;
      void api().then(s=>{if(monitoringActive&&!valid(s))abortWith('readiness_changed');})
        .catch(()=>{if(monitoringActive)abortWith('status_check_failed');}).finally(()=>{checking=false;});
    },1000);
    await observe(controller.signal);
  }finally{
    monitoringActive=false;if(monitor)clearInterval(monitor);signal?.removeEventListener('abort',abort);
    if(disconnectAttempted)restored=await restoreIfUnchanged(originalUser,wasConnected,async()=>{const s=await restoreApi();return {...s.auth,connection:s.connection};},()=>restoreApi('connect')).catch(()=>false);
    cleanup.reconnectRequested=restored;
  }
  return restored;
}

async function main(){
  process.loadEnvFile('.env');const folder=resolve(process.argv[2]??`evidence/eventsub-diagnostics-2026-11-01/probe-${Date.now()}-${process.pid}`);createEvidenceDirectory(folder);
  const control=readFileSync('data/control-token.txt','utf8').trim();const api=async(action?:string)=>{const res=await fetch('http://localhost:4387/api/'+(action??'status'),{...(action?{method:'POST',headers:{Authorization:`Bearer ${control}`}}:{}),signal:AbortSignal.timeout(10000)});if(!res.ok)throw Error('Local diagnostic control failed');return res.json();};
  const original=await api();if(original.stream!=='offline'||!original.auth.authenticated)throw Error('Require offline validated broadcaster');
  const token=JSON.parse(readFileSync('data/twitch-token.json','utf8'));if(token.pendingValidation||token.expiresAtMs<Date.now()+420000)throw Error('Require sufficiently long validated grant');
  const valid=await fetch('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:`OAuth ${token.access_token}`},signal:AbortSignal.timeout(8000)});if(!valid.ok)throw Error('Token validation failed');const identity=await valid.json();
  if(identity.user_id!==original.auth.userId||identity.client_id!==process.env.TWITCH_CLIENT_ID||!identity.scopes?.includes('user:read:chat'))throw Error('Wrong validated grant');
  // The app stops stream polling after disconnect; use a separate read-only Helix guard.
  const streamChecks:{atMs:number;result:string}[]=[];let checkedAt=0,streamState='unknown';
  const guardedApi=async(action?:string)=>{
    const s=await api(action);
    if(s.auth.authenticated&&s.auth.userId===identity.user_id&&(!action||action==='disconnect')){
      if(action==='disconnect'||Date.now()-checkedAt>=5000){
        try{const r=await fetch(`https://api.twitch.tv/helix/streams?user_id=${encodeURIComponent(identity.user_id)}&first=1`,{signal:AbortSignal.timeout(3000),headers:{Authorization:`Bearer ${token.access_token}`,'Client-Id':identity.client_id}});
          if(r.status!==200)throw Error('Stream guard unavailable');const data=await r.json();if(!Array.isArray(data.data))throw Error('Invalid stream guard response');
          streamState=data.data.length?'live':'offline';checkedAt=Date.now();streamChecks.push({atMs:checkedAt,result:streamState});
        }catch{streamChecks.push({atMs:Date.now(),result:'check_failed'});throw Error('Independent stream guard failed');}
      }
      return {...s,stream:streamState};
    }
    return s;
  };
  const trace:ProbeRecord[]=[];const controller=new AbortController();let restored=false,failed=false;const cleanup:ProbeCleanup={disconnectAttempted:false,reconnectRequested:false};
  const onSignal=()=>controller.abort();process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
  try{
    restored=await withProbeConnection(identity.user_id,original.connection==='connected',guardedApi,async signal=>{
      await new Promise(r=>setTimeout(r,3000));
      for(const phase of ['default','requested30'] as const){if(signal.aborted)break;await runPhase({phase,durationMs:phase==='default'?180000:120000,token:token.access_token,clientId:identity.client_id,userId:identity.user_id},event=>{trace.push(event);appendFileSync(resolve(folder,'trace.jsonl'),JSON.stringify(event)+'\n');},signal);}
    },controller.signal,cleanup,api);
  }catch{failed=true;throw Error('Offline probe failed');}finally{
    process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);
    restored=cleanup.reconnectRequested;
    writeFileSync(resolve(folder,'summary.json'),JSON.stringify({capturedAt:new Date().toISOString(),purpose:'Offline timing probe only; no OBS output or bookmarks',productionPolicyChanged:false,restoreRequested:restored,failed,aborted:Boolean(cleanup.observationAborted||controller.signal.aborted),abortCategory:cleanup.abortCategory??null,streamChecks,streamGuardCacheMs:5000,phases:['default','requested30'].map(phase=>{const rows=trace.filter(x=>x.phase===phase);return {phase,negotiated:rows.filter(x=>x.kind==='negotiated'),subscription:rows.filter(x=>x.kind==='subscription'),watchdogExceedances:rows.filter(x=>x.kind==='watchdog'&&x.deadlineExceeded),lateReceiptIntervals:rows.filter(x=>x.kind==='receipt'&&Number(x.receiptIntervalMs)>Number(rows.find(r=>r.kind==='negotiated')?.timeoutMs??Infinity)),maxMainDispatchLagMs:Math.max(0,...rows.map(x=>Number(x.mainDispatchLagMs??0))),maxWorkerLoopMs:Math.max(0,...rows.map(x=>Number(x.workerLoopMaxMs??0)))};})},null,2));
  }
  console.log(`Sanitized offline timing probe ${cleanup.observationAborted||controller.signal.aborted?'aborted':'complete'}; see summary.json.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main().catch(()=>{console.error('Offline timing probe failed; no raw error details emitted.');process.exitCode=1;});
