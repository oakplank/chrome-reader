'use strict';
let playback;
function stopAudio() {
  const old = playback; playback = null;
  if (!old) return;
  clearInterval(old.timer); old.audio.pause(); old.audio.removeAttribute('src'); old.audio.load(); URL.revokeObjectURL(old.url);
}
function emit(job,event) { if(playback===job) chrome.runtime.sendMessage({action:'reader-audio-event',id:job.id,event}).catch(()=>{if(playback===job)stopAudio();}); }
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||sender.tab||message.target!=='reader-audio')return;
  if(message.action==='play') {
    stopAudio();
    const bytes = Uint8Array.from(atob(message.audio),c=>c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'}));
    const audio = new Audio(url); audio.playbackRate = message.rate;
    const job = {id:message.id,audio,url,index:-1,paused:message.paused}; playback = job;
    audio.addEventListener('playing',()=>emit(job,{type:'start'}),{once:true});
    audio.addEventListener('ended',()=>{if(playback!==job)return;emit(job,{type:'end'});stopAudio();});
    audio.addEventListener('error',()=>{if(playback!==job)return;emit(job,{type:'error',error:'Audio playback failed. Try again.'});stopAudio();});
    job.timer = setInterval(()=>{
      if(audio.paused)return;
      let index = job.index;
      while(index+1<message.points.length && message.points[index+1].timeSeconds<=audio.currentTime)index++;
      if(index!==job.index){job.index=index;emit(job,{type:'word',index});}
    },30);
    if (!job.paused) audio.play().then(()=>respond({ok:true}),()=>{if(playback===job){emit(job,{type:'error',error:'Audio could not start. Press Resume to try again.'});stopAudio();}respond({ok:false});});
    else respond({ok:true});
    return true;
  }
  if(playback?.id===message.id) {
    if(message.action==='stop')stopAudio();
    else if(message.action==='pause')playback.audio.pause();
    else if(message.action==='resume'){const job=playback;job.audio.play().catch(()=>emit(job,{type:'error',error:'Audio could not resume. Restart reading.'}));}
  }
  respond({ok:true});
});
