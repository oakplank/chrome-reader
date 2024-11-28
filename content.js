// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "start-speed-reading") {
    startSpeedReading(request.selectedText);
  }
});

// Function to sanitize and compare words
function sanitizeWord(word) {
  return word.replace(/[^\w]/g, '').toLowerCase();
}

// Function to start speed reading
function startSpeedReading(selectedText = null) {
  console.log("Start Speed Reading triggered."); // Debugging

  // Prevent multiple instances
  if (window.speedReadingActive) {
    console.log("Speed reading already active."); // Debugging
    return;
  }
  window.speedReadingActive = true;

  // Handle only HTML pages
  let selectedWord = selectedText || window.getSelection().toString().trim();
  console.log("Selected Word:", selectedWord); // Debugging

  if (!selectedWord) {
    alert("Please select a word to start speed reading.");
    window.speedReadingActive = false;
    return;
  }

  handleHTML(selectedWord);
}

// Function to handle HTML pages
function handleHTML(selectedWord) {
  // Get all text nodes in the body
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  let nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    nodes.push(node);
  }

  // Flatten the text content and create an array of words with their positions
  let words = [];
  nodes.forEach((textNode) => {
    const text = textNode.nodeValue;
    const regex = /\b(\w+)\b/g;
    let match;
    while ((match = regex.exec(text))) {
      words.push({
        word: match[1],
        node: textNode,
        startOffset: match.index,
        endOffset: regex.lastIndex,
      });
    }
  });

  // Find the index of the selected word (case-insensitive and sanitized)
  let startIndex = words.findIndex(
    (w) => sanitizeWord(w.word) === sanitizeWord(selectedWord)
  );

  if (startIndex === -1) {
    alert("Selected word not found in the page.");
    window.speedReadingActive = false;
    return;
  }

  initiateReader(words, startIndex);
}

