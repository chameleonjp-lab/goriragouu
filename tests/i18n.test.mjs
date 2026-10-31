import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {LANGUAGES, chooseLanguage, matchLanguage, changeLanguage, getLanguage, t, initI18n} from '../src/i18n.js';

test('saved language wins; browser aliases and English fallback are explicit',()=>{
  assert.equal(chooseLanguage('fr',['ja-JP']),'fr');
  assert.equal(chooseLanguage(null,['xx','zh-TW']),'zh-Hant');
  assert.equal(chooseLanguage('bad',['pt-PT']),'pt-BR');
  assert.equal(chooseLanguage(null,['xx']),'en');
  assert.equal(matchLanguage('zh-Hans-CN'),'zh-Hans');
  assert.equal(matchLanguage('zh_HK'),'zh-Hant');
});
test('every advertised language translates the complete catalog with identical placeholders',async()=>{
  const english=JSON.parse(await readFile(new URL('../src/locales/en.json',import.meta.url)));
  const keys=Object.keys(english).sort();
  const placeholders=text=>[...text.matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort();
  for(const [locale] of LANGUAGES){
    const dict=JSON.parse(await readFile(new URL(`../src/locales/${locale}.json`,import.meta.url)));
    assert.deepEqual(Object.keys(dict).sort(),keys,locale);
    for(const key of keys){
      assert.equal(typeof dict[key],'string',`${locale}:${key}`);
      assert.ok(dict[key].length>0 || key==='bananaUnit',`${locale}:${key}`);
      assert.deepEqual(placeholders(dict[key]),placeholders(english[key]),`${locale}:${key}`);
    }
  }
});
test('language changes preserve names, scores and audio settings; stale requests cannot win',async()=>{
  const settings=new Map([['goriragouu-sound','off'],['goriragouu-best-score','42'],['chameleonjp_goriragouu_player_name','名前']]);
  let resolveJapanese;
  const node={dataset:{i18n:'share'},textContent:''};
  const previous={fetch:globalThis.fetch,document:globalThis.document,localStorage:globalThis.localStorage};
  globalThis.document={documentElement:{},querySelectorAll:()=>[node],querySelector:()=>null,dispatchEvent:()=>{}};
  globalThis.localStorage={setItem:(k,v)=>settings.set(k,v)};
  globalThis.fetch=async()=>new Promise(resolve=>{resolveJapanese=()=>resolve({ok:true,json:async()=>({share:'Xでシェア'})});});
  try{
    const old=changeLanguage('ja');
    await changeLanguage('en');
    resolveJapanese();await old;
    assert.equal(getLanguage(),'en');assert.equal(node.textContent,'Share on X');
    assert.equal(settings.get('goriragouu-language'),'en');
    assert.equal(settings.get('goriragouu-sound'),'off');
    assert.equal(settings.get('goriragouu-best-score'),'42');
    assert.equal(settings.get('chameleonjp_goriragouu_player_name'),'名前');
    assert.equal(t('points',{score:123}),'123 pts');
  }finally{Object.assign(globalThis,previous);}
});
test('a stalled initial translation renders fallback immediately and cannot block game startup',async()=>{
  let resolveTranslation;
  const node={dataset:{i18n:'start'},textContent:''};
  const previous={fetch:globalThis.fetch,document:globalThis.document,localStorage:globalThis.localStorage};
  globalThis.document={documentElement:{},querySelectorAll:()=>[node],querySelector:()=>null,dispatchEvent:()=>{}};
  globalThis.localStorage={getItem:()=> 'fr'};
  globalThis.fetch=()=>new Promise(resolve=>{resolveTranslation=()=>resolve({ok:true,json:async()=>({start:'Entrer sous la pluie'})});});
  try{
    assert.equal(initI18n(),undefined);
    assert.equal(node.textContent,'Enter the downpour');
    assert.equal(document.documentElement.lang,'en');
    resolveTranslation();
    // Wait for the pending fetch without depending on a gameplay timer.
    await new Promise(resolve=>setImmediate(resolve));
  }finally{Object.assign(globalThis,previous);}
});
test('a failed language request keeps the desired preference for the next visit',async()=>{
  const settings=new Map();
  const previous={fetch:globalThis.fetch,document:globalThis.document,localStorage:globalThis.localStorage};
  globalThis.document={documentElement:{},querySelectorAll:()=>[],querySelector:()=>null,dispatchEvent:()=>{}};
  globalThis.localStorage={setItem:(k,v)=>settings.set(k,v)};
  globalThis.fetch=async()=>{throw new Error('offline')};
  try{
    await changeLanguage('de');
    assert.equal(getLanguage(),'en');
    assert.equal(settings.get('goriragouu-language'),'de');
  }finally{Object.assign(globalThis,previous);}
});
