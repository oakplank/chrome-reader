chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "start-speed-reading") {
      startSpeedReading(request.selectedText);
    }
  });
  
  function startSpeedReading(selectedText = null) {
    // Prevent multiple instances
    if (window.speedReadingActive) {
      return;
    }
    window.speedReadingActive = true;
  
    // Get the selected text or prompt the user
    let selectedWord = selectedText || window.getSelection().toString().trim();
  
    if (!selectedWord) {
      alert("Please select a word to start speed reading.");
      window.speedReadingActive = false;
      return;
    }
  
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
  
    // Find the index of the selected word (case-insensitive)
    let startIndex = words.findIndex(
      (w) => w.word.toLowerCase() === selectedWord.toLowerCase()
    );
  
    if (startIndex === -1) {
      alert("Selected word not found in the page.");
      window.speedReadingActive = false;
      return;
    }
  
    // Create the display box
    const displayBox = document.createElement("div");
    displayBox.style.position = "fixed";
  
    // Load position and size from localStorage
    let savedPosition = localStorage.getItem("speedReaderPosition");
    let savedSize = localStorage.getItem("speedReaderSize");
  
    if (savedPosition) {
      let position = JSON.parse(savedPosition);
      displayBox.style.top = position.top + "px";
      displayBox.style.left = position.left + "px";
    } else {
      displayBox.style.top = "10px";
      displayBox.style.left = "10px";
    }
  
    if (savedSize) {
      let size = JSON.parse(savedSize);
      displayBox.style.width = size.width + "px";
      displayBox.style.height = size.height + "px";
    } else {
      displayBox.style.width = "400px"; // Default width
      displayBox.style.height = "200px"; // Default height
    }
  
    displayBox.style.backgroundColor = "white";
    displayBox.style.border = "1px solid #ccc";
    displayBox.style.zIndex = "9999";
    displayBox.style.display = "flex";
    displayBox.style.flexDirection = "column";
    displayBox.style.resize = "both";
    displayBox.style.overflow = "hidden";
    displayBox.style.boxShadow = "0px 0px 10px rgba(0,0,0,0.1)";
    displayBox.style.boxSizing = "border-box";
    displayBox.style.borderRadius = "10px"; // Rounded corners
    displayBox.style.minWidth = "300px"; // Minimum width
    displayBox.style.minHeight = "150px"; // Minimum height
    document.body.appendChild(displayBox);
  
    // Create header for moving
    const header = document.createElement("div");
    header.style.width = "100%";
    header.style.height = "30px";
    header.style.backgroundColor = "#f0f0f0";
    header.style.borderBottom = "1px solid #ccc";
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.cursor = "move";
    header.style.paddingLeft = "10px";
    header.style.boxSizing = "border-box";
    header.style.userSelect = "none";
    header.style.borderTopLeftRadius = "10px"; // Rounded corners
    header.style.borderTopRightRadius = "10px"; // Rounded corners
    displayBox.appendChild(header);
  
    // Add title to header
    const title = document.createElement("span");
    title.textContent = "Speed Reader";
    title.style.flexGrow = "1";
    title.style.fontWeight = "bold";
    header.appendChild(title);
  
    // Add dark mode toggle
    const darkModeToggle = document.createElement("button");
    darkModeToggle.textContent = "☾"; // Moon symbol for dark mode
    darkModeToggle.style.cursor = "pointer";
    darkModeToggle.style.border = "none";
    darkModeToggle.style.backgroundColor = "transparent";
    darkModeToggle.style.fontSize = "16px";
    darkModeToggle.style.padding = "0";
    darkModeToggle.style.margin = "0 5px";
    header.appendChild(darkModeToggle);
  
    // Load dark mode setting from localStorage
    let savedDarkMode = localStorage.getItem("speedReaderDarkMode");
    let isDarkMode = savedDarkMode === "true";
  
    // Add close button to header
    const closeButton = document.createElement("button");
    closeButton.textContent = "✕";
    closeButton.style.cursor = "pointer";
    closeButton.style.border = "none";
    closeButton.style.backgroundColor = "transparent";
    closeButton.style.fontSize = "16px";
    closeButton.style.padding = "0";
    closeButton.style.margin = "0 5px";
    header.appendChild(closeButton);
  
    closeButton.addEventListener('click', () => {
      cleanup();
    });
  
    // Create word display area
    const wordDisplay = document.createElement("div");
    wordDisplay.style.flexGrow = "1";
    wordDisplay.style.display = "flex";
    wordDisplay.style.alignItems = "center";
    wordDisplay.style.justifyContent = "center";
    wordDisplay.style.fontSize = "24px";
    wordDisplay.style.userSelect = "none";
    displayBox.appendChild(wordDisplay);
  
    // Create controls container
    const controlsContainer = document.createElement("div");
    controlsContainer.style.width = "100%";
    controlsContainer.style.height = "50px";
    controlsContainer.style.display = "flex";
    controlsContainer.style.alignItems = "center";
    controlsContainer.style.justifyContent = "center";
    controlsContainer.style.borderTop = "1px solid #ccc";
    controlsContainer.style.padding = "5px";
    controlsContainer.style.boxSizing = "border-box";
    displayBox.appendChild(controlsContainer);
  
    // Create rewind button with icon
    const rewindButton = document.createElement("button");
    rewindButton.innerHTML = "<<"; // Rewind icon
    rewindButton.style.margin = "0 5px";
    rewindButton.style.fontSize = "20px";
    rewindButton.style.cursor = "pointer";
    rewindButton.style.backgroundColor = "transparent";
    rewindButton.style.border = "none";
    rewindButton.style.padding = "0";
    rewindButton.style.outline = "none";
    controlsContainer.appendChild(rewindButton);
  
    // Create pause/resume button with icon
    const pauseButton = document.createElement("button");
    pauseButton.innerHTML = "❚❚"; // Pause icon
    pauseButton.style.margin = "0 5px";
    pauseButton.style.fontSize = "20px";
    pauseButton.style.cursor = "pointer";
    pauseButton.style.backgroundColor = "transparent";
    pauseButton.style.border = "none";
    pauseButton.style.padding = "0";
    pauseButton.style.outline = "none";
    controlsContainer.appendChild(pauseButton);
  
    // Create restart button with icon
    const restartButton = document.createElement("button");
    restartButton.innerHTML = "↻"; // Restart icon (using previous track symbol)
    restartButton.style.margin = "0 5px";
    restartButton.style.fontSize = "20px";
    restartButton.style.cursor = "pointer";
    restartButton.style.backgroundColor = "transparent";
    restartButton.style.border = "none";
    restartButton.style.padding = "0";
    restartButton.style.outline = "none";
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
    sliderContainer.appendChild(speedSlider);
  
    // Create WPM display
    const wpmDisplay = document.createElement("div");
    let readingSpeed = 200; // milliseconds per word
    let wpm = Math.round(60000 / readingSpeed);
    wpmDisplay.textContent = `${wpm} WPM`;
    wpmDisplay.style.minWidth = "50px";
    wpmDisplay.style.textAlign = "center";
    sliderContainer.appendChild(wpmDisplay);
  
    // Dark mode functionality
    function updateColors() {
      if (isDarkMode) {
        displayBox.style.backgroundColor = "#333";
        displayBox.style.color = "#fff";
        header.style.backgroundColor = "#444";
        header.style.borderBottom = "1px solid #555";
        controlsContainer.style.borderTop = "1px solid #555";
        speedSlider.style.backgroundColor = "#555";
        pauseButton.style.color = "#fff";
        restartButton.style.color = "#fff";
        rewindButton.style.color = "#fff";
        darkModeToggle.textContent = "☀"; // Sun symbol for light mode
        darkModeToggle.style.color = "#fff";
        closeButton.style.color = "#fff";
      } else {
        displayBox.style.backgroundColor = "white";
        displayBox.style.color = "black";
        header.style.backgroundColor = "#f0f0f0";
        header.style.borderBottom = "1px solid #ccc";
        controlsContainer.style.borderTop = "1px solid #ccc";
        speedSlider.style.backgroundColor = "";
        pauseButton.style.color = "#000";
        restartButton.style.color = "#000";
        rewindButton.style.color = "#000";
        darkModeToggle.textContent = "☾"; // Moon symbol for dark mode
        darkModeToggle.style.color = "#000";
        closeButton.style.color = "#000";
      }
    }
    darkModeToggle.addEventListener('click', () => {
      isDarkMode = !isDarkMode;
      localStorage.setItem('speedReaderDarkMode', isDarkMode);
      updateColors();
    });
    updateColors(); // Initialize colors
  
    // Make the display box draggable
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
  
    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      dragOffsetX = e.clientX - displayBox.offsetLeft;
      dragOffsetY = e.clientY - displayBox.offsetTop;
      e.preventDefault();
    });
  
    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        displayBox.style.left = e.clientX - dragOffsetX + 'px';
        displayBox.style.top = e.clientY - dragOffsetY + 'px';
      }
    });
  
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        // Save position
        let position = {
          top: parseInt(displayBox.style.top),
          left: parseInt(displayBox.style.left)
        };
        localStorage.setItem('speedReaderPosition', JSON.stringify(position));
      }
    });
  
    // Save size on resize
    displayBox.addEventListener('mouseup', () => {
      let size = {
        width: displayBox.clientWidth,
        height: displayBox.clientHeight
      };
      localStorage.setItem('speedReaderSize', JSON.stringify(size));
    });
  
    // Create or get the highlighter div
    let highlighterDiv;
    if (!window.highlighterDiv) {
      window.highlighterDiv = document.createElement('div');
      highlighterDiv = window.highlighterDiv;
      highlighterDiv.style.position = 'absolute';
      highlighterDiv.style.backgroundColor = 'rgba(255, 255, 0, 0.5)'; // Semi-transparent yellow
      highlighterDiv.style.zIndex = '9998';
      highlighterDiv.style.pointerEvents = 'none';
      highlighterDiv.style.transition = 'top 0.2s, left 0.2s'; // Smooth transition
      document.body.appendChild(highlighterDiv);
    } else {
      highlighterDiv = window.highlighterDiv;
    }
  
    // Function to highlight a word on the page
    function highlightWord(wordObj) {
      // Create a range to select the word
      const range = document.createRange();
      range.setStart(wordObj.node, wordObj.startOffset);
      range.setEnd(wordObj.node, wordObj.endOffset);
  
      // Get the bounding rectangle of the word
      const rect = range.getBoundingClientRect();
  
      // Position the highlighterDiv over the word
      highlighterDiv.style.width = rect.width + 'px';
      highlighterDiv.style.height = rect.height + 'px';
      highlighterDiv.style.top = (rect.top + window.scrollY) + 'px';
      highlighterDiv.style.left = (rect.left + window.scrollX) + 'px';
  
      // Scroll to the word if it's not in the viewport
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const viewportTop = window.scrollY || window.pageYOffset;
      const viewportBottom = viewportTop + viewportHeight;
  
      const wordTop = rect.top + window.scrollY;
      const wordBottom = rect.bottom + window.scrollY;
  
      const margin = viewportHeight * 0.2; // 20% margin
  
      if (wordTop < viewportTop + margin || wordBottom > viewportBottom - margin) {
        const scrollTarget = wordTop - (viewportHeight / 2) + (rect.height / 2);
  
        window.scrollTo({
          top: scrollTarget,
          behavior: 'smooth'
        });
      }
    }
  
    let currentIndex = startIndex;
    let isPaused = false;
  
    // Update reading speed based on slider value
    speedSlider.addEventListener("input", () => {
      const speedMultiplier = parseFloat(speedSlider.value);
      readingSpeed = 200 / speedMultiplier;
      wpm = Math.round(60000 / readingSpeed);
      wpmDisplay.textContent = `${wpm} WPM`;
    });
  
    // Pause/Resume functionality
    function pauseReading() {
      if (!isPaused) {
        isPaused = true;
        pauseButton.innerHTML = "▶"; // Play icon
        clearTimeout(window.readingTimeout);
      }
    }
  
    function resumeReading() {
      if (isPaused) {
        isPaused = false;
        pauseButton.innerHTML = "❚❚"; // Pause icon
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
      currentIndex = startIndex;
      pauseReading();
      resumeReading();
    });
  
    // Rewind functionality
    rewindButton.addEventListener('click', () => {
      currentIndex = Math.max(0, currentIndex - 50); // Go back 50 words
      pauseReading();
      resumeReading();
    });
  
    // Auto-pause when tab loses focus
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        pauseReading();
      }
    });
  
    // Start the reading loop
    function readingLoop() {
      if (isPaused) return;
  
      if (currentIndex >= words.length) {
        cleanup();
        return;
      }
  
      const currentWordObj = words[currentIndex];
      wordDisplay.textContent = currentWordObj.word;
  
      highlightWord(currentWordObj);
  
      currentIndex++;
  
      window.readingTimeout = setTimeout(readingLoop, readingSpeed);
    }
  
    function cleanup() {
      clearTimeout(window.readingTimeout);
      displayBox.remove();
      if (window.highlighterDiv) {
        window.highlighterDiv.remove();
        window.highlighterDiv = null;
      }
      window.speedReadingActive = false;
    }
  
    // Start the loop
    readingLoop();
  
    // Make font size scalable based on the display box size
    const observer = new ResizeObserver(entries => {
      for (let entry of entries) {
        const width = entry.contentRect.width;
        const height = entry.contentRect.height;
        // Adjust font size based on the size of the box
        let newFontSize = Math.min(width, height - 100) / 5; // Adjusted for header and controls
        wordDisplay.style.fontSize = newFontSize + 'px';
      }
    });
    observer.observe(displayBox);
  }
  