// Function to inject CSS for styles and transitions
function injectStyles() {
  const style = document.createElement('style');
  style.textContent = `
    /* Highlight Styles */
    .speed-reader-highlight {
      position: absolute;
      background-color: rgba(255, 255, 0, 0.5); /* Semi-transparent yellow */
      pointer-events: none;
      z-index: 10000; /* Above all elements */
      border-radius: 2px;
      transition: left 0.3s ease, top 0.3s ease, width 0.3s ease, height 0.3s ease, opacity 0.3s ease;
      opacity: 0; /* Start hidden */
    }

    /* Display Box Styles */
    .speed-reader-box {
      background-color: white;
      z-index: 10001; /* Above the highlight */
      box-shadow: 0px 0px 10px rgba(0,0,0,0.3);
      border-radius: 10px;
      display: flex;
      flex-direction: column;
      resize: both;
      overflow: hidden;
      width: 450px; /* Increased default width */
      height: 200px; /* Standard height */
      position: fixed; /* Fixed relative to viewport */
      top: 10px; /* Fixed top position */
      left: 10px; /* Fixed left position */
      transition: background-color 0.3s ease;
      min-width: 300px; /* Minimum width */
      min-height: 150px; /* Minimum height */
    }

    .speed-reader-box.dark-mode {
      background-color: #333;
    }

    /* Header Styles */
    .speed-reader-header {
      width: 100%;
      height: 40px;
      background-color: #f0f0f0;
      border-bottom: 1px solid #ccc;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 10px;
      box-sizing: border-box;
      user-select: none;
      cursor: move;
      border-top-left-radius: 10px; /* Rounded corners */
      border-top-right-radius: 10px; /* Rounded corners */
      transition: background-color 0.3s ease, border-bottom 0.3s ease;
    }

    .speed-reader-header.dark-mode {
      background-color: #444;
      border-bottom: 1px solid #555;
    }

    /* Title Styles */
    .speed-reader-header .title {
      font-weight: bold;
      font-size: 18px;
      color: #555;
    }

    .speed-reader-header.dark-mode .title {
      color: #fff;
    }

    /* Control Buttons in Header */
    .speed-reader-header .header-controls {
      display: flex;
      align-items: center;
    }

    .speed-reader-header .header-controls button {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 18px;
      margin-left: 10px;
      color: #555;
      transition: color 0.2s ease;
    }

    .speed-reader-header .header-controls button:hover {
      /* Removed blue hover color */
      color: #555;
    }

    .speed-reader-header.dark-mode .header-controls button {
      color: #fff;
    }

    /* Word Display Styles */
    .speed-reader-word-display {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      padding: 10px;
      box-sizing: border-box;
      overflow: hidden;
      font-size: 24px; /* Base font size */
      background-color: #fff;
      transition: background-color 0.3s ease, color 0.3s ease;
    }

    .speed-reader-box.dark-mode .speed-reader-word-display {
      background-color: #555;
      color: #fff;
    }

    .speed-reader-prev-word,
    .speed-reader-next-word {
      margin: 0 10px; /* Minimal horizontal margin */
      color: #aaa; /* Lighter color for context */
      transition: color 0.3s ease;
      flex: 1;
      text-align: center;
    }

    .speed-reader-box.dark-mode .speed-reader-prev-word,
    .speed-reader-box.dark-mode .speed-reader-next-word {
      color: #777; /* Darker color for context */
    }

    .speed-reader-current-word {
      font-weight: bold;
      color: #000; /* Prominent color */
      text-align: center;
      flex: 0 0 auto;
      transition: color 0.3s ease;
    }

    .speed-reader-box.dark-mode .speed-reader-current-word {
      color: #fff; /* Light color for current word */
    }

    /* Controls Styles */
    .speed-reader-controls {
      width: 100%;
      height: 50px;
      background-color: #f9f9f9;
      border-top: 1px solid #ccc;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 5px 10px;
      box-sizing: border-box;
      transition: background-color 0.3s ease, border-top 0.3s ease;
    }

    .speed-reader-controls.dark-mode {
      background-color: #555;
      border-top: 1px solid #666;
    }

    .speed-reader-controls button {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 20px;
      margin: 0 10px;
      color: #555;
      transition: color 0.2s ease;
    }

    .speed-reader-controls button:hover {
      /* Removed blue hover color */
      color: #555;
    }

    .speed-reader-controls.dark-mode button {
      color: #fff;
    }

    .speed-reader-controls input[type=range] {
      width: 150px;
      cursor: pointer;
    }

    .speed-reader-controls label {
      margin-right: 10px;
      color: #555;
      font-size: 14px;
      transition: color 0.3s ease;
    }

    .speed-reader-controls.dark-mode label {
      color: #fff;
    }
  `;
  document.head.appendChild(style);
}

