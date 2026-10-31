import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/game.js', import.meta.url), 'utf8');
function fixture(saved = {}) {
  const values = new Map(Object.entries(saved)); const listeners = {}; const timers = new Map(); let contexts=0;
  const node = () => ({connect(){},disconnect(){this.disconnected=true;},start(){},stop(){this.stopped=true;},frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},gain:{setTargetAtTime(){},setValueAtTime(){},exponentialRampToValueAtTime(){}}});
  class Context { constructor(){contexts++;this.state='running';this.currentTime=0;this.sampleRate=8;this.destination={};}createGain(){return node();}createOscillator(){return node();}createBufferSource(){return node();}createBiquadFilter(){return node();}createBuffer(){return {getChannelData:()=>new Float32Array(8)};} }
  const document={hidden:false,addEventListener:(type,fn)=>{listeners[type]=fn;}};
  const window={AudioContext:Context,addEventListener:(type,fn)=>{listeners[type]=fn;},setTimeout:fn=>{const id={};timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  const sandbox={window,document,safeStorageGet:(key,fallback)=>values.get(key)??fallback,safeStorageSet:(key,value)=>values.set(key,value),clamp:(v,a,b)=>Math.min(b,Math.max(a,v))};
  vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('class AudioController {'),source.indexOf('\nclass RankingClient {'))+'\nthis.AudioController = AudioController;',sandbox);
  return {audio:new sandbox.AudioController(),values,document,listeners,timers,contexts:()=>contexts};
}
test('default enabled and saved off/zero survive without unlocking', async()=>{
 const first=fixture();assert.equal(first.audio.enabled,true);assert.equal(first.audio.volume,1);
 first.audio.setEnabled(false);await first.audio.unlock();assert.equal(first.contexts(),0);
 const zero=fixture({'goriragouu-volume':'0'});await zero.audio.unlock();assert.equal(zero.contexts(),0);assert.equal(zero.audio.volume,0);
 const invalid=fixture({'goriragouu-volume':'  '});assert.equal(invalid.audio.volume,1);
});
test('audio voices and bonus timers are bounded and stop when hidden or muted',async()=>{
 const f=fixture();await f.audio.unlock();for(let i=0;i<100;i++)f.audio.banana();assert.equal(f.audio.voices.size,24);
 f.audio.bonus();assert.equal(f.timers.size,3);f.document.hidden=true;f.listeners.visibilitychange();assert.equal(f.audio.voices.size,0);assert.equal(f.timers.size,0);
 f.audio.banana();assert.equal(f.audio.voices.size,0);f.document.hidden=false;f.audio.banana();assert.equal(f.audio.voices.size,1);
 f.audio.setVolume(0);assert.equal(f.audio.voices.size,0);assert.equal(f.values.get('goriragouu-volume'),'0');
});

test("muted bonus does not queue stale notes for a later unmute", async()=>{
 const f=fixture();await f.audio.unlock();f.audio.setEnabled(false);f.audio.bonus();assert.equal(f.timers.size,0);f.audio.setEnabled(true);assert.equal(f.audio.voices.size,0);
});
