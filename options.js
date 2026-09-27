'use strict';
const $=id=>document.getElementById(id);
let hasKey=false;
function showProvider(){ $('native-panel').hidden=$('provider').value!=='native';$('google-panel').hidden=$('provider').value!=='google'; }
function keyState(){ $('key-state').textContent=hasKey?'A key is saved. Leave this field blank to keep it.':'No key saved.';$('remove-key').hidden=!hasKey;$('api-key').placeholder=hasKey?'Saved key · enter a new key to replace':'Paste your key'; }
async function load(){
  const {speechSettings={},speechApiKey}=await chrome.storage.local.get(['speechSettings','speechApiKey']);
  hasKey=Boolean(speechApiKey);keyState();
  $('provider').value=speechSettings.provider==='google'?'google':'native';
  $('google-voice').value=speechSettings.googleVoice||'en-US-Wavenet-D';
  if(!$('google-voice').value)$('google-voice').value='en-US-Wavenet-D';
  const voices=(await chrome.tts.getVoices()).filter(v=>v.remote===false);
  for(const voice of voices){const option=document.createElement('option');option.value=voice.voiceName;option.textContent=`${voice.voiceName} (${voice.lang||'default'})`;$('native-voice').append(option);}
  $('native-voice').value=speechSettings.nativeVoice||'';
  if(!voices.length)$('native-hint').textContent='No installed voices were found. Add a speech voice in your system settings, then reopen this page. Cloud voices are also available.';
  showProvider();
}
$('provider').addEventListener('change',showProvider);
$('settings').addEventListener('submit',async event=>{
  event.preventDefault();$('result').textContent='';
  const provider=$('provider').value,key=$('api-key').value.trim();
  if(key&&!/^[A-Za-z0-9_-]{20,200}$/.test(key)){$('result').textContent='Enter a valid Google Cloud API key.';return;}
  if(provider==='google'&&!key&&!hasKey){$('result').textContent='Add your Google Cloud API key first.';return;}
  // Request the one cloud host directly from the user's Save gesture.
  const permission=provider==='google'?chrome.permissions.request({origins:['https://texttospeech.googleapis.com/*']}):Promise.resolve(true);
  $('save').disabled=true;
  try{
    if(!(await permission))throw Error('Google Cloud access was not allowed. Your settings have not changed.');
    const settings={speechSettings:{provider,nativeVoice:$('native-voice').value,googleVoice:$('google-voice').value}};
    if(key)settings.speechApiKey=key;
    await chrome.storage.local.set(settings);
    if(key)hasKey=true;$('api-key').value='';keyState();
    $('result').textContent='Saved. Return to your article and start reading aloud.';
  }catch(error){$('result').textContent=error.message;}finally{$('save').disabled=false;}
});
$('remove-key').addEventListener('click',async()=>{
  try{
    const {speechSettings={}}=await chrome.storage.local.get('speechSettings');
    await chrome.storage.local.remove('speechApiKey');
    await chrome.storage.local.set({speechSettings:{...speechSettings,provider:'native'}});
    // Chrome may retain a matching required content-script permission.
    await chrome.permissions.remove({origins:['https://texttospeech.googleapis.com/*']}).catch(()=>{});
    hasKey=false;$('api-key').value='';$('provider').value='native';showProvider();keyState();$('result').textContent='Key removed. Installed voices are selected.';
  }catch{$('result').textContent='Could not remove the key. Reload this page and try again.';}
});
load().catch(()=>{$('result').textContent='Settings could not load. Reload this page.';});
