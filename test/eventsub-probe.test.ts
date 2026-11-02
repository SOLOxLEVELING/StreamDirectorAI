import test from 'node:test';import assert from 'node:assert/strict';
import {sanitizeRecord,receiptMetadata,ReceiptTiming,classify,restoreIfUnchanged} from '../scripts/eventsub-probe-timing.ts';
import {runPhase} from '../scripts/eventsub-probe.ts';
import type {ProbeRecord} from '../scripts/eventsub-probe-timing.ts';
test('probe strips credentials, chat, identities, URLs and arbitrary error text',()=>{
 const canary='PRIVATE_CANARY';const raw=JSON.stringify({metadata:{message_type:'notification',message_timestamp:'2026-11-01T00:00:00Z'},payload:{event:{message:{text:canary},user_id:canary}},token:canary});
 const metadata=receiptMetadata(raw)!;assert.equal(metadata.messageType,'notification');assert.ok(!JSON.stringify(metadata).includes(canary));
 const safe=sanitizeRecord({kind:'receipt',messageType:'notification',wallMs:123,monoMs:456,token:canary,payload:canary,error:canary,url:canary,sessionId:canary,mainDispatchLagMs:Infinity},'default');
 assert.deepEqual(safe,{kind:'receipt',phase:'default',wallMs:123,monoMs:456,messageType:'notification'});
 assert.equal(sanitizeRecord({kind:canary},'default'),null);assert.equal(receiptMetadata('bad'),null);
});
test('probe records negotiated timeout and separates wall jumps from monotonic silence',()=>{
 const metadata=receiptMetadata(JSON.stringify({metadata:{message_type:'session_welcome'},payload:{session:{keepalive_timeout_seconds:30}}}))!;assert.equal(metadata.timeoutMs,30000);
 const timing=new ReceiptTiming(1000,0,10000);timing.receipt(2000,1000);const x=timing.watchdog(62000,2000);assert.equal(x.deadlineExceeded,false);assert.equal(x.clockDriftMs,59000);
 assert.equal(classify({...x,kind:'watchdog',phase:'synthetic'}),'clock_discontinuity_or_host_pause');
});
test('probe distinguishes healthy worker receipt silence, delayed main dispatch and host scheduling ambiguity',()=>{
 const base={kind:'watchdog',phase:'default' as const,deadlineExceeded:true,receiptAgeMs:10300,timeoutMs:10000,watchdogOvershootMs:2,workerLoopMaxMs:12,mainDispatchLagMs:1};
 assert.equal(classify(base),'worker_receipt_silence');assert.equal(classify({...base,deadlineExceeded:false,mainDispatchLagMs:900}),'delayed_main_dispatch');
 assert.equal(classify({...base,workerLoopMaxMs:800}),'worker_scheduling_delay_or_host_pause');
 assert.equal(classify({...base,mainDispatchLagMs:900}),'receipt_silence_and_main_delay');
});
test('synthetic worker receipts remain timely while the main thread is deliberately stalled',async()=>{
 const rows:ProbeRecord[]=[];let injected=false;
 await runPhase({phase:'synthetic',durationMs:550},row=>{rows.push(row);if(row.kind==='receipt'&&!injected){injected=true;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,260);}});
 const receipts=rows.filter(r=>r.kind==='receipt');assert.ok(receipts.length>=8);assert.ok(receipts.some(r=>Number(r.mainDispatchLagMs)>200));
 assert.ok(receipts.some(r=>r.classification==='delayed_main_dispatch'));assert.ok(receipts.every(r=>Number(r.receiptIntervalMs)<150));
});
test('diagnostic teardown never reconnects a logged-out or changed broadcaster',async()=>{
 let connected=0;const connect=async()=>{connected++;};
 assert.equal(await restoreIfUnchanged('one',true,async()=>({authenticated:false,userId:null,connection:'disconnected'}),connect),false);
 assert.equal(await restoreIfUnchanged('one',true,async()=>({authenticated:true,userId:'two',connection:'disconnected'}),connect),false);
 assert.equal(await restoreIfUnchanged('one',true,async()=>({authenticated:true,userId:'one',connection:'connected'}),connect),false);
 assert.equal(connected,0);assert.equal(await restoreIfUnchanged('one',true,async()=>({authenticated:true,userId:'one',connection:'disconnected'}),connect),true);assert.equal(connected,1);
});

