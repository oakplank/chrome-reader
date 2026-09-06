const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const extension = path.resolve(__dirname, '..'), out = path.join(extension, 'test-results');
fs.mkdirSync(out, { recursive:true });
const sentence = 'Reading a long article should feel continuous. Your eyes follow the words in their original place while a gentle highlight sets the pace. The page should move naturally as each line reaches the edge of the window. ';
function fixture(kind) {
  return `<!doctype html><meta charset="utf-8"><title>Reading experience</title>
  <style>body{margin:0;color:#202a34;font:22px/1.8 Georgia,serif}main{max-width:660px;margin:60px auto;padding:0 18px}h1{font-size:36px;line-height:1.2}article{${kind === 'nested' ? 'height:440px;overflow:auto;border:1px solid #bbb;padding:12px;' : ''}}p{margin:28px 0}aside{background:#eee;padding:24px}</style>
  <main><h1>Keeping your place in a long article</h1><article><p id="prose">${sentence.repeat(kind === 'normal' ? 2 : 18)}</p><aside>INNER RELATED LINKS</aside><nav>ARTICLE NAVIGATION</nav></article><aside>OUTER RELATED LINKS</aside></main><footer>FOOTER NEWSLETTER</footer>`;
}
const server = http.createServer((req,res) => {res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});res.end(fixture(req.url.slice(1)));});
let context, profile;
(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  profile = fs.mkdtempSync(path.join(os.tmpdir(),'reader-experience-'));
  context = await chromium.launchPersistentContext(profile, { channel:'chromium',headless:true,viewport:{width:1100,height:700},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage(), results = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  async function setup(kind, nearBottom = false, width = 1100) {
    await page.setViewportSize({width,height:700});
    await page.goto(`http://127.0.0.1:${server.address().port}/${kind}`); await page.bringToFront();
    await worker.evaluate(() => chrome.storage.local.set({readerPreferences:{wpm:300,dark:false}}));
    await page.evaluate(({nearBottom,kind}) => {
      const node = document.querySelector('#prose').firstChild;
      const words = [...node.data.matchAll(/[\p{L}\p{M}\p{N}]+[.,!?;:…]*/gu)].map(m => ({text:m[0],start:m.index,end:m.index+m[0].length}));
      const bottom = kind === 'nested' ? Math.min(innerHeight,document.querySelector('article').getBoundingClientRect().bottom) : innerHeight;
      const chosen = nearBottom ? words.findIndex(w => {const r = document.createRange();r.setStart(node,w.start);r.setEnd(node,w.end);const b = r.getBoundingClientRect();return b.top > bottom - 95 && b.bottom < bottom - 30;}) : 0;
      if (chosen < 0) throw Error('No starting word near the lower edge');
      window.expected = words.slice(chosen);
      const w = words[chosen], r = document.createRange();r.setStart(node,w.start);r.setEnd(node,w.end);getSelection().removeAllRanges();getSelection().addRange(r);
    },{nearBottom,kind});
    await worker.evaluate(async () => {const [tab] = await chrome.tabs.query({active:true,currentWindow:true});await startInTab(tab.id);});
    await page.getByRole('dialog',{name:'Speed Reader'}).waitFor();
    await page.evaluate(kind => {
      const root = document.querySelector('[data-speed-reader]').shadowRoot;
      window.samples = [];
      function collect() {
        const h = root.querySelector('.highlight').getBoundingClientRect(), panel = root.querySelector('.panel').getBoundingClientRect();
        const progress = Number(root.querySelector('.status').textContent.match(/^\d+/)?.[0]);
        if (!progress || samples.at(-1)?.progress === progress) return;
        const w = expected[progress - 1], r = document.createRange();
        r.setStart(document.querySelector('#prose').firstChild,w.start);r.setEnd(document.querySelector('#prose').firstChild,w.end);
        const b = r.getBoundingClientRect(), article = document.querySelector('article').getBoundingClientRect();
        samples.push({progress,time:performance.now(),word:root.querySelector('.current').textContent,expected:w.text,
          alignmentError:Math.max(Math.abs(b.x-h.x),Math.abs(b.y-h.y),Math.abs(b.width-h.width),Math.abs(b.height-h.height)),
          visible:h.top>=0&&h.bottom<=innerHeight&&(kind!=='nested'||h.top>=article.top&&h.bottom<=article.bottom),
          covered:h.left<panel.right&&h.right>panel.left&&h.top<panel.bottom&&h.bottom>panel.top,
          scrollY,articleScroll:document.querySelector('article').scrollTop});
      }
      new MutationObserver(collect).observe(root.querySelector('.current'),{childList:true,characterData:true,subtree:true});collect();
    },kind);
  }
  for (const [kind,nearBottom,width] of [['normal',false,1100],['long',true,1100],['long',true,320],['nested',true,1100]]) {
    await setup(kind,nearBottom,width);
    await page.waitForFunction(() => samples.length >= 30);
    await page.getByRole('button',{name:'Pause reading',exact:true}).click();
    const samples = await page.evaluate(() => window.samples);
    assert(samples.every(s => s.word === s.expected && s.alignmentError < 1),'highlight tracks each exact word');
    assert(samples.every(s => s.visible),'every word stays in the viewport and scroll container');
    assert(samples.every(s => !s.covered),'controls never cover the current word');
    if (kind === 'long') assert(samples.some(s => s.scrollY > 0),'long paragraphs scroll');
    if (kind === 'nested') assert(samples.some(s => s.articleScroll > 0),'nested reading pane scrolls');
    const meanInterval = (samples.at(-1).time-samples[0].time)/(samples.length-1);
    assert(meanInterval > 160 && meanInterval < 280,'300 WPM pacing');
    const screenshot = `${kind}-${width}.png`;
    await page.screenshot({path:path.join(out,screenshot)});
    results.push({kind,width,samples,meanInterval,screenshot});
    console.log(`PASS: ${kind} at ${width}px: ${samples.length} aligned, visible, uncovered words`);
    const before = await page.evaluate(() => [scrollY,document.querySelector('article').scrollTop]);
    await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(() => [scrollY,document.querySelector('article').scrollTop]),before,'pause also stops auto-scroll');
  }
  await setup('normal');
  await page.getByRole('button',{name:'Show floating word view',exact:true}).click();
  assert(await page.locator('[data-speed-reader] .words').isVisible());
  await page.getByRole('button',{name:'Hide floating word view',exact:true}).click();
  assert(!(await page.locator('[data-speed-reader] .words').isVisible()));
  await page.getByRole('slider').fill('800');
  await page.getByRole('button',{name:'Read again',exact:true}).waitFor();
  assert.equal(await page.locator('[data-speed-reader] .current').textContent(),'window.');
  const expectedCount = await page.evaluate(() => expected.length);
  assert.equal(await page.evaluate(() => samples.length),expectedCount,'reads complete article, excludes navigation and related links');
  results.push({kind:'complete-article',words:expectedCount,stoppedAt:'window.',wordViewToggle:true});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'reading-experience.json'),JSON.stringify({passed:true,results,errors},null,2));
  console.log('PASS: complete article stops before related links; optional word view; no page errors');
})().catch(error => {console.error(error);process.exitCode=1;}).finally(async () => {
  await context?.close();server.close();
  if (profile && path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep)) fs.rmSync(profile,{recursive:true,force:true});
});
