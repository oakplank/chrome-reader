# Speed Reader Highlighter

Read articles word by word, with a paced highlight moving through the original page. The page follows your place as you read.

Choose **Read aloud** to listen along, using free installed voices or your own Google Cloud key.

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

## Read aloud

- **Read aloud** starts speaking from the current word. It is always an explicit choice; speech never starts automatically when opening the reader.
- **Voice settings** opens a separate extension page to select an installed voice or configure Google Cloud. Installed voices are the free default and need no key.
- **Pause / Resume**, **Back 25**, **Restart** and **Read again** also control speech. Resume reuses the current audio while available; after Chrome releases an idle audio session, it generates a new passage from the current word. Closing the reader stops speech; changing tabs pauses it. Only one tab speaks at a time.
- The speed slider changes to **0.5–2.0× voice** while speaking. **Stop voice** returns to visual reading at your saved WPM.
- The highlight follows word events from installed voices, or timestamps from Google Cloud. Installed voices without word events use approximate timing, labeled in the reader.
- Cloud speech is generated in short passages. There may be a brief pause between passages. Restarting, seeking or changing speaking speed can request new audio and use additional quota.

### Bring your own key

Open **Voice settings**, choose **Google Cloud · use my key**, select a voice, and paste a Google Cloud API key. Enable Cloud Text-to-Speech and billing on that key's project, and restrict the key to the Cloud Text-to-Speech API. This is not a Gemini API key. Save and grant access to the Google speech endpoint when Chrome prompts, then return to the article and choose **Read aloud**.

As checked September 26, 2026, Google's [pricing page](https://cloud.google.com/text-to-speech/pricing) lists 4 million free characters per month for Standard/WaveNet, then US$4 per million. Other use of your project counts toward its allowance. Set a quota in Google Cloud to limit spending; the extension cannot determine your remaining free allowance. Google requires billing even when usage fits the free tier. Check current pricing before use.

The key is stored locally in trusted extension storage, never returned to content scripts or placed in page markup, URLs or logs. Local storage is not an encrypted password vault. **Remove saved key** deletes it and switches back to installed voices. No shared developer key, subscription or extension backend is needed.

## Limitations

The reader requires Chrome 116 or newer and supports ordinary HTML text in the main page. Browser settings pages, the Chrome Web Store, built-in PDF viewers, embedded frames, canvas text and text inside page shadow roots are not supported. If the toolbar shows `!`, hover it for guidance. Reload existing tabs after installing or updating the extension.

Installed speech voices depend on the operating system and browser. If none are available, install a speech voice through your system settings or configure a cloud voice. Cloud speech needs a working key and internet connection; quota, authentication and audio errors pause reading with guidance instead of silently switching services.

If the current text changes while reading, the reader pauses and asks for a fresh selection. Pages that replace content dynamically may need to be restarted.

Article detection uses the page's HTML structure. Poorly marked-up pages may include unrelated text; unusually tall sticky headers or overlays can still obscure the article. This is not a full article-extraction service.

## Privacy and permissions

Visual reading and installed voices run locally. The extension filters out remote system voices. No article text or reading history is saved. If you explicitly configure Google Cloud and start speech, the current passage is sent directly to `texttospeech.googleapis.com` using your key; generated audio is held temporarily for playback. Preferences and your optional key are stored on this device, not synced.

- `activeTab`: start from the active tab.
- `contextMenus`: the selection context-menu entry.
- `storage`: save preferences locally.
- `tts`: speak with installed voices and receive word events.
- `offscreen`: play cloud audio independently of webpage media restrictions.
- Optional access to `https://texttospeech.googleapis.com/*`: generate speech with your own key.
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

Speech tests exercise controls and timing with deterministic native events, mock Google responses through the real audio player, verify restrictive-page playback and key isolation, and cover cancellation, errors and key removal. They do not require a real key or incur API charges. A native-engine smoke check runs when the test browser exposes installed voices; the summary records when unavailable. Live Google synthesis and subjective voice quality require a separate check with your own key.

## Version 1.7.0

Added free installed-voice speech, optional Google Cloud Standard/WaveNet speech with your own key, word synchronization, voice settings, speech speed, isolated key storage and speech lifecycle tests. Not published to the Chrome Web Store.

## Version 1.6.0

Corrected selection anchoring and first-word timing; replaced leaking global session handlers; refreshed and isolated the reading panel; added local preferences, progress, replay, toolbar activation and clear failure guidance. On-page reading now has compact controls, word-level automatic scrolling and article boundaries. This working copy has not been published to the Chrome Web Store.
