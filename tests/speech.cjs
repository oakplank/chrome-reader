const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const extension=path.resolve(__dirname,'..'),results=path.join(extension,'test-results');
fs.mkdirSync(results,{recursive:true});
const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'"});res.end(`<!doctype html><html lang="en-US"><style>body{font:22px/1.7 Georgia;margin:60px;max-width:650px}</style><article><p id="text">${Array.from({length:80},(_,i)=>`word${i}`).join(' ')}</p></article></html>`);});
let context,profile;
// Deterministic silent audio exercises real HTML audio timing without using a cloud account.
function wav(seconds){const samples=16000*seconds,b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);return b.toString('base64');}
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  profile=fs.mkdtempSync(path.join(os.tmpdir(),'reader-speech-'));
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1100,height:800},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  const extensionId=new URL(worker.url()).host;
  const native=await worker.evaluate(async()=>{
    const voices=await chrome.tts.getVoices();
    return voices.filter(v=>v.remote===false).map(v=>({name:v.voiceName,events:v.eventTypes}));
  });
  let nativeSmoke={availableVoices:native.length,verified:false};
  if(native.length){
    nativeSmoke=await worker.evaluate(async()=>{
      const voice=(await chrome.tts.getVoices()).find(v=>v.remote===false);
      return new Promise(resolve=>{
        const types=[],timeout=setTimeout(()=>{chrome.tts.stop();resolve({availableVoices:1,verified:false,events:types});},10000);
        chrome.tts.speak('Reading works.',{voiceName:voice.voiceName,onEvent:e=>{types.push(e.type);if(['end','error','interrupted'].includes(e.type)){clearTimeout(timeout);resolve({availableVoices:1,verified:e.type==='end',events:types});}}}).catch(()=>{clearTimeout(timeout);resolve({availableVoices:1,verified:false});});
      });
    });
  }
  await worker.evaluate(()=>{
    globalThis.speechCalls=[];globalThis.nativeEvent=null;
    chrome.tts.getVoices=async()=>[{voiceName:'Test installed voice',lang:'en-US',remote:false,eventTypes:['start','word','end']}];
    chrome.tts.speak=async(text,options)=>{speechCalls.push({type:'speak',text,rate:options.rate});globalThis.nativeEvent=options.onEvent;options.onEvent({type:'start'});};
    for(const type of ['pause','resume','stop'])chrome.tts[type]=()=>speechCalls.push({type});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const current=page.locator('[data-speed-reader] .current'),note=page.locator('[data-speed-reader] .speech-note');
  async function setup(){
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.bringToFront();
    await page.evaluate(()=>{const r=document.createRange(),n=document.querySelector('#text').firstChild;r.setStart(n,0);r.setEnd(n,5);getSelection().removeAllRanges();getSelection().addRange(r);});
    await worker.evaluate(async()=>{const[t]=await chrome.tabs.query({active:true,currentWindow:true});await startInTab(t.id);});
    await page.getByRole('button',{name:'Read aloud',exact:true}).waitFor();
    await page.getByRole('button',{name:'Pause reading',exact:true}).click();
    await page.getByRole('button',{name:'Restart reading',exact:true}).click();
    await page.getByRole('button',{name:'Read aloud',exact:true}).click();
  }
  await setup();await page.waitForFunction(()=>document.querySelector('[data-speed-reader]').shadowRoot.querySelector('.speech-note').textContent==='Reading aloud');
  await worker.evaluate(()=>nativeEvent({type:'word',charIndex:6}));
  await page.waitForFunction(()=>document.querySelector('[data-speed-reader]').shadowRoot.querySelector('.current').textContent==='word1');
  await page.getByRole('button',{name:'Pause reading',exact:true}).click();
  assert.equal(await worker.evaluate(()=>speechCalls.at(-1).type),'pause');
  await worker.evaluate(()=>nativeEvent({type:'word',charIndex:12}));assert.equal(await current.textContent(),'word1');
  await page.getByRole('button',{name:'Resume reading',exact:true}).click();assert.equal(await worker.evaluate(()=>speechCalls.at(-1).type),'resume');
  await page.getByRole('button',{name:'Restart reading',exact:true}).click();
  await page.waitForTimeout(100);assert.equal(await current.textContent(),'word0');
  await page.getByRole('slider',{name:'Speaking speed'}).fill('150');await page.waitForTimeout(100);
  assert.equal(await worker.evaluate(()=>speechCalls.filter(c=>c.type==='speak').at(-1).rate),1.5);
  await worker.evaluate(()=>nativeEvent({type:'end'}));await page.waitForTimeout(100);
  assert.equal(await current.textContent(),'word60','end of utterance advances to next chunk');
  await worker.evaluate(()=>nativeEvent({type:'end'}));await page.getByRole('button',{name:'Read again',exact:true}).waitFor();
  assert.equal(await current.textContent(),'word79');
  await page.getByRole('button',{name:'Read again',exact:true}).click();await page.waitForTimeout(100);assert.equal(await current.textContent(),'word0');
  await page.keyboard.press('Escape');assert.equal(await worker.evaluate(()=>speechJob),null);
  console.log('PASS: native speech word events, pause/resume, rate, restart, chunk progression, finish, replay, close');

  await worker.evaluate(()=>{chrome.tts.getVoices=async()=>[];});await setup();
  await page.waitForFunction(()=>document.querySelector('[data-speed-reader]').shadowRoot.querySelector('.speech-note').textContent.includes('No installed voice'));
  assert(await page.getByRole('button',{name:'Resume reading',exact:true}).isVisible());
  await page.keyboard.press('Escape');

  const cloudAudio=wav(12);
  await worker.evaluate(async audio=>{
    globalThis.cloudRequests=[];globalThis.cloudMode='success';globalThis.cloudAudio=audio;
    chrome.permissions.contains=async()=>true;
    globalThis.fetch=async(url,options)=>{
      const body=JSON.parse(options.body);cloudRequests.push({url,body,keyProvided:options.headers['X-Goog-Api-Key']==='test-key-not-a-real-secret-12345'});
      if(cloudMode==='delay')await new Promise(r=>{globalThis.releaseCloud=r;});
      if(cloudMode==='quota')return {ok:false,status:429};
      if(cloudMode==='bad-key')return {ok:false,status:403};
      const points=[...body.input.ssml.matchAll(/name="w(\d+)"/g)].map(m=>({markName:`w${m[1]}`,timeSeconds:Number(m[1])*.2}));
      return {ok:true,json:async()=>({audioContent:cloudAudio,timepoints:points})};
    };
    await chrome.storage.local.set({readerPreferences:{wpm:300,speechRate:1},speechSettings:{provider:'google',googleVoice:'en-US-Wavenet-D'},speechApiKey:'test-key-not-a-real-secret-12345'});
  },cloudAudio);
  await setup();await page.waitForFunction(()=>document.querySelector('[data-speed-reader]').shadowRoot.querySelector('.current').textContent==='word3');
  const request=await worker.evaluate(()=>cloudRequests.at(-1));
  assert(request.keyProvided);assert.deepEqual(request.body.enableTimePointing,['SSML_MARK']);assert.equal(request.body.voice.name,'en-US-Wavenet-D');
  assert(!request.url.includes('test-key'));assert.equal(request.body.audioConfig.audioEncoding,'MP3');
  await page.getByRole('button',{name:'Pause reading',exact:true}).click();const word=await current.textContent(),count=await worker.evaluate(()=>cloudRequests.length);
  await page.waitForTimeout(500);assert.equal(await current.textContent(),word);
  await page.getByRole('button',{name:'Resume reading',exact:true}).click();await page.waitForTimeout(500);assert.notEqual(await current.textContent(),word);assert.equal(await worker.evaluate(()=>cloudRequests.length),count,'resume reuses audio without another billed request');
  await page.screenshot({path:path.join(results,'speech-reader.png')});

  const cdp=await context.newCDPSession(page),worlds=[];cdp.on('Runtime.executionContextCreated',e=>worlds.push(e.context));await cdp.send('Runtime.enable');
  let contentContext;
  for(const world of worlds){const r=await cdp.send('Runtime.evaluate',{contextId:world.id,expression:'typeof chrome !== "undefined" && chrome.runtime?.id',returnByValue:true});if(r.result.value===extensionId)contentContext=world.id;}
  assert(contentContext,'actual content-script execution context found');
  const secret=await cdp.send('Runtime.evaluate',{contextId:contentContext,expression:'chrome.storage.local.get("speechApiKey").then(x=>x.speechApiKey||"absent",()=>"blocked")',awaitPromise:true,returnByValue:true});
  assert.equal(secret.result.value,'blocked','content scripts cannot read the stored API key');
  const prefs=await cdp.send('Runtime.evaluate',{contextId:contentContext,expression:'chrome.runtime.sendMessage({action:"reader-preferences"})',awaitPromise:true,returnByValue:true});
  assert(!JSON.stringify(prefs.result.value).includes('test-key'),'settings messages never return a key');
  await cdp.detach();await page.keyboard.press('Escape');
  console.log('PASS: cloud request format, real audio playback and word timing under restrictive page CSP, pause/resume reuse, key isolation');

  await setup();await page.waitForTimeout(350);
  await page.getByRole('button',{name:'Pause reading',exact:true}).click();
  const beforeExpiry=await worker.evaluate(()=>cloudRequests.length);
  await worker.evaluate(()=>chrome.offscreen.closeDocument());
  await page.getByRole('button',{name:'Resume reading',exact:true}).click();await page.waitForTimeout(500);
  assert.equal(await worker.evaluate(()=>cloudRequests.length),beforeExpiry+1,'expired offscreen audio is recreated on resume');
  await page.keyboard.press('Escape');
  console.log('PASS: resume recovers after paused cloud audio expires');

  await worker.evaluate(()=>{cloudMode='delay';});await setup();
  await worker.evaluate(()=>new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(typeof globalThis.releaseCloud==='function'){clearInterval(timer);clearTimeout(timeout);resolve();}},20);const timeout=setTimeout(()=>{clearInterval(timer);reject(Error('Cloud request did not start'));},3000);}));
  await page.keyboard.press('Escape');await worker.evaluate(()=>releaseCloud());await page.waitForTimeout(500);
  assert.equal(await worker.evaluate(()=>speechJob),null,'late cloud response cannot restart closed reader');
  for(const mode of ['quota','bad-key']){
    await worker.evaluate(mode=>{cloudMode=mode;},mode);await setup();
    await page.waitForFunction(()=>document.querySelector('[data-speed-reader]').shadowRoot.querySelector('.primary').textContent==='Resume');
    assert.match(await note.textContent(),mode==='quota'?/quota reached/:/billing/);await page.keyboard.press('Escape');
  }
  console.log('PASS: delayed cancellation, quota and invalid-key feedback');

  const settings=await context.newPage();await settings.goto(`chrome-extension://${extensionId}/options.html`);
  await settings.getByText('A key is saved. Leave this field blank to keep it.').waitFor();
  assert.equal(await settings.getByLabel('Google Cloud API key').inputValue(),'');
  await settings.screenshot({path:path.join(results,'speech-settings.png')});
  await settings.setViewportSize({width:360,height:800});
  assert.equal(await settings.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await settings.getByRole('button',{name:'Remove saved key',exact:true}).click();
  await settings.getByText('Key removed. Installed voices are selected.').waitFor();
  assert.equal(await worker.evaluate(async()=>Boolean((await chrome.storage.local.get('speechApiKey')).speechApiKey)),false);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(results,'speech-summary.json'),JSON.stringify({passed:true,nativeSmoke,cloud:'Mocked provider responses; real extension audio playback. No live cloud key supplied.',checks:['native-lifecycle','word-events','rate','chunking','cloud-audio','cloud-timing','pause-reuse','CSP','key-isolation','late-cancellation','quota','invalid-key','options-key-removal','responsive-settings'],errors},null,2));
  console.log('PASS: settings keep key masked, key removal, narrow settings layout; native engine:',JSON.stringify(nativeSmoke));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await context?.close();server.close();if(profile&&path.resolve(profile).startsWith(path.resolve(os.tmpdir())+path.sep))fs.rmSync(profile,{recursive:true,force:true});});