test('evidence writer failure rejects safely and runs caller restoration instead of crashing',async()=>{
 const {withProbeConnection}=await import('../scripts/eventsub-probe.ts');let connected=true,restores=0;
 const api=async(action?:string)=>{if(action==='disconnect')connected=false;if(action==='connect'){connected=true;restores++;}return {stream:'offline',connection:connected?'connected':'disconnected',auth:{authenticated:true,userId:'one'}};};
 await assert.rejects(withProbeConnection('one',true,api,()=>runPhase({phase:'synthetic',durationMs:150},()=>{throw new Error('PRIVATE disk-full detail');})),/evidence sink failed/);
 assert.equal(connected,true);assert.equal(restores,1);
});
test('main timer writer failure also rejects safely and terminates the worker',async()=>{
 await assert.rejects(runPhase({phase:'synthetic',durationMs:800},r=>{if(r.kind==='main_timer')throw Error('PRIVATE sink');}),/evidence sink failed/);
});
test('a lost disconnect response still restores after observing its side effect',async()=>{
 const {withProbeConnection}=await import('../scripts/eventsub-probe.ts');let connected=true,observed=false;
 const api=async(action?:string)=>{if(action==='disconnect'){connected=false;throw Error('response lost');}if(action==='connect')connected=true;return {stream:'offline',connection:connected?'connected':'disconnected',auth:{authenticated:true,userId:'one'}};};
 await assert.rejects(withProbeConnection('one',true,api,async()=>{observed=true;}),/response lost/);assert.equal(connected,true);assert.equal(observed,false);
});
test('changed offline readiness prevents disconnect; revocation during observation prevents restoration',async()=>{
 const {withProbeConnection}=await import('../scripts/eventsub-probe.ts');let disconnected=false,restored=false,auth=true;
 const api=async(action?:string)=>{if(action==='disconnect')disconnected=true;if(action==='connect')restored=true;return {stream:disconnected?'offline':'live',connection:disconnected?'disconnected':'connected',auth:{authenticated:auth,userId:auth?'one':null}};};
 await assert.rejects(withProbeConnection('one',true,api,async()=>{}),/readiness changed/);assert.equal(disconnected,false);
 const offline=async(action?:string)=>({...await api(action),stream:'offline'});
 await withProbeConnection('one',true,offline,async()=>{auth=false;});assert.equal(restored,false);
});

test('observed67ms late receipt can expire the production watchdog without any local processing stall',async()=>{
 const {replayWatchdog}=await import('../scripts/eventsub-probe-replay.ts');
 // Interval measured by the real worker; this test itself is simulated, with altered tick phase.
 const earlyTick=await replayWatchdog([10067.503],20);assert.equal(earlyTick.timedOut,true);assert.deepEqual(earlyTick.gaps,[{start:0,end:10020}]);
 const laterTick=await replayWatchdog([10067.503],100);assert.equal(laterTick.timedOut,false);
});
test('cleanup outcome is retained even when observation throws after disconnection',async()=>{
 const {withProbeConnection}=await import('../scripts/eventsub-probe.ts');const cleanup={disconnectAttempted:false,reconnectRequested:false};let connection='connected';
 const api=async(action?:string)=>{if(action==='disconnect')connection='disconnected';if(action==='connect')connection='connecting';return {stream:'offline',connection,auth:{authenticated:true,userId:'one'}};};
 await assert.rejects(withProbeConnection('one',true,api,async()=>{throw Error('probe failure');},undefined,cleanup),/probe failure/);
 assert.deepEqual(cleanup,{disconnectAttempted:true,reconnectRequested:true});assert.equal(connection,'connecting');
});

test('internal auth monitor cancellation is retained in the summary outcome',async()=>{
 const {withProbeConnection}=await import('../scripts/eventsub-probe.ts');let calls=0,connected=true;
 const cleanup:{disconnectAttempted:boolean;reconnectRequested:boolean;observationAborted?:boolean;abortCategory?:string}={disconnectAttempted:false,reconnectRequested:false};
 const api=async(action?:string)=>{if(action==='disconnect')connected=false;if(action==='connect')connected=true;calls++;return {stream:'offline',connection:connected?'connected':'disconnected',auth:{authenticated:calls<4,userId:calls<4?'one':null}};};
 await withProbeConnection('one',true,api,signal=>new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true})),undefined,cleanup as import('../scripts/eventsub-probe.ts').ProbeCleanup);
 const summary={aborted:Boolean(cleanup.observationAborted),abortCategory:cleanup.abortCategory};assert.deepEqual(summary,{aborted:true,abortCategory:'readiness_changed'});assert.equal(cleanup.reconnectRequested,false);
});
test('diagnostic output folder is exclusive and cannot mix a second run with old trace',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {createEvidenceDirectory}=await import('../scripts/eventsub-probe.ts');
 const root=mkdtempSync(join(tmpdir(),'sd-probe-folder-'));try{const folder=join(root,'run');createEvidenceDirectory(folder);writeFileSync(join(folder,'trace.jsonl'),'original');assert.throws(()=>createEvidenceDirectory(folder));assert.equal(readFileSync(join(folder,'trace.jsonl'),'utf8'),'original');}finally{rmSync(root,{recursive:true});}
});

test('a failing independent stream guard cannot prevent local restoration after observation',async()=>{
 const {withProbeConnection}=await import('../scripts/eventsub-probe.ts');let connection='connected',guardFailed=false;
 const local=async(action?:string)=>{if(action==='disconnect')connection='disconnected';if(action==='connect')connection='connected';return {stream:'offline',connection,auth:{authenticated:true,userId:'one'}};};
 const guarded=async(action?:string)=>{if(guardFailed)throw Error('upstream guard failure');return local(action);};
 await assert.rejects(withProbeConnection('one',true,guarded,async()=>{guardFailed=true;throw Error('guard failed');},undefined,undefined,local),/guard failed/);assert.equal(connection,'connected');
});
