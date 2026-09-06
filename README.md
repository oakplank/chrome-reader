# Speed Reader Highlighter

Read articles word by word, with a paced highlight moving through the original page. The page follows your place as you read.

## Try the local update

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository folder.
3. Reload an ordinary webpage. Select a word or passage, then press **Alt+H**, click the extension's toolbar button, or right-click and choose **Read from selection**.

Use `chrome://extensions/shortcuts` to change the shortcut. Disable the store version while trying this unpacked copy to avoid duplicate readers.

## Reading controls

- **Pause / Resume:** stop and continue at your current position.
- **Back 25:** move back up to 25 words, without moving before your starting point.
- **Restart:** return to your starting point. If paused, remain paused.
- **Reading speed:** 100–800 words per minute. Speed, light/dark theme and word-view preference are saved locally.
- **Word view:** optionally show the current word in a larger floating display. Compact on-page reading is the default.
- **Read again:** replay after reaching the end of the article.
- Drag the header to move the controls. They stay inside the viewport and move aside when they would cover the current word.
- Press **Escape** to close. With the reader panel focused, **Space** toggles playback and **Left Arrow** goes back 25 words. Buttons and the speed slider keep their usual keyboard behavior.

Reading starts at the actual selected position, even when the same word appears earlier. Selecting a passage chooses the starting point; reading continues to the end of the containing article or main content area. Pages without those landmarks fall back to the page body. Navigation, sidebars, footers, hidden content, scripts and editable fields are skipped. Moving to another tab pauses playback.

Scrolling follows the highlighted word, including within a long paragraph or a scrollable article pane. Pausing stops automatic scrolling.

## Limitations

The reader supports ordinary HTML text in the main page. Browser settings pages, the Chrome Web Store, built-in PDF viewers, embedded frames, canvas text and text inside page shadow roots are not supported. If the toolbar shows `!`, hover it for guidance. Reload existing tabs after installing or updating the extension.

If the current text changes while reading, the reader pauses and asks for a fresh selection. Pages that replace content dynamically may need to be restarted.

Article detection uses the page's HTML structure. Poorly marked-up pages may include unrelated text; unusually tall sticky headers or overlays can still obscure the article. This is not a full article-extraction service.

## Privacy and permissions

Reading runs locally. No page text or reading history is sent to a server or saved. Only reading speed, theme and word-view preference are stored in `chrome.storage.local`.

- `activeTab`: start from the active tab.
- `contextMenus`: the selection context-menu entry.
- `storage`: save preferences locally.
- The content script runs on matching webpages, as in the previous version.

## Verify

The extension has no runtime build step or runtime dependencies. The browser test uses Playwright:

```sh
npm install
npx playwright install chromium
npm run check
npm test
```

The tests load the actual unpacked extension in isolated Chromium profiles. They check repeated-word and multi-node selection, first-word timing, Unicode words, hidden text, pause/restart, saved preferences, narrow layout, replay, cleanup, page changes and unsupported-page feedback. Reading-experience checks verify word alignment, pacing, long-paragraph and nested scrolling, control overlap, optional word view and article boundaries. Screenshots and JSON summaries go to the ignored `test-results/` directory.

## Version 1.6.0

Corrected selection anchoring and first-word timing; replaced leaking global session handlers; refreshed and isolated the reading panel; added local preferences, progress, replay, toolbar activation and clear failure guidance. On-page reading now has compact controls, word-level automatic scrolling and article boundaries. This working copy has not been published to the Chrome Web Store.
