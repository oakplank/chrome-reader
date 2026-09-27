// Optional network smoke test for the page that exposed the reading failure.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const extension=path.resolve(__dirname,'..'),out=path.join(extension,'test-results');
let context,profile;
(async()=>{
 fs.mkdirSync(out,{recursive:true});profile=fs.mkdtempSync(path.join(os.tmpdir(),'reader-wikipedia-'));
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1280,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),page=await context.newPage();
 await page.goto('https://en.wikipedia.org/wiki/Speed_reading',{waitUntil:'networkidle',timeout:45000});await page.bringToFront();
 await worker.evaluate(()=>chrome.storage.local.set({readerPreferences:{wpm:300}}));
 const expected=await page.evaluate(()=>{
  const title=document.querySelector('h1'),r=document.createRange();r.selectNodeContents(title);getSelection().removeAllRanges();getSelection().addRange(r);
  const container=document.querySelector('.mw-parser-output');
  const paras=[...container.querySelectorAll('p')].filter(p=>p.textContent.trim()&&!p.closest('table,figure,.hatnote,.metadata,.sidebar,.navbox'));
  return paras.slice(0,2).flatMap(p=>{const copy=p.cloneNode(true);copy.querySelectorAll('.reference').forEach(n=>n.remove());return [...copy.textContent.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’‐-][\p{L}\p{M}\p{N}]+)*[.,!?;:…]*/gu)].map(m=>m[0]);});
 });
 assert.equal(expected[0],'Speed','fixture is the actual article introduction');
 await worker.evaluate(async()=>{const[t]=await chrome.tabs.query({active:true,currentWindow:true});await startInTab(t.id);});
 await page.getByRole('dialog',{name:'Speed Reader'}).waitFor();
 await page.evaluate(()=>{
  const root=document.querySelector('[data-speed-reader]').shadowRoot;window.samples=[];
  function sample(){const n=Number(root.querySelector('.status').textContent.match(/^\d+/)?.[0]);if(!n||samples.at(-1)?.n===n)return;const h=root.querySelector('.highlight').getBoundingClientRect();samples.push({n,word:root.querySelector('.current').textContent,visible:h.width>1&&h.height>1&&h.top>=0&&h.bottom<=innerHeight});}
  new MutationObserver(sample).observe(root.querySelector('.current'),{childList:true});sample();
 });
 await page.waitForFunction(count=>samples.length>=count,expected.length,{timeout:45000});
 await page.getByRole('button',{name:'Pause reading',exact:true}).click();
 const samples=await page.evaluate(()=>samples);
 const lexical = word => word.replace(/[.,!?;:…]+$/u,'');
 assert.deepEqual(samples.slice(0,expected.length).map(s=>lexical(s.word)),expected.map(lexical),'title selection reads article prose without toolbar, sidebar, hidden text or captions');
 assert(samples.every(s=>s.visible),'each highlight is visible on the original page');
 await page.screenshot({path:path.join(out,'wikipedia-speed-reading.png')});
 fs.writeFileSync(path.join(out,'wikipedia.json'),JSON.stringify({passed:true,url:page.url(),version:await worker.evaluate(()=>chrome.runtime.getManifest().version),samples},null,2));
 console.log(`PASS: live Wikipedia Speed reading: ${expected.length} consecutive article words, visible highlights, start from title`);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await context?.close();if(profile&&path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep))fs.rmSync(profile,{recursive:true,force:true});});
