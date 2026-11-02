// Diagnostic-only helpers. Never imported by the app or detector.
export type ProbePhase = 'default' | 'requested30' | 'synthetic';
const kinds=['open','receipt','negotiated','subscription','watchdog','heartbeat','close','error','done','main_timer'] as const;
const messageTypes=['session_welcome','session_keepalive','notification','session_reconnect','revocation','unknown'] as const;
const numeric=['wallMs','monoMs','timeoutMs','receiptIntervalMs','receiptAgeMs','wallReceiptAgeMs','watchdogIntervalMs','watchdogOvershootMs','clockDriftMs','workerLoopMaxMs','serverToWorkerMs','httpStatus','closeCode','mainDispatchLagMs','mainLoopMaxMs','mainTimerOvershootMs'] as const;
export interface ProbeRecord { kind:string;phase:ProbePhase;[key:string]:string|number|boolean }
export function sanitizeRecord(raw:unknown,phase:ProbePhase):ProbeRecord|null{
  try{
    if(!['default','requested30','synthetic'].includes(phase))return null;
    if(!raw||typeof raw!=='object')return null;
    const x=raw as Record<string,unknown>;
    if(!kinds.includes(x.kind as typeof kinds[number]))return null;
    const out:ProbeRecord={kind:String(x.kind),phase};
    for(const key of numeric){const value=x[key];if(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<1e15)out[key]=Math.round(value*1000)/1000;}
    if(messageTypes.includes(x.messageType as typeof messageTypes[number]))out.messageType=String(x.messageType);
    if(['network','authorization','invalid_response','local','reconnect_requested','revocation','duration_complete','observation_aborted'].includes(String(x.category)))out.category=String(x.category);
    if(typeof x.deadlineExceeded==='boolean')out.deadlineExceeded=x.deadlineExceeded;
    return out;
  }catch{return null;}
}
export function receiptMetadata(raw:unknown){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>1048576)return null;
  try{const x=JSON.parse(raw);const m=x?.metadata;if(!m||typeof m!=='object')return null;
    const type=messageTypes.includes(m.message_type)?m.message_type:'unknown';
    const sent=typeof m.message_timestamp==='string'?Date.parse(m.message_timestamp):NaN;
    const timeout=x?.payload?.session?.keepalive_timeout_seconds;
    return {messageType:type as typeof messageTypes[number],serverTimeMs:Number.isFinite(sent)?sent:null,
      timeoutMs:type==='session_welcome'&&Number.isInteger(timeout)&&timeout>=10&&timeout<=600?timeout*1000:null};
  }catch{return null;}
}
export class ReceiptTiming{
  private lastWall:number;private lastMono:number;private lastTick:number;timeoutMs:number;
  constructor(wall:number,mono:number,timeoutMs=15000){this.lastWall=wall;this.lastMono=mono;this.lastTick=mono;this.timeoutMs=timeoutMs;}
  receipt(wall:number,mono:number){const receiptIntervalMs=mono-this.lastMono;this.lastWall=wall;this.lastMono=mono;return receiptIntervalMs;}
  watchdog(wall:number,mono:number){const interval=mono-this.lastTick;this.lastTick=mono;const age=mono-this.lastMono;
    return {receiptAgeMs:age,wallReceiptAgeMs:wall-this.lastWall,timeoutMs:this.timeoutMs,deadlineExceeded:age>this.timeoutMs,
      watchdogIntervalMs:interval,watchdogOvershootMs:Math.max(0,interval-1000),clockDriftMs:wall-this.lastWall-age};}
}
export function classify(record:ProbeRecord){
  const n=(key:string)=>typeof record[key]==='number'?record[key] as number:0;
  if(Math.abs(n('clockDriftMs'))>1000)return 'clock_discontinuity_or_host_pause';
  if(n('workerLoopMaxMs')>200||n('watchdogOvershootMs')>200)return 'worker_scheduling_delay_or_host_pause';
  const mainDelayed=n('mainDispatchLagMs')>200||n('mainLoopMaxMs')>200||n('mainTimerOvershootMs')>200;
  if(record.deadlineExceeded&&mainDelayed)return 'receipt_silence_and_main_delay';
  if(record.deadlineExceeded)return 'worker_receipt_silence';
  if(n('mainDispatchLagMs')>200)return 'delayed_main_dispatch';
  if(mainDelayed)return 'main_loop_delay';
  return 'within_observed_budget';
}
export async function restoreIfUnchanged(originalUser:string,wasConnected:boolean,status:()=>Promise<{authenticated:boolean;userId:string|null;connection:string}>,connect:()=>Promise<unknown>){
  if(!wasConnected)return false;const current=await status();
  if(current.authenticated&&current.userId===originalUser&&current.connection==='disconnected'){await connect();return true;}
  return false;
}
