const assert=require('node:assert/strict');
const {mkdirSync,writeFileSync}=require('node:fs');const {resolve}=require('node:path');
const {isolateBrowserNetwork}=require('./browser-network-safety.cjs');
const languages=['ja','en','es','pt-BR','zh-Hans','fr','de','ko','ru','it','zh-Hant','id','tr','vi','th'];
function targetMetrics(el){
 const rect=el.getBoundingClientRect(),style=getComputedStyle(el);let opacity=1,visible=true;
 for(let node=el;node;node=node.parentElement){const s=getComputedStyle(node);opacity*=Number(s.opacity);if(node.hidden||s.display==='none'||['hidden','collapse'].includes(s.visibility))visible=false;}
 const hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
 return {width:rect.width,height:rect.height,left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,vw:innerWidth,vh:innerHeight,visible,opacity,hit:hit===el||el.contains(hit),disabled:el.disabled,text:el.textContent.trim(),background:style.backgroundColor,color:style.color,clipped:el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1};
}
async function settle(el){
 let previous='',stable=0;
 for(let frame=0;frame<120;frame++){
  await new Promise(resolve=>requestAnimationFrame(resolve));let active=false;
  for(let node=el;node;node=node.parentElement)if(node.getAnimations().some(a=>a.effect?.getTiming().iterations!==Infinity&&(a.pending||a.playState==='running')))active=true;
  const r=el.getBoundingClientRect(),key=JSON.stringify([r.x,r.y,r.width,r.height]);stable=!active&&key===previous?stable+1:0;previous=key;if(stable>=2)return;
 }
 throw Error('Share target layout did not stabilize: '+previous);
}
async function accept(page,selector,lang,screen,engine,dir){
 const button=page.locator(selector),sizes=['ja','en','de'].includes(lang)?[{width:393,height:852},{width:852,height:393},{width:393,height:600}]:[{width:393,height:852}];
 for(const size of sizes){
  const prefix=resolve(dir,`${engine}-${lang}-${screen}-${size.width}x${size.height}`);await page.setViewportSize(size);await button.scrollIntoViewIfNeeded();
  try{await button.evaluate(settle);}catch(error){await page.screenshot({path:prefix+'-stability-failure.png'});throw error;}
  const m=await button.evaluate(targetMetrics);await page.screenshot({path:prefix+'-diagnostic.png'});
  assert.ok(m.visible&&m.opacity===1&&!m.disabled&&m.hit,JSON.stringify(m));assert.ok(m.width>=44&&m.height>=44,JSON.stringify(m));assert.ok(m.left>=0&&m.right<=m.vw+1&&m.top>=0&&m.bottom<=m.vh+1);assert.equal(m.clipped,false);assert.equal(m.background,'rgb(0, 0, 0)');assert.equal(m.color,'rgb(255, 255, 255)');if(lang==='ja')assert.equal(m.text,'Xでシェア');
  await button.focus();await page.mouse.move((m.left+m.right)/2,(m.top+m.bottom)/2);await page.mouse.down();const pressed=await button.evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
  if(['ja','en','de'].includes(lang))await page.screenshot({path:prefix+'-pressed.png'});await page.mouse.move(0,0);await page.mouse.up();assert.equal(pressed.background,'rgb(0, 0, 0)');assert.equal(pressed.color,'rgb(255, 255, 255)');
  const count=await page.evaluate(()=>window.__shareIntents.length);await button.tap();await page.waitForFunction(n=>window.__shareIntents.length===n+1,count);
  const url=new URL(await page.evaluate(()=>window.__shareIntents.at(-1)));assert.equal(url.origin,'https://x.com');assert.equal(url.pathname,'/intent/tweet');const text=url.searchParams.get('text');assert.match(text,/#ゴリラ豪雨 #ゲーム制作/u);assert.ok(text.includes('https://chameleonjp-lab.github.io/goriragouu/'));
  if(screen==='result')assert.ok(text.includes((await page.locator('#result-score').textContent()).trim()));
 }
}
async function checkShareAcceptance(browser,engine,baseURL){
 const dir=resolve(process.env.GORILLA_TEST_ARTIFACTS||'test-artifacts/share');mkdirSync(dir,{recursive:true});
 const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true,locale:'ja-JP',serviceWorkers:'block'});
 try{
  await isolateBrowserNetwork(context,baseURL);const calls=[];
  await context.route(baseURL+'mock-rpc/**',route=>{const name=route.request().url().split('/').pop();calls.push(name);if(name!=='get_best_score_ranking')throw Error('Anonymous acceptance must not submit a score');return route.fulfill({json:Array.from({length:30},(_,i)=>({rank_no:i+1,display_name:`Mock Player ${i+1}`,best_score:9000-i}))});});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__shareIntents=[];window.open=url=>{window.__shareIntents.push(url);return {opener:null}}});
  await page.goto(baseURL+'?device=sp&quality=low');await page.waitForFunction(()=>window.__testGame&&window.__GORILLA_RAIN_READY__);await page.locator('#home-screen').waitFor({state:'visible'});
  const target=page.locator('#home-share-button');for(const [property,value] of [['opacity','0'],['display','none']]){const old=await target.evaluate((el,[p,v])=>{const old=el.parentElement.style[p];el.parentElement.style[p]=v;return old;},[property,value]);try{const m=await target.evaluate(targetMetrics);assert.ok(!m.visible||m.opacity===0);}finally{await target.evaluate((el,[p,v])=>el.parentElement.style[p]=v,[property,old]);}}
  for(const lang of languages){await page.selectOption('#language-select',lang);await page.waitForFunction(l=>document.documentElement.lang===l,lang);await accept(page,'#home-share-button',lang,'home',engine,dir);}
  await page.selectOption('#language-select','ja');await page.waitForFunction(()=>document.documentElement.lang==='ja');await page.locator('#home-sound-button').click();await page.locator('#player-name-input').fill('');await page.setViewportSize({width:393,height:852});await page.locator('#start-button').click();
  // No capture, resize, renderer wrapper or pixel reads during normal play.
  const displayState=()=>({mode:window.__testGame.mode,elapsed:window.__testGame.gameElapsed,fullscreen:!!document.fullscreenElement,visibility:document.visibilityState,focused:document.hasFocus()});
  const deadline=Date.now()+120000;let resumedPause=false;
  try{
   for(;;){const remaining=deadline-Date.now();assert.ok(remaining>0,'Natural result exceeded 120 seconds');await page.waitForFunction(()=>['result','paused'].includes(window.__testGame.mode),{},{timeout:remaining});const state=await page.evaluate(displayState);if(state.mode==='result')break;
    console.log(JSON.stringify({engine,naturalPlayPause:state,resumedPause}));
    assert.ok(!resumedPause&&await page.locator('#resume-button').isVisible(),'Second pause or missing normal resume control');
    await page.locator('#resume-button').click();resumedPause=true;
   }
  }catch(error){console.log(JSON.stringify({engine,naturalResultFailure:await page.evaluate(displayState)}));await page.screenshot({path:resolve(dir,`${engine}-natural-result-failure.png`)});throw error;}
  console.log(JSON.stringify({engine,naturalPlayResumedOnce:resumedPause}));
  // Restore browser display only after the genuine result is complete.
  await page.evaluate(async()=>{if(document.fullscreenElement)await document.exitFullscreen();});await page.waitForFunction(()=>!document.fullscreenElement);await page.setViewportSize({width:393,height:852});
  await page.locator('#result-screen').waitFor({state:'visible'});
  const result=await page.evaluate(()=>({elapsed:window.__testGame.gameElapsed,bananas:window.__testGame.bananaCount,mode:window.__testGame.mode}));assert.ok(result.elapsed>0);assert.equal(calls.filter(x=>x==='submit_score_once_shared_v1').length,0);
  await page.evaluate(async()=>{window.__shareLanguage=await import('/src/i18n.js')});
  for(const lang of languages){await page.evaluate(lang=>window.__shareLanguage.changeLanguage(lang),lang);await accept(page,'#share-button',lang,'result',engine,dir);assert.deepEqual(await page.evaluate(()=>({elapsed:window.__testGame.gameElapsed,bananas:window.__testGame.bananaCount,mode:window.__testGame.mode})),result);}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({engine,shareAcceptance15Locales:true,actualNaturalResult:result,anonymousScoreWrites:0}));
 }finally{await context.close();}
}
module.exports={checkShareAcceptance};
