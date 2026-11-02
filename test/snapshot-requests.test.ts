import test from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotRequests } from '../src/ui/snapshot-requests.ts';

interface Snapshot { selectedSession: {id:string}|null; bookmarks:string[]; alignment:number }
const snapshot=(id:string,version:string):Snapshot=>({selectedSession:{id},bookmarks:[version],alignment:version.length});
function harness(){
  const pending:{id:string;signal:AbortSignal;resolve:(data:Snapshot)=>void;reject:(error:Error)=>void}[]=[];
  const commits:Snapshot[]=[];let shown:Snapshot|null=null;
  const requests=new SnapshotRequests<Snapshot>((id,signal)=>new Promise((resolve,reject)=>pending.push({id,signal,resolve,reject})),data=>{shown=data;commits.push(data);});
  return{requests,pending,commits,get shown(){return shown;}};
}
test('late initial snapshot/body cannot replace a newer session or its export target',async()=>{
  const h=harness();const initial=h.requests.load();
  h.requests.select('B');const selected=h.requests.load();
  assert.equal(h.pending[0]!.signal.aborted,true);
  h.pending[1]!.resolve(snapshot('B','new B'));assert.equal(await selected,true);
  const accepted=h.shown!;assert.equal(h.requests.exportSessionId(accepted),'B');
  h.pending[0]!.resolve(snapshot('A','late initial A'));assert.equal(await initial,false);
  assert.equal(h.shown,accepted);assert.deepEqual(h.commits,[accepted]);
  assert.equal(h.requests.exportSessionId(h.shown),'B');
});
test('A to B to A selection rejects obsolete A responses even when the session IDs match',async()=>{
  const h=harness();h.requests.select('A');const oldA=h.requests.load();
  h.requests.select('B');const oldB=h.requests.load();
  h.requests.select('A');const newA=h.requests.load();
  h.pending[2]!.resolve(snapshot('A','current A'));await newA;
  const current=h.shown;h.pending[0]!.resolve(snapshot('A','obsolete A'));h.pending[1]!.resolve(snapshot('B','obsolete B'));
  assert.deepEqual(await Promise.all([oldA,oldB]),[false,false]);
  assert.equal(h.shown,current);assert.equal(h.requests.exportSessionId(h.shown),'A');assert.equal(h.commits.length,1);
});
test('same-session refresh responses commit only the newest request',async()=>{
  const h=harness();h.requests.select('A');const old=h.requests.load(),newer=h.requests.load();
  h.pending[1]!.resolve(snapshot('A','new bookmarks'));await newer;
  const accepted=h.shown;h.pending[0]!.resolve(snapshot('A','old bookmarks'));await old;
  assert.equal(h.shown,accepted);assert.deepEqual(h.shown!.bookmarks,['new bookmarks']);
});
test('selection immediately disables old export state; mismatched replies cannot enable exports',async()=>{
  const h=harness();const first=h.requests.load();h.pending[0]!.resolve(snapshot('A','A'));await first;
  const old=h.shown;assert.equal(h.requests.exportSessionId(old),'A');
  h.requests.select('B');assert.equal(h.requests.exportSessionId(old),null);
  const next=h.requests.load();h.pending[1]!.resolve(snapshot('A','wrong session'));
  await assert.rejects(next,/different session/);assert.equal(h.requests.exportSessionId(old),null);
  const retry=h.requests.load();h.pending[2]!.resolve(snapshot('B','B'));await retry;
  assert.equal(h.requests.exportSessionId(old),null);assert.equal(h.requests.exportSessionId(h.shown),'B');
});
test('stale errors and results after close cannot commit or replace export state',async()=>{
  const h=harness();const old=h.requests.load();h.requests.select('B');const current=h.requests.load();
  h.pending[0]!.reject(new Error('obsolete network error'));assert.equal(await old,false);
  h.requests.close();h.pending[1]!.resolve(snapshot('B','closed'));assert.equal(await current,false);
  assert.equal(h.commits.length,0);assert.equal(h.requests.exportSessionId(h.shown),null);
});
