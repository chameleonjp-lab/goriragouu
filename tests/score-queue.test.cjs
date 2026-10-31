const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');const sandbox={module:{exports:{}},Date,Map,Set,JSON};vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/score-queue.js'),'utf8'),sandbox);const {createScoreQueue}=sandbox.module.exports;
const ID='10000000-0000-4000-8000-000000000001', ID2='20000000-0000-4000-8000-000000000002';
function storage(){const m=new Map();return {get length(){return m.size},key:i=>[...m.keys()][i],getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
function receipt(score,name='Alice'){return {accepted:true,result_display_name:name,result_normalized_name:name,result_first_score:score,result_best_score:score,result_play_count:1,was_duplicate:false};}
test('guest, immutable consent and durable lost-ack retries use one ID',async()=>{
 const store=storage(),calls=[],ledger=new Map();let offline=true;const send=async p=>{calls.push(p);ledger.set(p.p_submission_id,p);if(offline)throw new Error('lost ACK');return receipt(p.p_score)};
 const q=createScoreQueue({gameSlug:'test',storage:store,send,uuid:()=>ID});assert.equal(q.capture('  ','v1'),null);
 const play=q.capture('Alice','v1');q.enqueue(play,123,{time:1.23});assert.throws(()=>q.enqueue(play,999));await q.drain();assert.equal(q.list()[0].state,'pending');
 offline=false;const restored=createScoreQueue({gameSlug:'test',storage:store,send});assert.equal(restored.list()[0].presentation.time,1.23);await restored.drain();assert.equal(ledger.size,1);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(restored.list().length,0);
});
test('new offline games coexist, rejected data remains and no legacy fallback is called',async()=>{
 const store=storage();let id=ID,calls=0;const q=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>id,send:async()=>{calls++;return {accepted:false}}});q.enqueue(q.capture('Alice','v1'),10);id=ID2;q.enqueue(q.capture('Bob','v2'),20);await q.drain();await q.drain();assert.equal(calls,2);assert.equal(q.list().length,2);assert.ok(q.list().every(x=>x.state==='rejected'));
});
test('duplicate drains share a request and acknowledgement removes only that play',async()=>{
 const store=storage();let resolve,id=ID;const q=createScoreQueue({gameSlug:'test',storage:store,uuid:()=>id,send:p=>new Promise(r=>resolve=()=>r(receipt(p.p_score,p.p_display_name)))});q.enqueue(q.capture('Alice','v1'),10);const a=q.drain(),b=q.drain();assert.equal(a,b);id=ID2;q.enqueue(q.capture('Bob','v2'),20);resolve();await new Promise(r=>setImmediate(r));assert.equal(q.list().length,1);resolve();await a;assert.equal(q.list().length,0);
});
test('storage/UUID failures do not prevent gameplay and malformed acks remain pending',async()=>{
 const q=createScoreQueue({gameSlug:'test',storage:{setItem(){throw Error()},get length(){throw Error()}},uuid:()=>ID,send:async()=>({accepted:true})});q.enqueue(q.capture('Alice','v1'),10);await q.drain();assert.equal(q.list()[0].state,'pending');const bad=createScoreQueue({gameSlug:'test',uuid:()=>{throw Error()},send(){}});assert.equal(bad.capture('Alice','v1'),null);
});

test('a valid-looking acknowledgement for another name retains the exact pending request',async()=>{
 const q=createScoreQueue({gameSlug:'test',storage:storage(),uuid:()=>ID,send:async()=>receipt(10,'Bob')});
 q.enqueue(q.capture('Alice','v1'),10);await q.drain();assert.equal(q.list()[0].state,'pending');assert.equal(q.list()[0].payload.p_display_name,'Alice');
});

test('corrupt stored status is preserved without restoring or sending it',()=>{
 const store=storage();const item={id:ID,state:'submitted',payload:{p_submission_id:ID,p_game_slug:'test',p_display_name:'Alice',p_client_version:'v1',p_score:10}};
 store.setItem('test:score-pending:v1:'+ID,JSON.stringify(item));
 const q=createScoreQueue({gameSlug:'test',storage:store,send:()=>{throw Error('must not send')}});
 assert.equal(q.list().length,0);assert.notEqual(store.getItem('test:score-pending:v1:'+ID),null);
});

test('missing or malformed accepted flag retains the same UUID for a later valid acknowledgement',async()=>{
 for (const response of [null,undefined,{},[],{accepted:0},{accepted:'true'}]) {
  const disk=storage(),calls=[];let valid=false;
  const send=async payload=>{calls.push(payload);return valid?receipt(payload.p_score):response};
  const q=createScoreQueue({gameSlug:'test',storage:disk,uuid:()=>ID,send});
  q.enqueue(q.capture('Alice','v1'),10);await q.drain();assert.equal(q.list()[0].state,'pending');
  valid=true;const reload=createScoreQueue({gameSlug:'test',storage:disk,send});await reload.drain();
  assert.equal(reload.list().length,0);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);
 }
});
