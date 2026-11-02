// Explicit optional material acquisition; never runs in standard CI acceptance.
const assert=require('node:assert/strict');
const {mkdirSync,writeFileSync}=require('node:fs');const {resolve}=require('node:path');
const {isolateBrowserNetwork}=require('./browser-network-safety.cjs');
async function captureShareMaterial(browser,engine,baseURL){
 const dir=resolve(process.env.GORILLA_TEST_ARTIFACTS||'test-artifacts/share');mkdirSync(dir,{recursive:true});
 const context=await browser.newContext({viewport:{width:1200,height:800},isMobile:true,hasTouch:true,locale:'ja-JP',serviceWorkers:'block'});
 try{
  await isolateBrowserNetwork(context,baseURL);
  await context.route(baseURL+'mock-rpc/**',route=>{assert.equal(route.request().url().split('/').pop(),'get_best_score_ranking');return route.fulfill({json:[]});});
  const page=await context.newPage();await page.goto(baseURL+'?device=sp&quality=low');await page.waitForFunction(()=>window.__testGame&&window.__GORILLA_RAIN_READY__);
  await page.selectOption('#language-select','ja');await page.locator('#home-sound-button').click();await page.locator('#player-name-input').fill('');await page.locator('#start-button').click();await page.waitForFunction(()=>window.__testGame.mode==='playing');
  // Observe a subsequent real renderer call; never invoke render, finish, or change game time.
  const png=await page.evaluate(()=>new Promise((resolve,reject)=>{const renderer=window.__testGame.renderer,original=renderer.render;let frames=0;const timer=setTimeout(()=>{renderer.render=original;reject(Error('No actual frame for capture'))},5000);renderer.render=function(...args){const result=original.apply(this,args);if(++frames>=2){try{const png=this.domElement.toDataURL('image/png');renderer.render=original;clearTimeout(timer);resolve(png);}catch(error){renderer.render=original;clearTimeout(timer);reject(error);}}return result;};}));
  assert.match(png,/^data:image\/png;base64,/);writeFileSync(resolve(dir,`${engine}-actual-canvas.png`),Buffer.from(png.split(',')[1],'base64'));await page.screenshot({path:resolve(dir,`${engine}-actual-game.png`)});
  // Capture only naturally spawned, visibly sized gorillas observed in a real draw.
  const encounter=await page.evaluate(async()=>{
   return new Promise((resolve,reject)=>{const game=window.__testGame,renderer=game.renderer,original=renderer.render;let frames=0,observedFrames=0,maxBrownCount=0;const initial={mode:game.mode,elapsed:game.gameElapsed};
    const timer=setTimeout(()=>{renderer.render=original;resolve({png:null,unavailable:true,observations:{initial,mode:game.mode,elapsed:game.gameElapsed,observedFrames,maxBrownCount,visibility:document.visibilityState,focused:document.hasFocus()}});},25000);
    renderer.render=function(...args){const result=original.apply(this,args);
     const mesh=game.gorillaRenderer.brown,visible=[];observedFrames++;maxBrownCount=Math.max(maxBrownCount,mesh.count);
     // setBrownParts stores six boxes per gorilla, torso first. Inspect its actual world matrix, not a surface-position estimate.
     let shown=true;for(let node=mesh;node;node=node.parent)if(!node.visible)shown=false;
     if(shown&&mesh.material.visible&&mesh.material.opacity>0)for(let i=0;i<mesh.count;i+=6){const matrix=mesh.matrixWorld.clone();mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);const scale=game.gorillaRenderer.scale.clone().setFromMatrixScale(matrix),world=game.gorillaRenderer.position.clone().setFromMatrixPosition(matrix),p=world.clone().project(game.camera);if(Math.min(scale.x,scale.y,scale.z)>0.5&&world.dot(game.camera.position)>0&&Math.abs(p.x)<0.8&&Math.abs(p.y)<0.8&&p.z>-1&&p.z<1)visible.push(i/6);}
     frames=game.mode==='playing'&&visible.length?frames+1:0;
     if(frames>=2){try{const png=this.domElement.toDataURL('image/png');renderer.render=original;clearTimeout(timer);resolve({png,visibleGorillas:visible.length,elapsed:game.gameElapsed});}catch(error){renderer.render=original;clearTimeout(timer);reject(error);}}return result;
    };
   });
  });
  if(encounter.png){assert.match(encounter.png,/^data:image\/png;base64,/);writeFileSync(resolve(dir,`${engine}-natural-gorilla-canvas.png`),Buffer.from(encounter.png.split(',')[1],'base64'));console.log(JSON.stringify({engine,naturalGorillaCapture:{visibleGorillas:encounter.visibleGorillas,elapsed:encounter.elapsed}}));}else{console.log(JSON.stringify({engine,naturalGorillaCaptureUnavailable:encounter.observations}));await page.screenshot({path:resolve(dir,`${engine}-natural-gorilla-unavailable.png`)});}
 }finally{await context.close();}
}
module.exports={captureShareMaterial};
