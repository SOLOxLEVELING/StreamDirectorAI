import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { EventHub } from '../src/presentation.ts';
import type { Alert } from '../src/presentation.ts';
import { OverlayQueue, ReactionPlayer } from '../src/overlay-queue.ts';
import { Store, Recorder } from '../src/store.ts';
import { settings } from '../src/types.ts';

class ResponseStub extends EventEmitter {
  destroyed=false; writableLength=0; frames:string[]=[]; writable=true; status=0;
  writeHead(status:number){this.status=status;return this;}
  write(frame:string){this.frames.push(frame);return this.writable;}
  end(){this.destroyed=true;this.emit('close');}
  destroy(){this.destroyed=true;this.emit('close');}
  response(){return this as unknown as ServerResponse;}
}
test('post-commit observer and slow SSE failures cannot prevent durable bookmarks or later observers',()=>{
  const store=new Store(':memory:'),hub=new EventHub(()=>1000),slow=new ResponseStub();let durable=0;
  try{
    hub.add(slow.response(),'live');slow.writable=false;
    store.subscribe(()=>{throw new Error('broken presentation');});
    store.subscribe(event=>{assert.ok(store.bookmark(event.bookmarks[0]!.bookmark.id));durable++;hub.changes(event,'live');});
    const recorder=new Recorder(store,{id:'post-commit',mode:'live',streamId:'test',streamStartedAtMs:0,startedAtMs:1000,settings:settings()},()=>1000);
    const result=recorder.ingest({type:'manual',sourceId:'m',transportId:'m',receivedAtMs:1000,sourceTimeMs:1000});
    assert.equal(result.bookmarks.length,1);assert.equal(store.bookmarks(recorder.session.id).length,1);
    assert.equal(durable,1);assert.equal(store.observerFailures,1);assert.equal(slow.destroyed,true);assert.equal(hub.count(),0);
  }finally{hub.close();store.close();}
});
test('SSE reconnect starts at a fresh cursor, does not replay alerts, and isolates simulated traffic',()=>{
  const store=new Store(':memory:'),hub=new EventHub(()=>1000),live=new ResponseStub(),sim=new ResponseStub();
  try{
    hub.add(live.response(),'live');hub.add(sim.response(),'simulated');store.subscribe(event=>hub.changes(event,'live'));
    const recorder=new Recorder(store,{id:'alerts',mode:'live',streamId:'test',streamStartedAtMs:0,startedAtMs:1000,settings:settings()},()=>1000);
    const input={type:'cheer',amount:100,sourceId:'c',transportId:'c',receivedAtMs:1000,sourceTimeMs:1000};
    recorder.ingest(input);recorder.ingest({...input,amount:50,sourceId:'c2',transportId:'c2'});
    assert.equal(live.frames.filter(frame=>frame.startsWith('event: alert')).length,1);
    assert.equal(sim.frames.filter(frame=>frame.startsWith('event: alert')).length,0);
    const reloaded=new ResponseStub();hub.add(reloaded.response(),'live');
    assert.equal(reloaded.frames.length,1);assert.match(reloaded.frames[0]!,/"cursor":1/);
    assert.equal(reloaded.frames.some(frame=>frame.includes('event: alert')),false);
    assert.equal(store.bookmarks('alerts')[0]!.metrics.bits,150);
  }finally{hub.close();store.close();}
});
test('SSE client count and pending output are bounded',()=>{
  const hub=new EventHub();for(let i=0;i<12;i++)hub.add(new ResponseStub().response(),'dashboard');
  const extra=new ResponseStub();hub.add(extra.response(),'dashboard');assert.equal(extra.status,503);assert.equal(hub.count(),12);hub.close();
});
const alert=(id:string,tier:Alert['tier'],sequence:number,sentAtMs=1000):Alert=>({id,tier,sequence,sentAtMs,caption:'Known label',signal:tier==='corner'?'chat':'raid',mode:'live'});
test('overlay prioritizes banners, rejects stale/duplicate alerts, bounds queue and resets on reload',()=>{
  const queue=new OverlayQueue();queue.reset(0);
  queue.accept(alert('chat','corner',1),1000);queue.accept(alert('raid','banner',2),1000);
  assert.equal(queue.next(1000)!.tier,'banner');assert.equal(queue.next(1001),null);
  assert.equal(queue.next(5500)!.id,'chat');queue.accept(alert('chat','corner',3),5501);assert.equal(queue.size(),0);
  queue.accept(alert('stale','banner',4,0),16000);assert.equal(queue.size(),0);
  for(let i=5;i<30;i++)queue.accept(alert(String(i),'corner',i,16000),16000);assert.equal(queue.size(),6);
  queue.accept(alert('priority','banner',30,16000),16000);assert.equal(queue.size(),6);
  queue.reset(30);queue.accept(alert('historical','banner',29,16000),16000);assert.equal(queue.size(),0);
});

test('a rendering pause does not consume an unseen reaction; stale age and reload still clear it',()=>{
  const player=new ReactionPlayer();player.reset(0);player.accept(alert('corner','corner',1),1000);
  assert.equal(player.step(1000)!.id,'corner');
  assert.equal(player.step(4000)!.id,'corner'); // Three seconds without frames consumes only one bounded frame.
  for(let i=1;i<=20;i++)assert.equal(player.step(4000+i*100)!.id,'corner');
  assert.equal(player.step(6100),null);
  player.accept(alert('banner','banner',2,6200),6200);assert.equal(player.step(6200)!.id,'banner');
  assert.equal(player.step(22000),null); // Long suspension never resurrects old content.
  player.reset(2);player.accept(alert('old','corner',1,22000),22000);assert.equal(player.step(22000),null);
});
