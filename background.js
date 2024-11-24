// Listen for keyboard shortcut
chrome.commands.onCommand.addListener((command) => {
    if (command === "start-speed-reading") {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.tabs.sendMessage(tabs[0].id, { action: "start-speed-reading" });
      });
    }
  });
  
  // Create context menu item (optional)
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "start-speed-reading",
      title: "Start Speed Reading",
      contexts: ["selection"]
    });
  });
  
  // Handle context menu click
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "start-speed-reading") {
      chrome.tabs.sendMessage(tab.id, { action: "start-speed-reading", selectedText: info.selectionText });
    }
  });
  