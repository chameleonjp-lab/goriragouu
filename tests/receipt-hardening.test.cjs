const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');const sandbox={module:{exports:{}},Date,Map,Set,JSON};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/score-queue.js'),'utf8'),sandbox);const {createScoreQueue}=sandbox.module.exports;
const ID='10000000-0000-4000-8000-000000000001', ID2='20000000-0000-4000-8000-000000000002';
function storage(){const m=new Map();return {get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
function receipt(score,name='Alice'){return [{accepted:true,result_display_name:name,result_normalized_name:name,result_first_score:score,result_best_score:score,result_play_count:1,was_duplicate:false,is_first_play:true,is_new_best:true}];}
test('guest, immutable consent and durable lost-ack retries use one ID',async()=>{
 const store=storage(),calls=[],ledger=new Map();let offline=true;const send=async p=>{calls.push(p);ledger.set(p.p_submission_id,p);if(offline)throw new Error('lost ACK');return receipt(p.p_score,p.p_display_name)};
 const q=createScoreQueue({gameSlug:'test',storage:store,send,uuid:()=>ID});assert.equal(q.capture('  ','v1'),null);
 const play=q.capture('Alice','v1');q.enqueue(play,123,{time:1.23});assert.throws(()=>q.enqueue(play,999));await q.drain();assert.equal(q.list()[0].state,'pending');
 offline=false;const restored=createScoreQueue({gameSlug:'test',storage:store,send});assert.equal(restored.list()[0].presentation.time,1.23);await restored.drain();assert.equal(ledger.size,1);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(restored.list().length,0);
});
test('new offline games coexist, rejected data remains and no legacy fallback is called',async()=>{
 const store=storage();let id=ID,calls=0;const q=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>id,send:async()=>{calls++;return [{accepted:false}]}});q.enqueue(q.capture('Alice','v1'),10);id=ID2;q.enqueue(q.capture('Bob','v2'),20);await q.drain();await q.drain();assert.equal(calls,2);assert.equal(q.list().length,2);assert.ok(q.list().every(x=>x.state==='rejected'));
});
test('duplicate drains share a request and acknowledgement removes only that play',async()=>{
 const store=storage();let resolve,id=ID;const q=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>id,send:p=>new Promise(r=>resolve=()=>r(receipt(p.p_score,p.p_display_name)))});q.enqueue(q.capture('Alice','v1'),10);const a=q.drain(),b=q.drain();assert.equal(a,b);id=ID2;q.enqueue(q.capture('Bob','v2'),20);resolve();await new Promise(r=>setImmediate(r));assert.equal(q.list().length,1);resolve();await a;assert.equal(q.list().length,0);
});
test('storage/UUID failures do not prevent gameplay and malformed acks remain pending',async()=>{
 const q=createScoreQueue({gameSlug:'test',storage:{setItem(){throw Error()},get length(){throw Error()}},uuid:()=>ID,send:async()=>({accepted:true})});q.enqueue(q.capture('Alice','v1'),10);await q.drain();assert.equal(q.list()[0].state,'pending');const bad=createScoreQueue({gameSlug:'test',uuid:()=>{throw Error()},send(){}});assert.equal(bad.capture('Alice','v1'),null);
});

test('an acknowledgement for another name remains pending with the original ID',async()=>{
 const q=createScoreQueue({gameSlug:'test',storage:storage(),uuid:()=>ID,send:async()=>receipt(10,'Someone else')});q.enqueue(q.capture('Alice','v1'),10);await q.drain();assert.equal(q.list().length,1);assert.equal(q.list()[0].id,ID);assert.equal(q.list()[0].state,'pending');
});

test('missing or malformed acceptance remains retryable after reload with the same UUID',async()=>{
 for(const response of [null,undefined,{},[],{accepted:0},{accepted:'true'}]){const store=storage(),calls=[];const q=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>ID,send:async p=>{calls.push(p);return response}});q.enqueue(q.capture('Alice','v1'),10);await q.drain();assert.equal(q.list()[0].state,'pending');const retry=createScoreQueue({gameSlug:'test',storage:store,send:async p=>{calls.push(p);return receipt(10)}});await retry.drain();assert.deepEqual(calls[0],calls[1]);assert.equal(retry.list().length,0)}
});

test('no network write before durable receipt; quota recovery preserves all plays',async()=>{const base=storage();let quota=true,calls=[];const store={...base,get length(){return base.length},setItem(k,v){if(quota)throw Error('quota');base.setItem(k,v)}};let id=ID;const q=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>id,send:async p=>{calls.push(p);return receipt(p.p_score,p.p_display_name)}});q.enqueue(q.capture('Alice','v1'),10);await q.drain();assert.equal(calls.length,0);quota=false;id=ID2;q.enqueue(q.capture('Bob','v1'),20);await q.drain();assert.equal(calls.length,2);assert.equal(new Set(calls.map(p=>p.p_submission_id)).size,2);});
test('same UUID conflicting disk payload is preserved, never sent or overwritten',async()=>{const store=storage();let calls=0;const q=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>ID,send:async()=>{calls++;return receipt(10)}});q.enqueue(q.capture('Alice','v1'),10);const other=JSON.parse(store.getItem(q.prefix+ID));other.payload.p_score=20;const raw=JSON.stringify(other);store.setItem(q.prefix+ID,raw);await q.drain();assert.equal(calls,0);assert.equal(store.getItem(q.prefix+ID),raw);assert.throws(()=>q.enqueue(q.capture('Alice','v1'),10));});
test('malformed own receipt is not silently overwritten',()=>{const store=storage();store.setItem('test:score-pending:v1:'+ID,'{invalid');const q=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>ID,send(){}});assert.throws(()=>q.enqueue(q.capture('Alice','v1'),10));assert.equal(store.getItem(q.prefix+ID),'{invalid');});
test('accepted receipt keeps a durable tombstone; repeat finalization cannot resend',async()=>{const store=storage();let calls=0;const q=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>ID,send:async()=>{calls++;return receipt(10)}});const play=q.capture('Alice','v1');q.enqueue(play,10);await q.drain();q.enqueue(play,10);await q.drain();assert.equal(calls,1);const restored=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>ID,send:async()=>{calls++;return receipt(10)}});restored.enqueue(play,10);await restored.drain();assert.equal(calls,1);});
test('multiple SQL rows and missing acknowledgement fields remain pending',async()=>{for(const response of [[receipt(10)[0],receipt(10)[0]],{...receipt(10)[0],is_first_play:undefined},{...receipt(10)[0],is_new_best:undefined},{...receipt(10)[0],result_best_score:1.5}]){const store=storage();const q=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>ID,send:async()=>response});q.enqueue(q.capture('Alice','v1'),10);await q.drain();assert.equal(q.list().length,1);}});

test("bare acknowledgement object is not the SQL table transport",async()=>{const q=createScoreQueue({gameSlug:"test",storage:storage(),uuid:()=>ID,send:async()=>receipt(10)[0]});q.enqueue(q.capture("Alice","v1"),10);await q.drain();assert.equal(q.list().length,1)});

test("legacy signed server scores are retained rather than reclassified",async()=>{const q=createScoreQueue({gameSlug:"test",storage:storage(),uuid:()=>ID,send:async()=>receipt(-1)});q.enqueue(q.capture("Alice","v1"),10);await q.drain();assert.equal(q.list().length,0)});
