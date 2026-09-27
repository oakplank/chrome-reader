const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const extension=path.resolve(__dirname,'..'),out=path.join(extension,'test-results');
const fixture=`<!doctype html><meta charset="utf-8"><style>
body{font:20px/1.6 Georgia;margin:40px}article{max-width:650px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.clip-path{position:absolute;clip-path:inset(50%)}
</style><main><h1 id="title">Reading example</h1><nav>Toolbar secret</nav><article class="mw-parser-output">
<p id="start">Visible opening.</p>
<span class="sr-only"><span>Screenreader secret</span></span>
<span class="clip-path"><span>Clipped secret</span></span>
<div style="opacity:0"><p>Transparent ancestor secret</p></div>
<p style="color:transparent">Transparent ink secret</p>
<p style="position:absolute;left:-10000px">Offscreen secret</p>
<p style="text-indent:-10000px">Indented secret</p>
<div style="height:0;overflow:hidden"><p>Collapsed secret</p></div>
<div style="content-visibility:hidden"><p>Unrendered secret</p></div>
<details><summary>Visible summary.</summary><p>Closed disclosure secret</p></details>
<table class="sidebar"><tr><td>Wikipedia sidebar secret</td></tr></table>
<div class="navbox">Related navigation secret</div>
<p><span style="display:contents">Visible contents.</span></p>
<div style="height:1200px"></div><p id="end">Visible ending.</p>
</article></main>`;
const expected='Visible opening. Visible summary. Visible contents. Visible ending.';
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(fixture);});
let context,profile;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 profile=fs.mkdtempSync(path.join(os.tmpdir(),'reader-visible-'));
 context=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',viewport:{width:1100,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.bringToFront();
 await worker.evaluate(()=>chrome.storage.local.set({readerPreferences:{wpm:800}}));
 async function start(selector){
  await page.evaluate(selector=>{const n=document.querySelector(selector).firstChild,r=document.createRange();r.setStart(n,0);r.setEnd(n,7);getSelection().removeAllRanges();getSelection().addRange(r);},selector);
  await worker.evaluate(async()=>{const[t]=await chrome.tabs.query({active:true,currentWindow:true});await startInTab(t.id);});
  await page.getByRole('dialog',{name:'Speed Reader'}).waitFor();
 }
 await start('#start');
 await page.evaluate(()=>{const r=document.querySelector('[data-speed-reader]').shadowRoot;window.seen=[r.querySelector('.current').textContent];new MutationObserver(()=>seen.push(r.querySelector('.current').textContent)).observe(r.querySelector('.current'),{childList:true});});
 await page.getByRole('button',{name:'Read again',exact:true}).waitFor({timeout:5000});
 const seen=await page.evaluate(()=>seen.filter((w,i,a)=>!i||w!==a[i-1]));
 assert.equal(seen.join(' '),expected,'only readable article words, including below the fold and display:contents');
 await page.screenshot({path:path.join(out,'visible-text.png')});
 console.log('PASS: clipped, transparent, offscreen, collapsed and sidebar content excluded; below-fold and display:contents retained');
 await page.keyboard.press('Escape');
 await start('#title');
 assert.equal(await page.locator('[data-speed-reader] .current').textContent(),'Visible','selecting the page title enters the article, not toolbar menus');
 await page.keyboard.press('Escape');
 await worker.evaluate(()=>{chrome.tts.getVoices=async()=>[{voiceName:'Test',lang:'en',remote:false,eventTypes:['start','word','end']}];chrome.tts.speak=async(text,options)=>{globalThis.spoken=text;options.onEvent({type:'start'});};chrome.tts.stop=()=>{};});
 await worker.evaluate(()=>chrome.storage.local.set({readerPreferences:{wpm:100}}));
 await start('#start');await page.getByRole('button',{name:'Read aloud',exact:true}).click();
 assert.equal(await worker.evaluate(()=>spoken),expected,'speech uses the same visible words');
 await page.evaluate(()=>document.querySelector('#end').style.display='none');
 await page.getByRole('button',{name:'Resume reading',exact:true}).waitFor();
 assert.match(await page.locator('[data-speed-reader] .speech-note').textContent(),/passage changed/,'hiding a future word stops the active speech chunk');
 await page.evaluate(()=>document.querySelector('#end').style.display='');
 await page.keyboard.press('Escape');await start('#start');
 await page.evaluate(()=>document.querySelector('#start').style.opacity='0');
 await page.getByRole('button',{name:'Resume reading',exact:true}).waitFor();
 assert.match(await page.locator('[data-speed-reader] .status').textContent(),/page changed/i);
 fs.writeFileSync(path.join(out,'visible-text.json'),JSON.stringify({passed:true,words:seen,speech:expected,dynamicHidingPauses:true},null,2));
 console.log('PASS: speech excludes hidden text; hiding the active passage pauses playback');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await context?.close();server.close();if(profile&&path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep))fs.rmSync(profile,{recursive:true,force:true});});
