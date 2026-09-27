(() => {
  'use strict';
  let session;
  let requestId = 0;

  function readingRoot(range) {
    const start = range.startContainer;
    const element = start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement;
    const articleSelector = 'article,[role="article"],[itemprop="articleBody"],.mw-parser-output';
    const article = element?.closest(articleSelector);
    const main = element?.closest('main,[role="main"]');
    // Page titles often sit outside the article beside language/tool menus.
    return article || (element?.closest('h1') && main?.querySelector(articleSelector)) || main || document.body;
  }

  const excludedText = 'script,style,noscript,template,textarea,input,select,button,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[data-speed-reader],nav,aside,footer,[role="navigation"],[role="complementary"],[role="contentinfo"],.mw-editsection,.reference,.reflist,.mw-parser-output .sidebar,.mw-parser-output .navbox,.mw-parser-output .metadata,.mw-parser-output .hatnote,.mw-parser-output .sistersitebox,.mw-parser-output figure,.mw-parser-output .thumb';

  // A layout box alone does not mean its text is painted. Check the word's
  // range and every clipping ancestor, without excluding scrollable prose.
  function readableRange(range, styleOf = getComputedStyle) {
    const p = range.startContainer.parentElement;
    if (!p || p.closest(excludedText)) return false;
    const own = styleOf(p);
    const transparent = color => color === 'transparent' || /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color) || /\/\s*0(?:\.0+)?%?\s*\)$/.test(color);
    if (own.visibility !== 'visible' || parseFloat(own.fontSize) === 0 || transparent(own.webkitTextFillColor || own.color)) return false;
    let rects = [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1)
      .map(r => ({left:r.left,right:r.right,top:r.top,bottom:r.bottom}));
    if (!rects.length) return false;
    for (let a = p; a; a = a.parentElement) {
      const style = styleOf(a);
      if (style.display === 'none' || Number(style.opacity) === 0 || style.contentVisibility === 'hidden') return false;
      if (a.matches('details:not([open])') && !a.querySelector(':scope > summary')?.contains(p)) return false;
      const box = a.getBoundingClientRect();
      let left = -Infinity, right = Infinity, top = -Infinity, bottom = Infinity;
      if (style.display !== 'contents') {
        if (/^(hidden|clip)$/.test(style.overflowX)) { left = box.left; right = box.right; }
        if (/^(hidden|clip)$/.test(style.overflowY)) { top = box.top; bottom = box.bottom; }
      }
      const clip = style.clip.match(/^rect\((.*)\)$/);
      if (clip && /^(absolute|fixed)$/.test(style.position)) {
        const values = clip[1].split(/[,\s]+/).map(v => v === 'auto' ? null : parseFloat(v));
        if (values.length === 4) {
          top = Math.max(top, box.top + (values[0] ?? 0)); right = Math.min(right, box.left + (values[1] ?? box.width));
          bottom = Math.min(bottom, box.top + (values[2] ?? box.height)); left = Math.max(left, box.left + (values[3] ?? 0));
        }
      }
      const inset = style.clipPath.match(/^inset\(([^)]+)\)$/);
      if (inset) {
        const v = inset[1].split(' round ')[0].trim().split(/\s+/);
        const lengths = [v[0],v[1]||v[0],v[2]||v[0],v[3]||v[1]||v[0]];
        if (lengths.every(x => /^-?[\d.]+(?:px|%)?$/.test(x))) {
          const n = lengths.map((x,i) => parseFloat(x) * (x.endsWith('%') ? (i%2 ? box.width : box.height)/100 : 1));
          top = Math.max(top,box.top+n[0]); right = Math.min(right,box.right-n[1]);
          bottom = Math.min(bottom,box.bottom-n[2]); left = Math.max(left,box.left+n[3]);
        }
      }
      rects = rects.map(r => ({left:Math.max(r.left,left),right:Math.min(r.right,right),top:Math.max(r.top,top),bottom:Math.min(r.bottom,bottom)}))
        .filter(r => r.right-r.left > 1 && r.bottom-r.top > 1);
      if (!rects.length) return false;
    }
    // Negative document coordinates cannot be reached by normal page scrolling.
    // Text below the viewport remains eligible and is followed during playback.
    return rects.some(r => r.right + scrollX > 0 && r.bottom + scrollY > 0);
  }

  function tokenize(scope) {
    const words = [];
    const styles = new WeakMap();
    const styleOf = element => {
      if (!styles.has(element)) styles.set(element, getComputedStyle(element));
      return styles.get(element);
    };
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        return !p || !node.data.trim() || p.closest(excludedText) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      for (const match of node.data.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’‐-][\p{L}\p{M}\p{N}]+)*[.,!?;:…]*/gu)) {
        const range = document.createRange(); range.setStart(node,match.index); range.setEnd(node,match.index+match[0].length);
        if (!readableRange(range,styleOf)) continue;
        words.push({ text: match[0], node, start: match.index, end: match.index + match[0].length });
      }
    }
    return words;
  }

  function wordStillReadable(w) {
    if (!w.node.isConnected || w.node.data.slice(w.start,w.end) !== w.text) return false;
    const range = document.createRange(); range.setStart(w.node,w.start); range.setEnd(w.node,w.end);
    return readableRange(range);
  }

  async function start() {
    const id = ++requestId;
    const selection = getSelection();
    const range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
    session?.close();
    const saved = await chrome.runtime.sendMessage({action:'reader-preferences'}).catch(() => ({}));
    if (id !== requestId) return;
    const preferences = { wpm: Math.max(100, Math.min(800, Number(saved?.wpm) || 300)), dark: saved?.dark === true, wordView: saved?.wordView === true, speechRate:Math.max(.5,Math.min(2,Number(saved?.speechRate)||1)) };
    const scope = range ? readingRoot(range) : null;
    const words = scope ? tokenize(scope) : [];
    let index = -1;
    if (range?.startContainer.isConnected) {
      const anchor = range.cloneRange();
      anchor.collapse(true);
      // The DOM position distinguishes repeated words and multiline selections.
      index = words.findIndex(w => anchor.comparePoint(w.node, w.end) === 1 && range.intersectsNode(w.node));
      if (index < 0 && words.length && !scope.contains(range.startContainer) && anchor.comparePoint(words[0].node, words[0].start) === 1) index = 0;
    }
    // Avoid leaving a second, blue highlight on the original selection.
    const activeRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (index >= 0 && activeRange && activeRange.compareBoundaryPoints(Range.START_TO_START, range) === 0 && activeRange.compareBoundaryPoints(Range.END_TO_END, range) === 0) selection.removeAllRanges();
    session = createReader(words, index, preferences);
  }

  function createReader(words, first, preferences) {
    const events = new AbortController();
    const options = { signal: events.signal };
    const previousFocus = document.activeElement;
    let index = Math.max(first, 0), paused = first < 0, finished = false, closed = false, timer, drag;
    let speechMode = false, utteranceId, chunkStart, chunkEnd, speechTimer, estimated = false, speechNotice = '';
    const host = document.createElement('div');
    host.dataset.speedReader = '';
    host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const root = host.attachShadow({ mode: 'open' });
    function el(tag, parent, className = '', text) {
      const node = document.createElement(tag);
      node.className = className;
      if (text !== undefined) node.textContent = text;
      parent.append(node);
      return node;
    }
    function button(parent, text, label, click) {
      const node = el('button', parent, '', text);
      node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
      node.addEventListener('click', click, options);
      return node;
    }
    el('style', root).textContent = `
      :host { all:initial; } * { box-sizing:border-box; }
      .panel { --paper:#fff;--ink:#1d2939;--muted:#526174;--soft:#f1f4f9;--line:#d8e0eb;
        position:fixed;bottom:16px;right:16px;width:min(360px,calc(100vw - 24px));max-height:calc(100vh - 24px);
        overflow:auto;pointer-events:auto;color:var(--ink);background:var(--paper);font:14px/1.45 system-ui,sans-serif;
        border:1px solid var(--line);border-radius:14px;box-shadow:0 8px 32px #182b4829; }
      .dark { --paper:#202b3b;--ink:#f4f7fc;--muted:#b6c5d9;--soft:#2e3c50;--line:#45546a; }
      .header { display:flex;align-items:center;justify-content:space-between;padding:10px 14px;
        background:var(--soft);cursor:move;touch-action:none;user-select:none; }
      .title { font-weight:650; } .actions { display:flex;gap:6px; } .actions button { font-size:12px;padding:5px 7px; }
      button { font:inherit;border:1px solid var(--line);border-radius:7px;background:var(--paper);color:var(--ink);
        padding:7px 10px;cursor:pointer;min-height:36px; }
      button:hover { background:var(--soft); } button:disabled { opacity:.5;cursor:default; }
      button:focus-visible,input:focus-visible { outline:3px solid #739bff;outline-offset:2px; }
      .words { display:grid;grid-template-columns:1fr 2fr 1fr;align-items:center;gap:8px;
        padding:24px 16px;min-height:112px;text-align:center; }
      .words[hidden] { display:none; }
      .context { color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .current { font:600 32px/1.2 Georgia,serif;overflow-wrap:anywhere;min-width:0; }
      .playback { display:flex;justify-content:center;gap:8px;padding:12px 14px; }
      .primary { background:#2454d6;color:white;border-color:#2454d6;min-width:98px; }
      .primary:hover { background:#1943b5; }
      .speed { display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--soft); }
      label { white-space:nowrap;min-width:76px;font-variant-numeric:tabular-nums; }
      input { flex:1;min-width:0;accent-color:#2454d6; }
      .status { padding:9px 16px;color:var(--muted);font-size:12px;min-height:35px; }
      .speech { display:flex;gap:8px;align-items:center;padding:8px 14px;border-top:1px solid var(--line); }
      .speech button { flex:1;font-size:13px; } .speech button[aria-pressed="true"] { background:var(--soft);border-color:#2454d6; }
      .speech-note { padding:0 16px 8px;color:var(--muted);font-size:12px; } .speech-note:empty { display:none; }
      .message { padding:22px 18px;margin:0;font-size:15px; }
      .highlight { position:fixed;pointer-events:none;background:#ffe16888;border-bottom:2px solid #b98a00;border-radius:2px; }
      @media(max-width:360px) { .words { gap:4px;padding:20px 10px; } .current { font-size:26px; } }
    `;
    const highlight = el('div', root, 'highlight'); highlight.hidden = true;
    const panel = el('section', root, 'panel'); panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Speed Reader');
    panel.classList.toggle('dark', preferences.dark);
    const header = el('div', panel, 'header'); el('span', header, 'title', `Speed Reader ${chrome.runtime.getManifest().version}`);
    const actions = el('div', header, 'actions');
    const wordView = button(actions, 'Word view', 'Show floating word view', () => {
      preferences.wordView = !preferences.wordView;
      display.hidden = !preferences.wordView;
      updateWordView(); save(); constrain();
    });
    const theme = button(actions, preferences.dark ? 'Light' : 'Dark', 'Toggle reader theme', () => {
      preferences.dark = !preferences.dark; panel.classList.toggle('dark', preferences.dark);
      theme.textContent = preferences.dark ? 'Light' : 'Dark'; save();
    });
    button(actions, '×', 'Close Speed Reader', close);
    const display = el('div', panel, 'words');
    display.hidden = !preferences.wordView;
    function updateWordView() {
      wordView.setAttribute('aria-pressed', String(preferences.wordView));
      wordView.setAttribute('aria-label', preferences.wordView ? 'Hide floating word view' : 'Show floating word view');
      wordView.title = wordView.getAttribute('aria-label');
    }
    updateWordView();
    const prev = el('span', display, 'context'), current = el('span', display, 'current'), next = el('span', display, 'context');
    const playback = el('div', panel, 'playback');
    const back = button(playback, 'Back 25', 'Back 25 words', () => seek(Math.max(first, index - 25)));
    const play = button(playback, 'Pause', 'Pause reading', toggle); play.className = 'primary';
    const restart = button(playback, 'Restart', 'Restart reading', () => seek(first));
    const speed = el('div', panel, 'speed');
    const label = el('label', speed, '', `${preferences.wpm} WPM`); label.htmlFor = 'reader-speed';
    const slider = el('input', speed); slider.id = 'reader-speed'; slider.type = 'range';
    slider.min = '100'; slider.max = '800'; slider.step = '25'; slider.value = String(preferences.wpm);
    slider.setAttribute('aria-label', 'Reading speed in words per minute');
    slider.addEventListener('input', () => {
      if(speechMode){preferences.speechRate=Number(slider.value)/100;stopUtterance();}
      else preferences.wpm=Number(slider.value);
      updateSpeed();schedule();
    }, options);
    slider.addEventListener('change', save, options);
    const speechControls = el('div',panel,'speech');
    const speak = button(speechControls,'Read aloud','Read aloud',()=>{
      speechMode=!speechMode;stopUtterance();speechNotice='';
      if(finished){index=first;finished=false;}
      if(speechMode)paused=false;
      speak.textContent=speechMode?'Stop voice':'Read aloud';speak.setAttribute('aria-label',speak.textContent);speak.setAttribute('aria-pressed',String(speechMode));
      updateSpeed();render();schedule();constrain();
    });
    speak.setAttribute('aria-pressed','false');
    button(speechControls,'Voice settings','Voice settings',()=>{
      chrome.runtime.sendMessage({action:'reader-voice-settings'}).catch(()=>{speechNote.textContent='Reload this page to open voice settings.';});
    });
    const speechNote=el('div',panel,'speech-note');speechNote.setAttribute('aria-live','polite');
    const status = el('div', panel, 'status');

    function save() {
      chrome.runtime.sendMessage({action:'reader-save-preferences',preferences:{...preferences}}).then(result=>{if(result?.error)throw Error(result.error);}).catch(() => {
        if (!closed) status.textContent = 'Settings could not be saved. Reload this page to retry.';
      });
    }
    function updateSpeed(){
      label.textContent=speechMode?`${preferences.speechRate.toFixed(1)}× voice`:`${preferences.wpm} WPM`;
      slider.min=speechMode?'50':'100';slider.max=speechMode?'200':'800';slider.step=speechMode?'10':'25';
      slider.value=String(speechMode?preferences.speechRate*100:preferences.wpm);
      slider.setAttribute('aria-label',speechMode?'Speaking speed':'Reading speed in words per minute');
    }
    function speechControl(command){
      const id=utteranceId;
      if(id)chrome.runtime.sendMessage({action:'reader-speech-control',id,command}).then(result=>{
        if(result?.restart&&utteranceId===id){utteranceId=null;if(!paused)schedule();}
      }).catch(()=>{if(command==='resume'&&utteranceId===id)speechError('Speech could not resume. Try again.');});
    }
    function stopUtterance(){speechControl('stop');utteranceId=null;clearTimeout(speechTimer);estimated=false;}
    function speechError(message){stopUtterance();paused=true;speechNotice=message;render();}
    function estimateWord(){
      clearTimeout(speechTimer);
      if(!estimated||paused||!utteranceId)return;
      speechTimer=setTimeout(()=>{if(index+1<chunkEnd){index++;render();estimateWord();}},60000/(180*preferences.speechRate));
    }
    function beginUtterance(){
      if(utteranceId)return;
      chunkStart=index;chunkEnd=index;
      let bytes=15;
      // Keep each request below the provider's 5 KB SSML limit, including marks.
      while(chunkEnd<words.length && chunkEnd-index<60){
        const word=words[chunkEnd].text;
        const size=new TextEncoder().encode(word).length*6+30;
        if(chunkEnd>index && bytes+size>4200)break;
        bytes+=size;chunkEnd++;
        if(chunkEnd-index>=12 && /[.!?…]$/.test(word))break;
      }
      if (!words.slice(chunkStart,chunkEnd).every(wordStillReadable)) {
        speechError('This page changed. Select visible text and start again.'); return;
      }
      const id=crypto.randomUUID();utteranceId=id;speechNotice='Preparing voice…';render();
      chrome.runtime.sendMessage({action:'reader-speak',id,words:words.slice(chunkStart,chunkEnd).map(w=>w.text),rate:preferences.speechRate,lang:document.documentElement.lang||navigator.language}).then(result=>{
        if(utteranceId===id&&result?.error)speechError(result.error);
      }).catch(()=>{if(utteranceId===id)speechError('Speech could not start. Reload this page and try again.');});
    }
    function onSpeech(message){
      if(message.action!=='reader-speech-event'||message.id!==utteranceId||closed)return;
      if(message.type==='error'){speechError(message.error);return;}
      if(message.type==='start'){
        estimated=message.estimated===true;speechNotice=estimated?'This voice uses approximate word timing.':'Reading aloud';render();estimateWord();
      }
      if(message.type==='word'&&!paused&&Number.isInteger(message.index)&&message.index>=0&&chunkStart+message.index<chunkEnd){
        estimated=false;clearTimeout(speechTimer);index=chunkStart+message.index;speechNotice='Reading aloud';render();
      }
      if(message.type==='end'){
        utteranceId=null;clearTimeout(speechTimer);
        if(chunkEnd<words.length){index=chunkEnd;render();schedule();}
        else{index=words.length-1;finished=true;paused=true;speechNotice='';render();}
      }
    }
    chrome.runtime.onMessage.addListener(onSpeech);
    function updatePlay() {
      const text = finished ? 'Read again' : paused ? 'Resume' : 'Pause';
      play.textContent = text; play.title = text;
      play.setAttribute('aria-label', finished ? text : `${text} reading`);
    }
    function positionHighlight(follow = false) {
      if (first < 0) return;
      const w = words[index];
      if (!w.node.isConnected || w.node.data.slice(w.start, w.end) !== w.text) {
        highlight.hidden = true; paused = true; clearTimeout(timer); stopUtterance(); updatePlay();
        status.textContent = 'This page changed. Select text and start again.'; return;
      }
      const range = document.createRange(); range.setStart(w.node, w.start); range.setEnd(w.node, w.end);
      if (!readableRange(range)) {
        highlight.hidden = true; paused = true; clearTimeout(timer); stopUtterance(); updatePlay();
        status.textContent = 'This page changed. Select visible text and start again.'; return;
      }
      // Follow the word itself: a paragraph can be much taller than the screen.
      if (follow === true && !paused) {
        for (let parent = w.node.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
          if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY) || parent.scrollHeight <= parent.clientHeight) continue;
          const bounds = parent.getBoundingClientRect(), word = range.getBoundingClientRect();
          const top = Math.max(0, bounds.top + parent.clientTop), bottom = Math.min(innerHeight, bounds.top + parent.clientTop + parent.clientHeight);
          if (bottom > top && (word.top < top + 24 || word.bottom > bottom - 24)) parent.scrollBy({ top:word.top - (top + bottom - word.height) / 2, behavior:'instant' });
        }
        const word = range.getBoundingClientRect();
        if (word.top < 64 || word.bottom > innerHeight - 80) window.scrollBy({ top:word.top - innerHeight * .4, behavior:'instant' });
      }
      const rect = range.getBoundingClientRect();
      highlight.hidden = !rect.width || !rect.height;
      Object.assign(highlight.style, { left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px` });
      // Move controls to the other edge when they would cover the current word.
      const box = panel.getBoundingClientRect();
      if (rect.left < box.right + 8 && rect.right > box.left - 8 && rect.top < box.bottom + 8 && rect.bottom > box.top - 8) {
        const top = rect.top > innerHeight / 2 ? 8 : Math.max(8, innerHeight - box.height - 8);
        panel.style.top = `${top}px`; panel.style.bottom = 'auto';
      }
    }
    function render() {
      prev.textContent = index > first ? words[index - 1]?.text || '' : '';
      current.textContent = words[index]?.text || ''; next.textContent = words[index + 1]?.text || '';
      status.textContent = finished ? 'Finished. Read again whenever you like.' : `${index - first + 1} of ${words.length - first} words${paused ? ' · Paused' : ''}`;
      updatePlay(); positionHighlight(true);
      speechNote.textContent=speechNotice;
    }
    function schedule() {
      clearTimeout(timer);
      if (paused || finished || closed || first < 0) return;
      if(speechMode){beginUtterance();return;}
      timer = setTimeout(() => {
        if (index + 1 < words.length) index++; else { finished = true; paused = true; }
        render(); schedule();
      }, 60000 / preferences.wpm);
    }
    function toggle() {
      if (first < 0) return;
      if (finished) { index = first; finished = false; paused = false; } else paused = !paused;
      if(speechMode){speechControl(paused?'pause':'resume');if(paused)clearTimeout(speechTimer);else estimateWord();}
      render(); schedule();
    }
    function seek(target) { if (first >= 0) { stopUtterance(); index = target; finished = false; render(); schedule(); } }
    function close() {
      closed = true; clearTimeout(timer);stopUtterance();visibilityObserver.disconnect();chrome.runtime.onMessage.removeListener(onSpeech); events.abort();
      const restore = document.activeElement === host; host.remove();
      if (restore && previousFocus?.isConnected) previousFocus.focus({ preventScroll:true });
      if (session?.host === host) session = null;
    }
    function constrain() {
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - rect.width - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - rect.height - 8))}px`;
      panel.style.right = 'auto'; panel.style.bottom = 'auto'; positionHighlight();
    }
    header.addEventListener('pointerdown', e => {
      if (e.target.closest('button') || e.button !== 0) return;
      const rect = panel.getBoundingClientRect(); drag = { x:e.clientX - rect.left,y:e.clientY - rect.top };
      header.setPointerCapture(e.pointerId); e.preventDefault();
    }, options);
    header.addEventListener('pointermove', e => {
      if (drag) { panel.style.left = `${e.clientX - drag.x}px`; panel.style.top = `${e.clientY - drag.y}px`; panel.style.right = 'auto'; constrain(); }
    }, options);
    header.addEventListener('pointerup', () => { drag = null; }, options);
    header.addEventListener('lostpointercapture', () => { drag = null; }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden && first >= 0) { paused = true;speechControl('pause');clearTimeout(speechTimer); render(); schedule(); } }, options);
    window.addEventListener('pagehide',close,options);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { close(); return; }
      if (!e.composedPath().includes(panel) || /^(INPUT|BUTTON)$/.test(e.composedPath()[0].tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(Math.max(first, index - 25)); }
    }, options);
    window.addEventListener('scroll', positionHighlight, { ...options,capture:true,passive:true });
    window.addEventListener('resize', constrain, options);
    const visibilityObserver = new MutationObserver(records => {
      if (first < 0 || closed) return;
      const activeWords = words.slice(index,utteranceId ? chunkEnd : index+1);
      if (!records.some(r => activeWords.some(w => r.target.contains(w.node)))) return;
      if (!activeWords.every(wordStillReadable)) {
        paused = true; clearTimeout(timer); stopUtterance(); highlight.hidden = true; updatePlay();
        status.textContent = 'This page changed. Select visible text and start again.';
        speechNote.textContent = speechMode ? 'Speech stopped because the passage changed.' : '';
      }
    });
    visibilityObserver.observe(document.documentElement,{attributes:true,subtree:true,attributeFilter:['style','class','hidden','aria-hidden','inert','open']});
    document.documentElement.append(host);
    if (first < 0) {
      display.style.display = 'none';
      const message = el('p', panel, 'message', 'Select a word or passage on this page, then press Alt+H to read from there.'); header.after(message);
      [back, play, restart, wordView, speak].forEach(control => { control.disabled = true; });
      status.textContent = 'Use ordinary webpage text. Browser pages and built-in PDF viewers are not supported.';
    } else { render(); schedule(); }
    panel.focus({ preventScroll:true });
    return { close,host };
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.action === 'start-speed-reading') start().catch(error => console.warn('Speed Reader could not start:', error.message));
  });
})();
