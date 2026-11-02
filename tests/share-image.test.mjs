import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const imageURL='https://chameleonjp-lab.github.io/goriragouu/assets/goriragouu-og-v1.png';
test('home and result canonical URL automatically exposes a real 1200x630 SNS image',()=>{
 for(const [key,value] of [['og:image',imageURL],['twitter:image',imageURL],['twitter:card','summary_large_image'],['og:image:type','image/png'],['og:image:width','1200'],['og:image:height','630']]) assert.match(html,new RegExp(`(?:property|name)="${key}" content="${value.replaceAll('.','\\.')}"`));
 const png=readFileSync(new URL('../assets/goriragouu-og-v1.png',import.meta.url));
 assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
});
test('deployment runtime package includes the image without shipping composition sources',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/pages.yml',import.meta.url),'utf8');
 assert.match(workflow,/cp -R src assets site\//);
 assert.doesNotMatch(workflow,/cp.*docs.*site/);
});

test('X has no redundant standalone copy UI while blocked-popup fallback remains',()=>{
 assert.doesNotMatch(html,/<(?:button|a)[^>]*(?:id|data-i18n)="[^"]*copy/i);
 const game=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
 assert.match(game,/navigator\.clipboard\.writeText/);
 assert.match(game,/window\.prompt/);
});
