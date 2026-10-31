import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../src/game.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('class RankingClient {'),source.indexOf('\nclass ',source.indexOf('class RankingClient {')+1));
function fixture(){let expire;const sandbox={AbortController,RESULT_RANKING_LIMIT:30,GAME_SLUG:'goriragouu',setTimeout:fn=>{expire=fn;return 1},clearTimeout(){}};vm.createContext(sandbox);vm.runInContext(body+';this.Client=RankingClient;',sandbox);return {client:new sandbox.Client(),expire:()=>expire()};}
test('score and ranking requests use only the receipt endpoint and aggregate limit',async()=>{
 const f=fixture(),calls=[];f.client.clientPromise=Promise.resolve({rpc(name,payload){calls.push({name,payload});return {abortSignal:async()=>({data:{accepted:true},error:null})}}});
 await f.client.submit({p_submission_id:'captured'});await f.client.getBestScores();
 assert.equal(calls[0].name,'submit_score_once_shared_v1');assert.equal(calls[0].payload.p_submission_id,'captured');assert.equal(calls[1].payload.p_limit,30);
});
test('a stalled SDK connection times out without sending a late score',async()=>{
 const f=fixture();let resolve,calls=0;f.client.clientPromise=new Promise(r=>{resolve=r});
 const request=f.client.submit({p_submission_id:'captured'});f.expire();await assert.rejects(request,/timed out/);
 resolve({rpc(){calls++;throw Error('must not send after timeout')}});await Promise.resolve();await Promise.resolve();assert.equal(calls,0);
});
test('only explicit server rejection is permanent; missing accepted stays retryable',async()=>{
 for (const response of [null,{},[],{accepted:false},{accepted:'true'}]) {
  const f=fixture();f.client.request=async()=>response;
  await assert.rejects(f.client.submit({p_submission_id:'captured'}),error=>{
   assert.equal(error.code,response?.accepted===false?'PT422':undefined);return true;
  });
 }
});
