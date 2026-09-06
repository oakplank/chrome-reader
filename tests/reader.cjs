const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const extension = path.resolve(__dirname, '..');
const results = path.join(extension, 'test-results');
fs.mkdirSync(results, { recursive: true });
const fixture = `<!doctype html><meta charset="utf-8"><title>Reader regression fixture</title>
<style>body{font:20px/1.7 Georgia,serif;margin:48px;max-width:640px} .gone{display:none} button{font-size:60px!important} h1{font-size:30px}</style>
<h1>A reading test</h1><p id="first">echo earlier occurrence.</p>
<p id="second">echo café isn't naïve. This is the exact selected occurrence.</p>
<p id="multi">Start <em>across inline</em> elements and finish here.</p>
<p hidden>hiddenSecret</p><div class="gone"><p>nestedHidden</p></div><p style="visibility:hidden">invisibleSecret</p>
<p aria-hidden="true">ariaHidden</p><p contenteditable="true">editableSecret</p><textarea>fieldSecret</textarea>
<script type="application/json">{"scriptSecret":"not prose"}</script>
<p id="last">Last word.</p>`;
const server = http.createServer((req,res) => { res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });res.end(fixture); });
let context, profile;

(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  profile = fs.mkdtempSync(path.join(os.tmpdir(),'chrome-reader-test-'));
  context = await chromium.launchPersistentContext(profile, {
    headless:true, channel:'chromium', viewport:{width:1100,height:800},
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.bringToFront();
  await worker.evaluate(() => chrome.storage.local.set({readerPreferences:{wpm:100,dark:false}}));
  const current = page.locator('[data-speed-reader] .current');
  const panel = page.getByRole('dialog',{name:'Speed Reader'});
  async function select(selector, from=0, to=4) {
    await page.evaluate(({selector,from,to}) => {
      const node = document.querySelector(selector).firstChild;
      const range = document.createRange(); range.setStart(node,from);range.setEnd(node,to);
      const selection = getSelection();selection.removeAllRanges();selection.addRange(range);
    },{selector,from,to});
  }
  async function start() {
    await worker.evaluate(async () => {
      const tabs = await chrome.tabs.query({active:true,currentWindow:true});
      await startInTab(tabs[0].id);
    });
    await panel.waitFor();
  }
  await select('#second'); await start();
  assert.equal(await current.textContent(),'echo');
  assert.equal(await page.evaluate(() => getSelection().isCollapsed),true,'native selection does not compete with reading highlight');
  await page.waitForTimeout(100);
  assert.equal(await current.textContent(),'echo','first word gets a full interval');
  await page.waitForTimeout(600);
  assert.equal(await current.textContent(),'café','starts at the selected repeated word');
  await page.getByRole('button',{name:'Pause reading',exact:true}).click();
  const pausedWord = await current.textContent();
  await page.waitForTimeout(650); assert.equal(await current.textContent(),pausedWord);
  console.log('PASS: exact occurrence, first-word timing, Unicode and pause');
  await page.getByRole('button',{name:'Restart reading',exact:true}).click();
  assert.equal(await current.textContent(),'echo');
  assert.match(await page.locator('[data-speed-reader] .status').textContent(),/Paused/);
  await page.getByRole('slider').fill('450');
  await page.getByRole('button',{name:'Toggle reader theme'}).click();
  await page.getByRole('button',{name:'Show floating word view',exact:true}).click();
  await page.screenshot({path:path.join(results,'reader-desktop.png')});
  await page.keyboard.press('Escape'); assert.equal(await panel.count(),0);
  await select('#multi',0,5); await start();
  await page.getByRole('button',{name:'Pause reading',exact:true}).click();
  assert.equal(await current.textContent(),'Start');
  assert.equal(await page.getByRole('slider').inputValue(),'450');
  assert.match(await panel.getAttribute('class'),/dark/);
  assert(await page.locator('[data-speed-reader] .words').isVisible(),'word-view preference survives reopen');
  const status = await page.locator('[data-speed-reader] .status').textContent();
  assert.match(status,/of 9 words/,'hidden, editable and script text is excluded');
  console.log('PASS: restart preserves pause; preferences survive reopen; excluded text');
  await page.keyboard.press('Escape');
  await worker.evaluate(() => chrome.storage.local.set({readerPreferences:{wpm:100,dark:false}}));
  await page.evaluate(() => {
    const range=document.createRange();range.setStart(document.querySelector('#multi').firstChild,0);
    range.setEnd(document.querySelector('#multi em').firstChild,13);
    const s=getSelection();s.removeAllRanges();s.addRange(range);
  });
  await start();assert.equal(await current.textContent(),'Start');
  await page.getByRole('button',{name:'Pause reading',exact:true}).click();
  assert.equal(await page.locator('[data-speed-reader] .context').last().textContent(),'across');
  await page.setViewportSize({width:320,height:640});
  const bounds = await panel.boundingBox(); assert(bounds.x>=0 && bounds.x+bounds.width<=320);
  const overflowing = await panel.evaluate(p=>p.scrollWidth>p.clientWidth);assert.equal(overflowing,false);
  await page.screenshot({path:path.join(results,'reader-mobile.png')});
  console.log('PASS: multi-node selection and narrow layout');
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1100,height:800});
  await select('#last',5,10); await start();
  assert.equal(await current.textContent(),'word.');
  await page.getByRole('button',{name:'Read again',exact:true}).waitFor();
  assert.equal(await current.textContent(),'word.');
  await page.getByRole('button',{name:'Read again',exact:true}).click();
  assert.equal(await current.textContent(),'word.');
  await page.keyboard.press('Escape');
  for(let i=0;i<4;i++){await select('#second');await start();await page.keyboard.press('Escape');}
  assert.equal(await page.locator('[data-speed-reader]').count(),0);
  await page.waitForTimeout(700);assert.equal(await page.locator('[data-speed-reader]').count(),0);
  await select('#second');await start();
  await page.evaluate(()=>{ document.querySelector('#second').firstChild.data='edit café changed content.'; });
  await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));
  assert.match(await page.locator('[data-speed-reader] .status').textContent(),/page changed/);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>getSelection().removeAllRanges());await start();
  assert.equal(await page.getByRole('button',{name:'Pause reading',exact:true}).isDisabled(),true);
  assert.match(await page.locator('[data-speed-reader] .message').textContent(),/Select a word/);
  assert.deepEqual(errors,[]);
  console.log('PASS: finish/replay, repeated cleanup, changed-page pause, empty-selection guidance; no page errors');
  await page.keyboard.press('Escape');
  await page.goto('chrome://version');
  const badge = await worker.evaluate(async()=>{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    await startInTab(tab.id);
    return chrome.action.getBadgeText({tabId:tab.id});
  });
  assert.equal(badge,'!');
  console.log('PASS: unsupported pages show an actionable toolbar error');
  fs.writeFileSync(path.join(results,'summary.json'),JSON.stringify({passed:true,checks:['selection','timing','unicode','pause','restart','preferences','hidden-text','multi-node','responsive','finish','cleanup','page-mutation','empty-selection','unsupported-page'],errors},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await context?.close();server.close();
  if(profile && path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep)) fs.rmSync(profile,{recursive:true,force:true});
});
