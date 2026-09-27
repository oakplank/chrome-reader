'use strict';

const CLOUD_ORIGIN = 'https://texttospeech.googleapis.com/*';
const storageReady = chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
let speechJob, offscreenCreation;
const cleanPreferences = p => ({wpm:Math.max(100,Math.min(800,Number(p?.wpm)||300)),dark:p?.dark===true,wordView:p?.wordView===true,speechRate:Math.max(.5,Math.min(2,Number(p?.speechRate)||1))});
const xmlEscape = text => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

async function speechEvent(job, event) {
  if (speechJob !== job) return;
  try { await chrome.tabs.sendMessage(job.tabId,{action:'reader-speech-event',id:job.id,...event},{frameId:0}); }
  catch { if (speechJob === job) stopSpeech(); }
}
function stopSpeech() {
  const old = speechJob; speechJob = null;
  if (!old) return;
  old.controller.abort();
  if (old.provider === 'native') chrome.tts.stop();
  chrome.runtime.sendMessage({target:'reader-audio',action:'stop',id:old.id}).catch(()=>{});
}
async function ensureAudio() {
  if (offscreenCreation) return offscreenCreation;
  offscreenCreation = (async () => {
    if (!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length) {
      await chrome.offscreen.createDocument({url:'audio.html',reasons:['AUDIO_PLAYBACK'],justification:'Play the cloud voice selected by the reader and track spoken words.'});
    }
  })();
  try { await offscreenCreation; } finally { offscreenCreation = null; }
}
async function beginSpeech(message, tabId) {
  const words = message.words;
  if (typeof message.id !== 'string' || message.id.length > 100 || !Array.isArray(words) || !words.length || words.length > 60 || words.some(w=>typeof w!=='string'||!w.length||w.length>200)) throw Error('Select ordinary article text and try again.');
  // The first word starts at zero; custom marks at the start can be omitted by Google.
  const ssml = `<speak>${words.map((w,i)=>`${i?`<mark name="w${i}"/>`:''}${xmlEscape(w)}`).join(' ')}</speak>`;
  if (new TextEncoder().encode(ssml).length > 4500) throw Error('This passage is too large to speak. Select a shorter passage.');
  stopSpeech();
  const job = {id:message.id,tabId,controller:new AbortController(),provider:'native',paused:false};
  speechJob = job;
  try {
    await storageReady;
    const {speechSettings = {},speechApiKey = ''} = await chrome.storage.local.get(['speechSettings','speechApiKey']);
    if (speechJob !== job) return;
    job.provider = speechSettings.provider === 'google' ? 'google' : 'native';
    const rate = Math.max(.5,Math.min(2,Number(message.rate)||1));
    if (job.provider === 'native') {
      const voices = (await chrome.tts.getVoices()).filter(v=>v.remote===false);
      const voice = voices.find(v=>v.voiceName===speechSettings.nativeVoice) || voices.find(v=>v.lang?.toLowerCase()===message.lang?.toLowerCase()) || voices.find(v=>v.lang?.startsWith(message.lang?.split('-')[0]||'en')) || voices[0];
      if (!voice) throw Error('No installed voice is available. Install a speech voice in your system settings, or choose a cloud voice.');
      if (speechJob !== job) return;
      const offsets = []; let offset = 0;
      for (const word of words) { offsets.push(offset); offset += word.length+1; }
      await chrome.tts.speak(words.join(' '),{voiceName:voice.voiceName,lang:voice.lang,rate,enqueue:false,onEvent:event=>{
        if (speechJob !== job) return;
        if (event.type === 'start') { speechEvent(job,{type:'start',estimated:!voice.eventTypes?.includes('word')}); if(job.paused) chrome.tts.pause(); }
        if (event.type === 'word') { let index = 0; while(index+1<offsets.length&&offsets[index+1]<=event.charIndex) index++; speechEvent(job,{type:'word',index}); }
        if (event.type === 'end') speechEvent(job,{type:'end'});
        if (['error','interrupted','cancelled'].includes(event.type)) speechEvent(job,{type:'error',error:'Speech stopped. Try again or choose another installed voice.'});
      }});
    } else {
      if (!speechApiKey) throw Error('Add your Google Cloud key in Voice settings first.');
      if (!(await chrome.permissions.contains({origins:[CLOUD_ORIGIN]}))) throw Error('Allow Google Cloud access in Voice settings first.');
      if (speechJob !== job) return;
      const voice = /^[a-z]{2,3}-[A-Z]{2}-(Wavenet|Standard)-[A-Z]$/.test(speechSettings.googleVoice||'') ? speechSettings.googleVoice : 'en-US-Wavenet-D';
      const timeout = setTimeout(()=>job.controller.abort(),20000);
      let response;
      try {
        response = await fetch('https://texttospeech.googleapis.com/v1beta1/text:synthesize',{
          method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':speechApiKey},signal:job.controller.signal,
          body:JSON.stringify({input:{ssml},voice:{languageCode:voice.split('-').slice(0,2).join('-'),name:voice},audioConfig:{audioEncoding:'MP3'},enableTimePointing:['SSML_MARK']})
        });
      } finally { clearTimeout(timeout); }
      if (!response.ok) {
        const errors = {400:'Check your Google Cloud key and selected voice.',401:'Your Google Cloud key was not accepted.',403:'Enable Cloud Text-to-Speech, billing, and access for this API key.',429:'Google Cloud quota reached. Try later or switch to free installed voices.'};
        throw Error(errors[response.status]||'Google Cloud is unavailable. Try later or switch to free installed voices.');
      }
      const data = await response.json();
      if (speechJob !== job) return;
      const points = [{markName:'w0',timeSeconds:0},...(Array.isArray(data.timepoints)?data.timepoints:[])];
      if (typeof data.audioContent!=='string'||data.audioContent.length>8000000||!Array.isArray(points)||points.length!==words.length||points.some((p,i)=>p.markName!==`w${i}`||!Number.isFinite(p.timeSeconds)||p.timeSeconds<0||(i&&p.timeSeconds<points[i-1].timeSeconds))) throw Error('This cloud voice did not return word timing. Choose a Standard or WaveNet voice and retry.');
      await ensureAudio();
      if (speechJob !== job) return;
      const result = await chrome.runtime.sendMessage({target:'reader-audio',action:'play',id:job.id,audio:data.audioContent,points,rate,paused:job.paused});
      if (!result?.ok) throw Error('Audio could not play. Try again.');
      job.hasAudio=true;
    }
  } catch(error) {
    if (speechJob === job) { await speechEvent(job,{type:'error',error:error.name==='AbortError'?'Speech request timed out. Try again.':error.message}); stopSpeech(); }
  }
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if (sender.id !== chrome.runtime.id) return;
  if (message.target === 'reader-audio') return;
  if (message.action === 'reader-audio-event') {
    if (sender.url === chrome.runtime.getURL('audio.html') && speechJob?.id === message.id) speechEvent(speechJob,message.event);
    return;
  }
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)||sender.frameId!==0) return;
  const actions = ['reader-preferences','reader-save-preferences','reader-voice-settings','reader-speak','reader-speech-control'];
  if (!actions.includes(message.action)) return;
  (async()=>{
    await storageReady;
    if (message.action==='reader-preferences') return cleanPreferences((await chrome.storage.local.get('readerPreferences')).readerPreferences);
    if (message.action==='reader-save-preferences') { await chrome.storage.local.set({readerPreferences:cleanPreferences(message.preferences)}); return {ok:true}; }
    if (message.action==='reader-voice-settings') { await chrome.runtime.openOptionsPage(); return {ok:true}; }
    if (message.action==='reader-speak') { await beginSpeech(message,tabId); return {ok:true}; }
    const job = speechJob;
    // A paused service worker can be suspended. Resume from the current word.
    if (!job || job.id!==message.id || job.tabId!==tabId) return {ok:true,restart:message.command==='resume'};
    if (message.command==='stop') stopSpeech();
    else if (['pause','resume'].includes(message.command)) {
      job.paused = message.command==='pause';
      if (job.provider==='native') chrome.tts[message.command]();
      else {
        if(message.command==='resume'&&job.hasAudio&&!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length){stopSpeech();return {ok:true,restart:true};}
        chrome.runtime.sendMessage({target:'reader-audio',action:message.command,id:job.id}).catch(()=>{});
      }
    }
    return {ok:true};
  })().then(respond,()=>respond({error:'Reader settings are unavailable. Reload the extension and try again.'}));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{if(speechJob?.tabId===tabId)stopSpeech();});
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(speechJob?.tabId===tabId&&change.status==='loading')stopSpeech();});
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area!=='local'||!speechJob||(!changes.speechSettings&&!changes.speechApiKey))return;
  const job=speechJob;
  speechEvent(job,{type:'error',error:'Voice settings changed. Press Resume to use your new settings.'}).finally(()=>{if(speechJob===job)stopSpeech();});
});
