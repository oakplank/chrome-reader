(() => {
  'use strict';
  let session;
  let requestId = 0;

  function readingRoot(range) {
    const start = range.startContainer;
    const element = start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement;
    return element?.closest('article,[role="article"],[itemprop="articleBody"],.mw-parser-output')
      || element?.closest('main,[role="main"]') || document.body;
  }

  function tokenize(scope) {
    const words = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p || !node.data.trim() || p.closest('script,style,noscript,template,textarea,input,select,button,[hidden],[inert],[aria-hidden="true"],[contenteditable]:not([contenteditable="false"]),[data-speed-reader]')) return NodeFilter.FILTER_REJECT;
        if (p.closest('nav,aside,footer,[role="navigation"],[role="complementary"],[role="contentinfo"],.mw-editsection,.reference,.reflist')) return NodeFilter.FILTER_REJECT;
        return p.getClientRects().length && getComputedStyle(p).visibility === 'visible'
          ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      for (const match of node.data.matchAll(/[\p{L}\p{M}\p{N}]+(?:['’‐-][\p{L}\p{M}\p{N}]+)*[.,!?;:…]*/gu)) {
        words.push({ text: match[0], node, start: match.index, end: match.index + match[0].length });
      }
    }
    return words;
  }

  async function start() {
    const id = ++requestId;
    const selection = getSelection();
    const range = selection?.rangeCount && !selection.isCollapsed ? selection.getRangeAt(0).cloneRange() : null;
    session?.close();
    const saved = await chrome.storage.local.get('readerPreferences').catch(() => ({}));
    if (id !== requestId) return;
    const preferences = { wpm: Math.max(100, Math.min(800, Number(saved.readerPreferences?.wpm) || 300)), dark: saved.readerPreferences?.dark === true, wordView: saved.readerPreferences?.wordView === true };
    const words = range ? tokenize(readingRoot(range)) : [];
    let index = -1;
    if (range?.startContainer.isConnected) {
      const anchor = range.cloneRange();
      anchor.collapse(true);
      // The DOM position distinguishes repeated words and multiline selections.
      index = words.findIndex(w => anchor.comparePoint(w.node, w.end) === 1 && range.intersectsNode(w.node));
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
      .message { padding:22px 18px;margin:0;font-size:15px; }
      .highlight { position:fixed;pointer-events:none;background:#ffe16888;border-bottom:2px solid #b98a00;border-radius:2px; }
      @media(max-width:360px) { .words { gap:4px;padding:20px 10px; } .current { font-size:26px; } }
    `;
    const highlight = el('div', root, 'highlight'); highlight.hidden = true;
    const panel = el('section', root, 'panel'); panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Speed Reader');
    panel.classList.toggle('dark', preferences.dark);
    const header = el('div', panel, 'header'); el('span', header, 'title', 'Speed Reader');
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
    slider.addEventListener('input', () => { preferences.wpm = Number(slider.value); label.textContent = `${preferences.wpm} WPM`; schedule(); }, options);
    slider.addEventListener('change', save, options);
    const status = el('div', panel, 'status');

    function save() {
      chrome.storage.local.set({ readerPreferences: { ...preferences } }).catch(() => {
        if (!closed) status.textContent = 'Settings could not be saved. Reload this page to retry.';
      });
    }
    function updatePlay() {
      const text = finished ? 'Read again' : paused ? 'Resume' : 'Pause';
      play.textContent = text; play.title = text;
      play.setAttribute('aria-label', finished ? text : `${text} reading`);
    }
    function positionHighlight(follow = false) {
      if (first < 0) return;
      const w = words[index];
      if (!w.node.isConnected || w.node.data.slice(w.start, w.end) !== w.text) {
        highlight.hidden = true; paused = true; clearTimeout(timer); updatePlay();
        status.textContent = 'This page changed. Select text and start again.'; return;
      }
      const range = document.createRange(); range.setStart(w.node, w.start); range.setEnd(w.node, w.end);
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
    }
    function schedule() {
      clearTimeout(timer);
      if (paused || finished || closed || first < 0) return;
      timer = setTimeout(() => {
        if (index + 1 < words.length) index++; else { finished = true; paused = true; }
        render(); schedule();
      }, 60000 / preferences.wpm);
    }
    function toggle() {
      if (first < 0) return;
      if (finished) { index = first; finished = false; paused = false; } else paused = !paused;
      render(); schedule();
    }
    function seek(target) { if (first >= 0) { index = target; finished = false; render(); schedule(); } }
    function close() {
      closed = true; clearTimeout(timer); events.abort();
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
    document.addEventListener('visibilitychange', () => { if (document.hidden && first >= 0) { paused = true; render(); schedule(); } }, options);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { close(); return; }
      if (!e.composedPath().includes(panel) || /^(INPUT|BUTTON)$/.test(e.composedPath()[0].tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(Math.max(first, index - 25)); }
    }, options);
    window.addEventListener('scroll', positionHighlight, { ...options,capture:true,passive:true });
    window.addEventListener('resize', constrain, options);
    document.documentElement.append(host);
    if (first < 0) {
      display.style.display = 'none';
      const message = el('p', panel, 'message', 'Select a word or passage on this page, then press Alt+H to read from there.'); header.after(message);
      [back, play, restart, wordView].forEach(control => { control.disabled = true; });
      status.textContent = 'Use ordinary webpage text. Browser pages and built-in PDF viewers are not supported.';
    } else { render(); schedule(); }
    panel.focus({ preventScroll:true });
    return { close,host };
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message.action === 'start-speed-reading') start().catch(error => console.warn('Speed Reader could not start:', error.message));
  });
})();
