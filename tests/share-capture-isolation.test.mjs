import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('normal share acceptance never captures canvas or changes renderer while playing',()=>{
 const source=readFileSync(new URL('../tools/share-acceptance.cjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/toDataURL|readPixels|renderer\.render\s*=/);
 const start=source.indexOf("await page.locator('#start-button').click()"),result=source.indexOf('// Restore browser display only after the genuine result');
 assert.ok(start>0&&result>start);assert.doesNotMatch(source.slice(start,result),/setViewportSize|exitFullscreen/);
});
test('optional capture requires explicit opt-in, with isolated context and no CI opt-in',()=>{
 const smoke=readFileSync(new URL('../tools/browser-smoke.cjs',import.meta.url),'utf8');
 assert.match(smoke,/if\(process\.env\.GORILLA_CAPTURE_SHARE_MATERIAL==='1'\)/);
 assert.ok(smoke.indexOf('await page.context().close()')<smoke.indexOf('await checkShareAcceptance('));
 for(const name of ['ci.yml','pages.yml'])assert.doesNotMatch(readFileSync(new URL('../.github/workflows/'+name,import.meta.url),'utf8'),/GORILLA_CAPTURE_SHARE_MATERIAL/);
 const capture=readFileSync(new URL('../tools/share-material-capture.cjs',import.meta.url),'utf8');
 assert.match(capture,/await isolateBrowserNetwork\(context,baseURL\)/);assert.match(capture,/finally\{await context\.close\(\);\}/);
});
