import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculateScore,formatScore} from '../src/rules.js';
const source=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const url='https://chameleonjp-lab.github.io/goriragouu/';
const ids=['ja','en','es','pt-BR','zh-Hans','fr','de','ko','ru','it','zh-Hant','id','tr','vi','th'];
const methods=['shareGame','shareResult','shareContent'].map(name=>{
 const start=source.indexOf(`  async ${name}(`);assert.ok(start>=0);
 const end=source.indexOf('\n  }',start)+4;return source.slice(start,end);
}).join('\n');
for(const id of ids)test(`${id}: real home/result share methods retain result, URL and two official tags`,async()=>{
 const dictionary=JSON.parse(readFileSync(new URL(`../src/locales/${id}.json`,import.meta.url),'utf8'));
 const t=(key,params={})=>dictionary[key].replace(/\{(\w+)\}/g,(_,name)=>String(params[name]??`{${name}}`));
 const intents=[];const window={open:href=>{intents.push(new URL(href));return {opener:null}}};
 const Share=Function('t','formatScore','calculateScore','GAME_URL','window','ui',`return class {${methods}}`)(t,formatScore,calculateScore,url,window,{homeShareButton:{},shareButton:{}});
 const game=new Share();await game.shareGame();
 for(const cleared of [false,true])for(const [seconds,bananas] of [[60,0],[65,10],[120,120]]){game.lastCleared=cleared;game.gameElapsed=seconds;game.bananaCount=bananas;await game.shareResult();assert.ok(intents.at(-1).searchParams.get('text').includes(formatScore(calculateScore(seconds,bananas))));}
 for(const intent of intents){assert.equal(intent.origin,'https://x.com');assert.equal(intent.pathname,'/intent/tweet');const text=intent.searchParams.get('text');assert.ok(text.includes(url));assert.equal(text.split('#ゴリラ豪雨').length,2);assert.equal(text.split('#ゲーム制作').length,2);const weight=[...text.replaceAll(url,'x'.repeat(23))].reduce((n,c)=>n+(c.codePointAt(0)>0x10ff?2:1),0);assert.ok(weight<=280,`${id}: ${weight}`);}
});
