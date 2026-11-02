// Simulated replay of receipt intervals through the unchanged production watchdog.
import {EventSubClient} from '../src/twitch/eventsub.ts';
import type {Socket} from '../src/twitch/eventsub.ts';
export async function replayWatchdog(intervalsMs:number[],tickPhaseMs:number){
  let time=0,closed=false;const gaps:{start:number;end:number}[]=[];
  const listeners=new Map<string,(event:any)=>void>();
  const socket:Socket={addEventListener:(type,listener)=>{listeners.set(type,listener);},close:()=>{closed=true;}};
  const client=new EventSubClient({clock:()=>Math.round(time),socketFactory:()=>socket,subscribe:async()=>{},notification:()=>{},revocation:()=>{},status:()=>{},gap:(start,end)=>gaps.push({start,end})});
  const message=(type:string,payload:unknown)=>listeners.get('message')!({data:JSON.stringify({metadata:{message_id:'replay-'+time,message_type:type,message_timestamp:new Date(Math.round(time)).toISOString()},payload})});
  try{
    client.start();message('session_welcome',{session:{id:'synthetic-session',keepalive_timeout_seconds:10}});await new Promise(r=>setImmediate(r));
    let nextTick=tickPhaseMs===0?1000:tickPhaseMs,receiptTime=0;
    for(const interval of intervalsMs){receiptTime+=interval;while(nextTick<receiptTime){time=nextTick;client.tick();nextTick+=1000;if(closed)return {timedOut:true,gaps};}
      time=receiptTime;message('session_keepalive',{});
    }
    return {timedOut:false,gaps};
  }finally{client.stop();}
}
