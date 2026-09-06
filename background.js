'use strict';

async function startInTab(tabId, frameId = 0) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'start-speed-reading' }, { frameId });
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setTitle({ tabId, title: 'Start Speed Reading' });
  } catch {
    await chrome.action.setBadgeText({ tabId, text: '!' }).catch(() => {});
    await chrome.action.setTitle({ tabId, title: 'Open an ordinary webpage and reload it, then select text and try again.' }).catch(() => {});
  }
}

chrome.commands.onCommand.addListener(async command => {
  if (command === 'start-speed-reading') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await startInTab(tab?.id);
  }
});

chrome.action.onClicked.addListener(tab => startInTab(tab.id));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'start-speed-reading', title: 'Read from selection', contexts: ['selection'] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'start-speed-reading') startInTab(tab?.id, info.frameId ?? 0);
});