// Function to create and position the reading box
function createDisplayBox() {
  const displayBox = document.createElement("div");
  displayBox.classList.add("speed-reader-box");
  // Position is fixed by CSS

  // Always set to default position and size
  displayBox.style.top = "10px";
  displayBox.style.left = "10px";
  displayBox.style.width = "450px"; // Increased default width
  displayBox.style.height = "200px"; // Standard height

  // Create header for moving
  const header = document.createElement("div");
  header.classList.add("speed-reader-header");

  // Add title to header
  const title = document.createElement("span");
  title.classList.add("title");
  title.textContent = "Speed Reader";
  header.appendChild(title);

  // Header Controls (Dark Mode Toggle and Close Button)
  const headerControls = document.createElement("div");
  headerControls.classList.add("header-controls");

  // Add dark mode toggle
  const darkModeToggle = document.createElement("button");
  darkModeToggle.id = "darkModeToggle";
  darkModeToggle.textContent = "☾"; // Moon symbol for dark mode
  darkModeToggle.title = "Toggle Dark Mode";
  darkModeToggle.setAttribute('aria-label', 'Toggle Dark Mode'); // Accessibility
  headerControls.appendChild(darkModeToggle);

  // Add close button to header
  const closeButton = document.createElement("button");
  closeButton.classList.add("close-button");
  closeButton.textContent = "✕";
  closeButton.title = "Close Speed Reader";
  closeButton.setAttribute('aria-label', 'Close Speed Reader'); // Accessibility
  headerControls.appendChild(closeButton);

  header.appendChild(headerControls);
  displayBox.appendChild(header);

  // Make the display box draggable within the viewport
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = displayBox.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      let newLeft = e.clientX - dragOffsetX;
      let newTop = e.clientY - dragOffsetY;

      // Ensure the box stays within the viewport
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const boxRect = displayBox.getBoundingClientRect();

      // Prevent the box from moving out of the viewport
      newLeft = Math.max(0, Math.min(newLeft, viewportWidth - boxRect.width));
      newTop = Math.max(0, Math.min(newTop, viewportHeight - boxRect.height));

      displayBox.style.left = `${newLeft}px`;
      displayBox.style.top = `${newTop}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      // No longer saving position to localStorage
    }
  });

  // Append the display box to the body
  document.body.appendChild(displayBox);

  return { displayBox, closeButton, darkModeToggle };
}

// Function to create word display area
function createWordDisplay(displayBox) {
  const wordDisplay = document.createElement("div");
  wordDisplay.classList.add("speed-reader-word-display");
  displayBox.appendChild(wordDisplay);

  // Create previous, current, and next word spans
  const prevWord = document.createElement("span");
  prevWord.classList.add("speed-reader-prev-word");
  wordDisplay.appendChild(prevWord);

  const currentWord = document.createElement("span");
  currentWord.classList.add("speed-reader-current-word");
  wordDisplay.appendChild(currentWord);

  const nextWord = document.createElement("span");
  nextWord.classList.add("speed-reader-next-word");
  wordDisplay.appendChild(nextWord);

  return { prevWord, currentWord, nextWord };
}

// Function to create controls container
function createControls(displayBox) {
  const controlsContainer = document.createElement("div");
  controlsContainer.classList.add("speed-reader-controls");
  displayBox.appendChild(controlsContainer);

  // Create rewind button with previous icon
  const rewindButton = document.createElement("button");
  rewindButton.id = "rewindButton";
  rewindButton.innerHTML = "⏪"; // Rewind icon
  rewindButton.title = "Rewind";
  rewindButton.setAttribute('aria-label', 'Rewind');
  controlsContainer.appendChild(rewindButton);

  // Create pause/resume button with icon
  const pauseButton = document.createElement("button");
  pauseButton.id = "pauseButton";
  pauseButton.innerHTML = "❚❚"; // Pause icon
  pauseButton.title = "Pause";
  pauseButton.setAttribute('aria-label', 'Pause Reading');
  controlsContainer.appendChild(pauseButton);

  // Create restart button with icon
  const restartButton = document.createElement("button");
  restartButton.id = "restartButton";
  restartButton.innerHTML = "🔄"; // Restart icon
  restartButton.title = "Restart";
  restartButton.setAttribute('aria-label', 'Restart Reading');
  controlsContainer.appendChild(restartButton);

  // Create speed slider container
  const sliderContainer = document.createElement("div");
  sliderContainer.style.display = "flex";
  sliderContainer.style.alignItems = "center";
  sliderContainer.style.marginLeft = "10px";
  controlsContainer.appendChild(sliderContainer);

  // Create speed slider
  const speedSlider = document.createElement("input");
  speedSlider.type = "range";
  speedSlider.min = "0.5";
  speedSlider.max = "2.0";
  speedSlider.step = "0.1";
  speedSlider.value = "1.0";
  speedSlider.style.marginRight = "5px";
  speedSlider.style.cursor = "pointer";
  speedSlider.style.width = "100px";
  sliderContainer.appendChild(speedSlider);

  // Create WPM display
  const wpmDisplay = document.createElement("div");
  let readingSpeed = 200; // milliseconds per word
  let wpm = Math.round(60000 / readingSpeed);
  wpmDisplay.textContent = `${wpm} WPM`;
  wpmDisplay.style.minWidth = "50px";
  wpmDisplay.style.textAlign = "center";
  sliderContainer.appendChild(wpmDisplay);

  return { rewindButton, pauseButton, restartButton, speedSlider, wpmDisplay };
}

// Function to initiate the reader
function initiateReader(words, startIndex) {
  // Inject CSS for styles and transitions
  injectStyles();

  // Create the display box
  const { displayBox, closeButton, darkModeToggle } = createDisplayBox();

  // Create word display area
  const { prevWord, currentWord, nextWord } = createWordDisplay(displayBox);

  // Create controls container
  const {
    rewindButton,
    pauseButton,
    restartButton,
    speedSlider,
    wpmDisplay
  } = createControls(displayBox);

  let currentIndex = startIndex;
  let isPaused = false;
  let initialStartIndex = startIndex; // To remember the first highlighted word

  // Update reading speed based on slider value
  speedSlider.addEventListener("input", () => {
    const speedMultiplier = parseFloat(speedSlider.value);
    readingSpeed = 200 / speedMultiplier;
    wpm = Math.round(60000 / readingSpeed);
    wpmDisplay.textContent = `${wpm} WPM`;
  });

  let readingSpeed = 200; // milliseconds per word
  let wpm = Math.round(60000 / readingSpeed);
  wpmDisplay.textContent = `${wpm} WPM`;

  // Pause/Resume functionality
  function pauseReading() {
    if (!isPaused) {
      isPaused = true;
      pauseButton.innerHTML = "▶"; // Play icon
      pauseButton.title = "Resume";
      pauseButton.setAttribute('aria-label', 'Resume Reading');
      clearTimeout(window.readingTimeout);
    }
  }

  function resumeReading() {
    if (isPaused) {
      isPaused = false;
      pauseButton.innerHTML = "❚❚"; // Pause icon
      pauseButton.title = "Pause";
      pauseButton.setAttribute('aria-label', 'Pause Reading');
      readingLoop();
    }
  }

  pauseButton.addEventListener('click', () => {
    if (isPaused) {
      resumeReading();
    } else {
      pauseReading();
    }
  });

  // Restart functionality
  restartButton.addEventListener('click', () => {
    pauseReading();
    currentIndex = initialStartIndex; // Reset to the first highlighted word
    if (currentIndex < words.length) {
      updateWordDisplayUI(words, currentIndex);
      highlightWordOnPage(words[currentIndex]);
      currentIndex++;
      resumeReading();
    }
  });

  // Rewind functionality
  rewindButton.addEventListener('click', () => {
    pauseReading();
    const rewindCount = 50; // Number of words to rewind
    currentIndex = Math.max(initialStartIndex, currentIndex - rewindCount); // Ensure not to go before the initial word
    if (currentIndex < words.length) {
      updateWordDisplayUI(words, currentIndex);
      highlightWordOnPage(words[currentIndex]);
      currentIndex++;
      resumeReading();
    }
  });

  // Close functionality
  closeButton.addEventListener('click', () => {
    cleanup();
  });

  // Auto-pause when tab loses focus
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseReading();
    }
  });

  // Create a single highlight element
  const highlightDiv = document.createElement('div');
  highlightDiv.classList.add('speed-reader-highlight');
  document.body.appendChild(highlightDiv);
  window.currentHighlight = highlightDiv; // Store globally for access in other functions

  // Function to update the word display UI
  function updateWordDisplayUI(words, index) {
    // Previous word
    if (index > 0 && words[index - 1]) {
      prevWord.textContent = words[index - 1].word;
    } else {
      prevWord.textContent = "";
    }

    // Current word
    if (words[index]) {
      currentWord.textContent = words[index].word;
      highlightWordOnPage(words[index]);
    } else {
      currentWord.textContent = "";
    }

    // Next word
    if (words[index + 1]) {
      nextWord.textContent = words[index + 1].word;
    } else {
      nextWord.textContent = "";
    }

    // Dynamically adjust font size based on box size
    adjustFontSize(displayBox);
  }

  // Function to adjust font size based on box size
  function adjustFontSize(displayBox) {
    const boxWidth = displayBox.clientWidth;
    const boxHeight = displayBox.clientHeight;

    // Calculate a suitable font size (e.g., 5% of box height)
    const newFontSize = Math.max(16, boxHeight * 0.05); // Minimum font size of 16px
    const wordDisplay = displayBox.querySelector(".speed-reader-word-display");
    if (wordDisplay) {
      wordDisplay.style.fontSize = `${newFontSize}px`;
    }
  }

  // Reading loop
  function readingLoop() {
    if (isPaused) return;

    if (currentIndex >= words.length) {
      cleanup();
      return;
    }

    updateWordDisplayUI(words, currentIndex);
    currentIndex++;

    window.readingTimeout = setTimeout(readingLoop, readingSpeed);
  }

  // Start the reading loop
  if (currentIndex < words.length) {
    updateWordDisplayUI(words, currentIndex);
    currentIndex++;
    readingLoop();
  }

  // Setup Dark Mode Toggle after the box is created
  setupDarkModeToggle();
}

// Function to highlight a word on the page with smooth transitions and auto-scrolling
function highlightWordOnPage(wordObj) {
  const highlightDiv = window.currentHighlight;

  if (wordObj.node && wordObj.startOffset !== undefined) {
    try {
      // Create a range to select the word
      const range = document.createRange();
      range.setStart(wordObj.node, wordObj.startOffset);
      range.setEnd(wordObj.node, wordObj.endOffset);

      // Get the bounding rectangle of the word
      const rect = range.getBoundingClientRect();

      // Update the highlight div's position and size
      highlightDiv.style.left = `${rect.left + window.scrollX}px`;
      highlightDiv.style.top = `${rect.top + window.scrollY}px`;
      highlightDiv.style.width = `${rect.width}px`;
      highlightDiv.style.height = `${rect.height}px`;
      highlightDiv.style.opacity = '1'; // Ensure it's visible

      // Smooth transition handled by CSS

      // **Auto-Scroll to Keep Highlighted Word in Middle Range**
      const middleRangeTop = window.innerHeight * 0.3; // 30% from top
      const middleRangeBottom = window.innerHeight * 0.7; // 70% from top

      const wordCenterY = rect.top + rect.height / 2;

      if (wordCenterY < middleRangeTop) {
        // If word is above the middle range, scroll up
        window.scrollBy({
          top: wordCenterY - middleRangeTop,
          behavior: 'smooth'
        });
      } else if (wordCenterY > middleRangeBottom) {
        // If word is below the middle range, scroll down
        window.scrollBy({
          top: wordCenterY - middleRangeBottom,
          behavior: 'smooth'
        });
      }
    } catch (error) {
      console.error('Error highlighting HTML word:', error);
    }
  }
}

// Cleanup Function
function cleanup() {
  clearTimeout(window.readingTimeout);
  const displayBox = document.querySelector(".speed-reader-box");
  if (displayBox) displayBox.remove();
  if (window.currentHighlight) {
    window.currentHighlight.remove();
    window.currentHighlight = null;
  }
  window.speedReadingActive = false;

  // Remove event listeners to prevent memory leaks
  document.removeEventListener('visibilitychange', handleVisibilityChange);
}

// Function to handle visibility change
function handleVisibilityChange() {
  if (document.hidden) {
    pauseReading();
  }
}

// Function to handle Dark Mode Toggle
function setupDarkModeToggle() {
  const darkModeToggle = document.getElementById('darkModeToggle');
  if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
      const displayBox = document.querySelector(".speed-reader-box");
      const header = displayBox.querySelector(".speed-reader-header");
      const controls = displayBox.querySelector(".speed-reader-controls");
      const wordDisplay = displayBox.querySelector(".speed-reader-word-display");

      // Toggle dark mode class
      displayBox.classList.toggle("dark-mode");
      header.classList.toggle("dark-mode");
      controls.classList.toggle("dark-mode");
      wordDisplay.classList.toggle("dark-mode");

      // Toggle the dark mode icon
      if (displayBox.classList.contains("dark-mode")) {
        darkModeToggle.textContent = "☀"; // Sun symbol for light mode
        darkModeToggle.title = "Toggle Light Mode";
        darkModeToggle.setAttribute('aria-label', 'Toggle Light Mode');
      } else {
        darkModeToggle.textContent = "☾"; // Moon symbol for dark mode
        darkModeToggle.title = "Toggle Dark Mode";
        darkModeToggle.setAttribute('aria-label', 'Toggle Dark Mode');
      }
    });
  }
}

// Initialize Styles
injectStyles();
 