async function fetchAndRenderGames() {
  const inputBox = document.querySelector(".inputBox");
  const username = document.getElementById("username").value.trim();
  const platformEl = document.getElementById("platform");
  const platform = (platformEl && platformEl.value) ? platformEl.value : 'chesscom';
  
  if (!username) return;
  if (window._analysisBusy) return; // prevent multiple fetches
  
  // Remove any existing error state
  const existingError = inputBox.querySelector(".error-message");
  if (existingError) existingError.remove();
  inputBox.classList.remove("error");

  let games = [];
  try {
    if (platform === "chesscom") {
      games = await fetchChesscomGames(username);
    } else {
      games = await fetchLichessGames(username);
    }
  } catch (error) {
    // Show error state
    const inputBox = document.querySelector(".inputBox");
    inputBox.classList.add("error");
    
    // Add error message if it doesn't exist
    if (!inputBox.querySelector(".error-message")) {
      const errorMessage = document.createElement("div");
      errorMessage.className = "error-message";
      errorMessage.textContent = "Invalid username";
      inputBox.appendChild(errorMessage);
    }
    return;
  }

  // Limit to last 15 games
  games = games.slice(0, 15);

  const list = document.getElementById("gamesList");
  // Clear and initialize list with headers
  list.innerHTML = '';
  
  // Create container and headers
  const container = document.createElement('div');
  container.className = 'list-container';
  
  const headers = document.createElement('div');
  headers.className = 'list-headers';
  headers.innerHTML = `
    <div>Date</div>
    <div>Players</div>
    <div>Time</div>
    <div>Result</div>
  `;
  
  container.appendChild(headers);
  list.appendChild(container);

  games.forEach(g => {
    // Extract result and determine if user won
    let resultText = "";
    let resultClass = "";
    const resultMatch = g.pgn.match(/\[Result\s+"([^"]+)"\]/);
    if (resultMatch) {
      const result = resultMatch[1];
      const isUserWhite = g.white.toLowerCase() === username.toLowerCase();
      
      if (result === "1-0") {
        resultClass = isUserWhite ? "win" : "loss";
      } else if (result === "0-1") {
        resultClass = isUserWhite ? "loss" : "win";
      } else {
        resultClass = "draw";
      }
    }

      const li = document.createElement("li");
      li.className = 'game-item';
      li.id = `game-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create wrapper div
      const wrapper = document.createElement("div");
      wrapper.className = 'game-wrapper';
      
      // Format date nicely
      const date = new Date(g.time);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });    const gameContent = `
      <div class="game-row">
        <div class="game-header">
          <span class="date">${dateStr}</span>
          <div class="players">
            <span class="player">
              <span class="name">${escapeHtml(g.white)}</span>
              <span class="rating">(${g.white_rating})</span>
            </span>
            <span class="player">
              <span class="name">${escapeHtml(g.black)}</span>
              <span class="rating">(${g.black_rating})</span>
            </span>
          </div>
          <span class="time-control">${formatTimeControl(g.type)}</span>
          <span class="result ${resultClass}"></span>
        </div>
      </div>
    `;

    wrapper.innerHTML = gameContent;

    // Create analysis controls div
    const analysisControls = document.createElement('div');
    analysisControls.className = 'analysis-controls hidden';
    analysisControls.innerHTML = `
      <div class="depth-control">
        <div class="slider-control">
          <div class="slider-with-value">
            <input type="range" class="styled-slider" min="5" max="25" value="15">
          </div>
          <div class="slider-hints">
            <span>7s</span>
            <span>7 min</span>
          </div>
        </div>
      </div>
      <button class="analyze-arrow">Analyze</button>
    `;

    // Add both to li
    li.appendChild(wrapper);
    li.appendChild(analysisControls);
    li.addEventListener("click", () => {
      // Select this game (highlight) and show analysis controls
      const prev = document.querySelector('#gamesList li.selected');
      const prevControls = document.querySelector('#gamesList .analysis-controls:not(.hidden)');
      
      // Hide previous controls
      if (prevControls) {
        prevControls.classList.add('hidden');
      }
      
      if (prev) {
        prev.classList.remove('selected');
      }
      
      li.classList.add('selected');
      
      // Show this game's analysis controls
      const controls = li.querySelector('.analysis-controls');
      controls.classList.remove('hidden');
      
      // Store PGN on li element
      li.dataset.pgn = g.pgn || '';
      li.dataset.url = g.url || '';
      li.dataset.white = g.white || '';
      li.dataset.black = g.black || '';
      li.dataset.white_rating = g.white_rating || '';
      li.dataset.black_rating = g.black_rating || '';
    });
    // Add click handler for analyze button
    const analyzeButton = analysisControls.querySelector('.analyze-arrow');
    const depthSlider = analysisControls.querySelector('input[type="range"]');
    const depthValue = analysisControls.querySelector('.depth-value');

    // Update depth value display when slider changes
    depthSlider.addEventListener('input', () => {
      depthValue.textContent = depthSlider.value;
    });

    analyzeButton.addEventListener('click', async (e) => {
      e.stopPropagation(); // Prevent triggering li click event
      const depth = parseInt(depthSlider.value, 10);
      await startAnalysis(li.dataset.pgn, li.dataset.url, {
        white_name: li.dataset.white,
        black_name: li.dataset.black,
        white_rating: li.dataset.white_rating,
        black_rating: li.dataset.black_rating
      }, depth);
    });

    container.appendChild(li);
  });
}

// small arrow next to platform select triggers the fetch action
const platformArrow = document.getElementById('platformArrow');
if (platformArrow) {
  platformArrow.addEventListener('click', fetchAndRenderGames);
}

// Clear button and Analyse Current Game features removed per request.

async function startAnalysis(pgn, gameUrl = '', meta = {}, depth = 15) {
  // No progress bar; overlay loader will be shown
  const results = document.getElementById("results");
  const platformEl = document.getElementById('platform');

  // mark as busy and disable controls
  window._analysisBusy = true;
  document.getElementById('username').disabled = true;
  if (platformEl) platformEl.disabled = true;
  const platformArrowBtn = document.getElementById('platformArrow');
  if (platformArrowBtn) platformArrowBtn.disabled = true;
  // show overlay to block clicks
  const overlay = document.getElementById('analysisOverlay');
  if (overlay) { overlay.classList.remove('hidden'); overlay.style.display = 'flex'; }
  try { document.body.classList.add('overlay-active'); } catch (e) {}

  // ensure overlay is on top and browser has a moment to render it before heavy work
  if (overlay) {
    overlay.style.zIndex = '99999';
    overlay.style.pointerEvents = 'auto';
  }
  // yield to browser so overlay becomes visible before analysis starts
  await new Promise(res => setTimeout(res, 40));

  results.classList.add("hidden");

  try {
    // Simulate progress while waiting for the backend (up to 85%)
    const progressFill = document.getElementById('analysisProgressFill');
    const progressLabel = document.getElementById('analysisProgressLabel');
    let progress = 5;
    if (progressFill) progressFill.style.width = progress + '%';
    const progressInterval = setInterval(() => {
      if (progress < 85) {
        progress += Math.random() * 3; // random bump
        if (progress > 85) progress = 85;
        if (progressFill) progressFill.style.width = Math.round(progress) + '%';
        if (progressLabel) progressLabel.textContent = `Analyzing...`;
      }
    }, 350);

    const data = await analyzeGame(pgn, gameUrl, depth);
    clearInterval(progressInterval);
    if (progressFill) progressFill.style.width = '100%';
    if (progressLabel) progressLabel.textContent = 'Finalizing...';

    // Merge client metadata
    if (meta) {
      data.white_name = data.white_name || meta.white_name || data.white_name;
      data.black_name = data.black_name || meta.black_name || data.black_name;
      data.white_rating = data.white_rating || meta.white_rating || (data.white && data.white.rating) || null;
      data.black_rating = data.black_rating || meta.black_rating || (data.black && data.black.rating) || null;
    }

    // Hide the games list and show analysis screen
    const gl = document.getElementById('gamesList');
    if (gl) gl.style.display = 'none';

    // Show analysis screen elements
    const analysisScreen = document.querySelectorAll('.analysis-element');
    analysisScreen.forEach(el => el.classList.remove('hidden'));

    // Show and update results section
    results.classList.remove('hidden');
    renderResults(data);

    // Show board container
    const boardContainer = document.getElementById('boardContainer');
    if (boardContainer) boardContainer.classList.remove('hidden');

    // Initialize board preview from returned fen history and moves meta
    try {
      // persist the original PGN so the board can reference moves if needed
      window._currentPGN = pgn || data.pgn || '';
      initBoardFromAnalysis(data);
    } catch (e) { console.warn('Failed to init board', e); }

    // Render and persist results
    results.classList.remove("hidden");
    renderResults(data);
    try { await saveAnalysis(data); } catch (e) { console.warn('Failed to save analysis to storage', e); }
  } catch (err) {
    alert("Analysis failed: " + err.message);
  } finally {
    // release busy flag and re-enable controls
    window._analysisBusy = false;
    document.getElementById('username').disabled = false;
  if (platformEl) platformEl.disabled = false;
  const platformArrowBtn = document.getElementById('platformArrow');
  if (platformArrowBtn) platformArrowBtn.disabled = false;
    const overlay = document.getElementById('analysisOverlay');
    if (overlay) { overlay.classList.add('hidden'); overlay.style.display = 'none'; }
    try { document.body.classList.remove('overlay-active'); } catch (e) {}
  }
}

function attachMoveListeners() {
  const table = document.getElementById('resultsTable');
  if (!table) return;
  const gameUrl = table.dataset.gameUrl || '';
  const links = table.querySelectorAll('.move-link');
  links.forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const move = a.dataset.move;
      if (!gameUrl) {
        // fallback: open href
        window.open(a.href, '_blank');
        return;
      }
      openGameAtMove(gameUrl, Number(move));
    });
  });
}

// Persist last analysis so popup can restore state when reopened
/*
function saveAnalysis(data) {
  return new Promise((resolve, reject) => {
    try {
      // Include current board state (if present) so popup can restore board on reopen
      const toSave = Object.assign({}, data || {});
      try {
        toSave.board_state = {
          fen_history: window._fenHistory || [],
          fen_index: window._fenIndex || 0,
          pgn: window._currentPGN || ''
        };
      } catch (e) {}
      chrome.storage.local.set({ lastAnalysis: toSave }, () => {
        const err = chrome.runtime.lastError;
        if (err) return reject(err);
        resolve();
      });
    } catch (e) {
      reject(e);
    }
  });
}

function loadSavedAnalysis() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(['lastAnalysis'], result => {
        const found = result.lastAnalysis || null;
        resolve(found);
      });
    } catch (e) {
      resolve(null);
    }
  });
}
*/

// Placeholder functions until we re-enable state saving
function saveAnalysis() {
  return Promise.resolve();
}

function loadSavedAnalysis() {
  return Promise.resolve(null);
}

function renderResults(data) {
  const results = document.getElementById('results');
  if (!results) return;

  // Setup back button functionality
  const backButton = document.getElementById('backToGames');
  if (backButton) {
    backButton.onclick = () => {
      // Hide analysis sections
      document.getElementById('results').classList.add('hidden');
      document.getElementById('gameInfoWrapper').classList.add('hidden');
      document.getElementById('boardContainer').classList.add('hidden');
      document.getElementById('summaryWrapper').classList.add('hidden');
      document.getElementById('moveInfo').classList.add('hidden');
      
      // Clear move type text
      const moveType = document.getElementById('moveType');
      if (moveType) {
        moveType.textContent = '';
        moveType.className = 'move-type';
      }
      
      // Show games list
      const gamesList = document.getElementById('gamesList');
      if (gamesList) {
        gamesList.style.display = 'block';
        // Re-fetch games to ensure list is populated
        fetchAndRenderGames();
      }
      
      // Remove any existing arrows
      const existingArrows = document.querySelectorAll('.move-arrow');
      existingArrows.forEach(arrow => arrow.remove());
    };
  }

  // Show and populate game info
  const gameInfoWrapper = document.getElementById('gameInfoWrapper');
  if (gameInfoWrapper) {
    gameInfoWrapper.classList.remove('hidden');

    // Update player information
    const whitePlayerInfo = document.getElementById('whitePlayerInfo');
    const blackPlayerInfo = document.getElementById('blackPlayerInfo');
    const gameTimeInfo = document.getElementById('gameTimeInfo');

    if (whitePlayerInfo) {
      whitePlayerInfo.textContent = `White: ${data.white_name || data.white || 'Unknown'} (${data.white_rating || '?'})`;
    }
    if (blackPlayerInfo) {
      blackPlayerInfo.textContent = `Black: ${data.black_name || data.black || 'Unknown'} (${data.black_rating || '?'})`;
    }
  }

  // Show the summary table wrapper
  const summaryWrapper = document.getElementById('summaryWrapper');
  if (summaryWrapper) {
    summaryWrapper.classList.remove('hidden');
    summaryWrapper.style.display = 'block';
  }
  // Fill the summary table with counts
  const cats = ['brilliant','great','best','excellent','good','inaccuracy','mistake','blunder'];
  const whiteCounts = (data.white && data.white.counts) || {};
  const blackCounts = (data.black && data.black.counts) || {};
  let whiteTotal = 0, blackTotal = 0;
  cats.forEach(cat => {
    const w = whiteCounts[cat] || 0;
    const b = blackCounts[cat] || 0;
    const wEl = document.getElementById(`white-${cat}`);
    const bEl = document.getElementById(`black-${cat}`);
    if (wEl) wEl.textContent = String(w);
    if (bEl) bEl.textContent = String(b);
    whiteTotal += w;
    blackTotal += b;
  });
  const wTotEl = document.getElementById('white-total');
  const bTotEl = document.getElementById('black-total');
  if (wTotEl) wTotEl.textContent = String(whiteTotal);
  if (bTotEl) bTotEl.textContent = String(blackTotal);

  // Clear button removed

  // Show the summary area and results
  const summaryWrap = document.getElementById('summaryWrapper');
  if (summaryWrap) summaryWrap.classList.remove('hidden');
  results.classList.remove('hidden');
  try { document.body.classList.remove('no-analysis'); document.body.classList.add('has-analysis'); } catch (e) {}
}

// On popup load, always run the intro loader then the splash sequence
document.addEventListener('DOMContentLoaded', async () => {
  // Let the splash sequence fully control logo fade/move to avoid duplicate fades
  try { document.body.classList.add('splash-active'); } catch (e) {}

  // start and await the full splash sequence (continues the choreography)
  try {
    await runSplashSequence();
  } catch (e) {
    // fallback: ensure title visible and button shown
    document.getElementById('splash')?.classList.add('logo-faded-in');
    revealTitleInstant();
    document.getElementById('splashNext')?.classList.add('visible');
  }

  const saved = await loadSavedAnalysis();
  if (saved) {
    const results = document.getElementById('results');
    if (results) results.classList.remove('hidden');
    renderResults(saved);
    // restore board state if available
    try {
      if (saved.board_state && Array.isArray(saved.board_state.fen_history) && saved.board_state.fen_history.length) {
        window._fenHistory = saved.board_state.fen_history || [];
        window._movesMeta = saved.moves_meta || [];
        window._fenIndex = saved.board_state.fen_index || 0;
        window._currentPGN = saved.board_state.pgn || '';
  // show board preview (pass full saved object so labels/game-type populate)
  initBoardFromAnalysis(saved);
        // step to saved index
        try { if (window._updateBoardUI) window._updateBoardUI(); } catch (e) {}
      }
    } catch (e) { /* ignore */ }
    // update sizing classes
    try { document.body.classList.remove('no-analysis'); document.body.classList.add('has-analysis'); } catch (e) {}
  } else {
    try { document.body.classList.add('no-analysis'); document.body.classList.remove('has-analysis'); } catch (e) {}
  }

  // Attempt to auto-fill username from the active chess site tab (best-effort)
  try {
    await autoFillUsernameFromActiveTab();
  } catch (e) { /* ignore */ }
});

// ---- Splash sequencing logic ----
async function runSplashSequence() {
  const splash = document.getElementById('splash');
  const loader = document.getElementById('loaderContainer');
  // mark splash active so CSS can disable scrolling
  try { document.body.classList.add('splash-active'); } catch (e) {}
  if (!splash) return;

  const logo = document.getElementById('splashLogo');
  const titleText = document.getElementById('splashTitleText');
  const welcome = document.getElementById('splashWelcome');
  const tagline = document.getElementById('splashTagline');
  const btn = document.getElementById('splashNext');

  // 1) move logo up (fade handled by keyframes)
  splash.classList.remove('logo-faded-in','logo-moved','title-typing','title-typed','welcome-visible','tagline-visible','continue-visible');
  await delay(80);
  splash.classList.add('logo-moved');
  // wait for logo to settle
  await delay(900);

  // 2) shrink and glide upward (move to top center)
  // Force reflow so the animation will trigger reliably, then add the move class
  void logo.offsetHeight;
  splash.classList.add('logo-moved');
  try {
    if (!logo.style.transition) logo.style.transition = 'transform 900ms ease';
    logo.style.transform = 'translateY(-140px) scale(0.7)';
  } catch (e) {}
  // shorter wait for logo movement
  await delay(600);

  // compute stacked offsets so the typed title + welcome + tagline will sit with 40px gaps beneath the logo
  try {
    // get logo final rect (after animation)
    const logoRect = logo.getBoundingClientRect();
    const splashInner = document.getElementById('splashInner');
    const titleEl = document.getElementById('splashTitle');
    const welcomeEl = document.getElementById('splashWelcome');
    const taglineEl = document.getElementById('splashTagline');
    // fallback gap
    const gap = 40;
    // compute where to place the title: place it so there's `gap` px between bottom of logo and top of title
    const logoBottom = logoRect.top + logoRect.height;
    // measure heights (will be small/zero before typing; we'll approximate using computed font-size)
    const titleHeight = titleEl ? titleEl.getBoundingClientRect().height || 36 : 36;
    // compute stacked offset relative to CSS fallback -140px used in CSS
    // we want title's final top to be logoBottom + gap (in viewport coords). Convert to a translateY relative value by measuring the current title position.
    if (titleEl && splashInner) {
      const splashRect = splashInner.getBoundingClientRect();
      const desiredTitleTop = logoBottom + gap;
      const currentTitleTop = titleEl.getBoundingClientRect().top;
      const offset = desiredTitleTop - currentTitleTop;
      // set CSS variable to shift all stacked elements by this offset (px)
      splashInner.style.setProperty('--stacked-offset', `${offset}px`);
    }
  } catch (e) {
    // if measurement fails, fall back to CSS-only transforms
  }

  // 3) Type 'ChessGod' with typewriter effect in the center, then move it up under the logo
  const name = 'ChessGod';
  titleText.textContent = '';
  titleText.style.width = '0ch';
  titleText.classList.add('typewriter-anim');
  splash.classList.add('title-typing');
  for (let i = 0; i < name.length; i++) {
    titleText.textContent += name[i];
    // progressively increase width to reveal letters (helps with caret feel)
    titleText.style.width = `${i + 1}ch`;
    await delay(40 + (i * 4));
  }
  // finish typing
  splash.classList.add('title-typed');
  await delay(0);

  // Show tagline after typing
  await delay(300);
  splash.classList.add('tagline-visible');
  await delay(600);

  // 4) move title upward to sit neatly under the logo: we'll add a helper class that the CSS respects
  // The logo has moved upward already, so this simply fades and repositions the title
  titleText.parentElement.style.transition = 'transform 250ms ease, opacity 250ms ease';
  titleText.parentElement.style.opacity = '1';
  // Short delay after typing finishes
  await delay(200);
  
  // Show platform circles
  splash.classList.add('platforms-visible');
  
  // Set up platform selection behavior
  const platformCircles = document.querySelectorAll('.platform-circle');
  const inputBox = document.querySelector('.inputBox');
  
  platformCircles.forEach(circle => {
    circle.addEventListener('click', () => {
      // Remove selected class from all circles
      platformCircles.forEach(c => c.classList.remove('selected'));
      // Add selected class to clicked circle
      circle.classList.add('selected');
      // Show input box
      inputBox.classList.remove('hidden');
      inputBox.classList.add('visible');
      
      // Add input event listener for changing text and handle enter key
      const input = inputBox.querySelector('input');
      const label = inputBox.querySelector('span');
      if (input && label) {
        input.addEventListener('input', () => {
          label.textContent = input.value.trim() ? 'Press Enter' : 'Username';
        });
        
        // Handle enter key
        input.addEventListener('keypress', async (e) => {
          if (e.key === 'Enter' && input.value.trim()) {
            const username = input.value.trim();
            const platform = circle.dataset.platform;
            
            try {
              // Try fetching games first to validate username
              let validUsername = false;
              try {
                if (platform === "chesscom") {
                  await fetchChesscomGames(username);
                  validUsername = true;
                } else {
                  await fetchLichessGames(username);
                  validUsername = true;
                }
              } catch (error) {
                // Username is invalid
                inputBox.classList.add("error");
                
                // Add error message if it doesn't exist
                if (!inputBox.querySelector(".error-message")) {
                  const errorMessage = document.createElement("div");
                  errorMessage.className = "error-message";
                  errorMessage.textContent = "Invalid username";
                  inputBox.appendChild(errorMessage);
                }
                return;
              }
              
              if (validUsername) {
                // Clear any error states
                inputBox.classList.remove("error");
                const errorMessage = inputBox.querySelector(".error-message");
                if (errorMessage) {
                  errorMessage.remove();
                }
                
                // Set the values in the main UI before transitioning
                document.getElementById('username').value = username;
                document.getElementById('platform').value = platform;
                // Transition to main UI
                await revealMainUIFromSplash();
                // Fetch games automatically
                await fetchAndRenderGames();
              }
            } catch (error) {
              console.error("Error:", error);
            }
          }
        });
      }
    });
  });
  if (btn) {
    btn.style.opacity = '0';
    splash.classList.add('continue-visible');
    // make button visible for accessibility/fallback
    btn.classList.add('visible');
    btn.style.opacity = '1';
    btn.onclick = async () => { await revealMainUIFromSplash(); };
  }
}

function revealTitleInstant() {
  const titleText = document.getElementById('splashTitleText');
  if (!titleText) return;
  titleText.textContent = 'ChessGod';
}

async function revealMainUIFromSplash() {
  const splash = document.getElementById('splash');
  const mainUI = document.getElementById('mainUI');
  if (!splash || !mainUI) return;
  // animate splash out: fade then hide
  splash.style.transition = 'opacity 320ms ease, transform 420ms ease';
  splash.style.opacity = '0';
  splash.style.transform = 'translateY(-8px) scale(.998)';
  await delay(360);
  splash.style.display = 'none';
  try { document.body.classList.remove('splash-active'); } catch (e) {}

  mainUI.classList.remove('hidden');
  mainUI.classList.add('visible');
  mainUI.setAttribute('aria-hidden','false');
  // Restore saved analysis UI (if present)
  const saved = await loadSavedAnalysis();
  if (saved) {
    const results = document.getElementById('results');
    if (results) results.classList.remove('hidden');
    renderResults(saved);
    try {
      if (saved.board_state && Array.isArray(saved.board_state.fen_history) && saved.board_state.fen_history.length) {
        window._fenHistory = saved.board_state.fen_history || [];
        window._movesMeta = saved.moves_meta || [];
        window._fenIndex = saved.board_state.fen_index || 0;
        window._currentPGN = saved.board_state.pgn || '';
        initBoardFromAnalysis(saved);
        try { if (window._updateBoardUI) window._updateBoardUI(); } catch (e) {}
      }
    } catch (e) { /* ignore */ }
  }
}

function delay(ms) { return new Promise(res => setTimeout(res, ms)); }




// Helper: determine whether to show loader (only once per Chrome session)
// shouldShowLoader removed: pixel loader no longer used.

// Simple pixel-by-pixel intro animation. This is an approximation of the requested effect.
// runIntroLoader removed: pixel loader no longer used.

// Prevent images from being dragged or showing context menu to save
// Setup depth slider value display
function setupDepthSlider() {
  const slider = document.getElementById('depth');
  const value = document.getElementById('depthValue');
  if (!slider || !value) return;

  function updateValue() {
    value.textContent = slider.value;
  }

  slider.addEventListener('input', updateValue);
  // Set initial value
  updateValue();
}

async function startBackend() {
  const overlay = document.getElementById('backendOverlay');
  const progressFill = document.getElementById('backendProgressFill');
  const progressLabel = document.getElementById('backendProgressLabel');
  
  // Show overlay
  if (overlay) { 
    overlay.classList.remove('hidden'); 
    overlay.style.display = 'flex';
  }
  
  try {
    document.body.classList.add('overlay-active');
  } catch (e) {}

  // Start progress simulation
  let progress = 5;
  if (progressFill) progressFill.style.width = progress + '%';
  const progressInterval = setInterval(() => {
    if (progress < 85) {
      progress += Math.random() * 3;
      if (progress > 85) progress = 85;
      if (progressFill) progressFill.style.width = Math.round(progress) + '%';
      if (progressLabel) progressLabel.textContent = 'Starting backend...';
    }
  }, 350);

  try {
    // Try to connect to backend every second until successful
    let connected = false;
    while (!connected) {
      try {
        const response = await fetch('http://localhost:8000');
        if (response.ok) {
          connected = true;
          clearInterval(progressInterval);
          if (progressFill) progressFill.style.width = '100%';
          if (progressLabel) progressLabel.textContent = 'Backend started!';
          
          // Wait a moment to show the success message
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Hide overlay
          if (overlay) {
            overlay.classList.add('hidden');
            overlay.style.display = 'none';
          }
          document.body.classList.remove('overlay-active');
          return;
        }
      } catch (e) {
        // Not connected yet, try again in a second
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  } catch (err) {
    alert("Failed to start backend: " + err.message);
  } finally {
    clearInterval(progressInterval);
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.style.display = 'none';
    }
    document.body.classList.remove('overlay-active');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupDepthSlider();
  
  // Add start backend button handler
  const startBackendBtn = document.getElementById('startBackendButton');
  if (startBackendBtn) {
    startBackendBtn.addEventListener('click', () => {
      // Use chrome.runtime.sendMessage to send a message to the background script
      chrome.runtime.sendMessage({ action: "startBackend" });
      // Start showing the loading UI
      startBackend();
    });
  }
  
  document.addEventListener('dragstart', e => {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  });
  document.addEventListener('contextmenu', e => {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  });
  // Input filled state: keep label up when input has text and change label text
  const username = document.getElementById('username');
  const formControl = username && username.closest('.form-control');
  function updateFilled() {
    if (!formControl || !username) return;
    const label = formControl.querySelector('label span');
    const spanText = formControl.querySelector('label');
    if (username.value && username.value.trim().length > 0) {
      formControl.classList.add('filled');
      if (spanText) spanText.innerHTML = '<span style="transition-delay:0ms">P</span><span style="transition-delay:50ms">r</span><span style="transition-delay:100ms">e</span><span style="transition-delay:150ms">s</span><span style="transition-delay:200ms">s</span><span style="transition-delay:250ms"> </span><span style="transition-delay:300ms">E</span><span style="transition-delay:350ms">n</span><span style="transition-delay:400ms">t</span><span style="transition-delay:450ms">e</span><span style="transition-delay:500ms">r</span>';
    } else {
      formControl.classList.remove('filled');
      if (spanText) spanText.innerHTML = '<span style="transition-delay:0ms">U</span><span style="transition-delay:50ms">s</span><span style="transition-delay:100ms">e</span><span style="transition-delay:150ms">r</span><span style="transition-delay:200ms">n</span><span style="transition-delay:250ms">a</span><span style="transition-delay:300ms">m</span><span style="transition-delay:350ms">e</span>';
    }
  }
  if (username) {
    username.addEventListener('input', updateFilled);
    username.addEventListener('blur', updateFilled);
    // Add enter key handler
    username.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter' && username.value.trim()) {
        await fetchAndRenderGames();
      }
    });
    // initial state
    setTimeout(updateFilled, 10);
  }
});

function formatTimeControl(type) {
  if (!type) return '5 min';
  type = type.toLowerCase();
  
  // Convert game types to timing format
  const timeMap = {
    'bullet': '1 min',
    'blitz': '3+2',
    'rapid': '10 min',
    'classical': '30 min'
  };

  // Check if it's already in time format (e.g. "10+0")
  if (/^\d+\+\d+$/.test(type)) {
    return type + ' min';
  }

  // Return mapped time or original if not found
  return timeMap[type] || type;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Open the game URL in a new tab and attempt to jump to the requested move by
// injecting a small script into the game page. This is best-effort and uses
// heuristics to find clickable move elements.
function openGameAtMove(gameUrl, moveNumber) {
  // Build deterministic deep-links for known sites
  try {
    const u = new URL(gameUrl);
    const host = u.hostname.toLowerCase();
    let target = gameUrl;

    if (host.includes('chess.com')) {
      // chess.com expects ?move=N (or &move= if query exists)
      const sep = u.search ? '&' : '?';
      target = `${gameUrl}${sep}move=${moveNumber}`;
    } else if (host.includes('lichess.org')) {
      // lichess uses fragment '#N'
      // If there's already a fragment, replace it
      target = gameUrl.split('#')[0] + `#${moveNumber}`;
    } else {
      // fallback: use fragment with move label
      target = gameUrl.split('#')[0] + `#move-${moveNumber}`;
    }

    window.open(target, '_blank');
  } catch (e) {
    // If URL parsing failed, just open fallback
    window.open(gameUrl + `#move-${moveNumber}`, '_blank');
  }
}

// Small inline SVG placeholders for icons. Replace these with chess.com icons if provided.


function moveTypeSvg(type) {
  const t = (type || '').toLowerCase();
  const map = {
    'brilliant': 'icons/brilliant.png',
    'great': 'icons/great.png',
    'best': 'icons/best.png',
    'excellent': 'icons/excellent.png',
    'good': 'icons/good.png',
    'inaccuracy': 'icons/inaccuracy.png',
    'mistake': 'icons/mistake.png',
    'blunder': 'icons/blunder.png',
    
  };
  const path = map[t];
  if (path) return `<img src="${path}" class="move-icon"/>`;
  // fallback inline small circle
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="#cfd8dc"><circle cx="12" cy="12" r="6"/></svg>`;
}

// ------------ New UI integration: Analyze Selected + board controls ------------
// Analyze button wiring
const analyzeSelectedBtn = document.getElementById('analyzeSelected');
if (analyzeSelectedBtn) {
  // start disabled until a selection occurs
  analyzeSelectedBtn.disabled = true;
  analyzeSelectedBtn.addEventListener('click', async () => {
    const pgn = analyzeSelectedBtn.dataset.pgn;
    const url = analyzeSelectedBtn.dataset.url || '';
    if (!pgn) return;
    // hide games list and analyze action while running
    const gamesList = document.getElementById('gamesList');
    if (gamesList) gamesList.innerHTML = '';
    const aa = document.getElementById('analyzeAction'); if (aa) aa.classList.add('hidden');
    // ensure button is disabled during analysis
    analyzeSelectedBtn.disabled = true;
    await startAnalysis(pgn, url, { white_name: analyzeSelectedBtn.dataset.white, black_name: analyzeSelectedBtn.dataset.black, white_rating: analyzeSelectedBtn.dataset.white_rating, black_rating: analyzeSelectedBtn.dataset.black_rating });
  });
}

// Minimal board renderer (no external libs) - uses FEN to draw pieces in a simple grid
function getGameEndText(pgn) {
  // Extract result and termination from PGN
  const resultMatch = pgn.match(/\[Result "(.+?)"\]/i);
  const terminationMatch = pgn.match(/\[Termination "(.+?)"\]/i);
  
  if (!resultMatch) return '';
  
  const result = resultMatch[1];
  const termination = terminationMatch ? terminationMatch[1] : '';
  
  if (result === '1-0') {
    if (termination.toLowerCase().includes('checkmate')) return 'White won by Checkmate';
    if (termination.toLowerCase().includes('resignation')) return 'White won by Resignation';
    if (termination.toLowerCase().includes('time')) return 'White won on Time';
    if (termination.toLowerCase().includes('abandon')) return 'White won by Abandonment';
    return 'White won';
  } else if (result === '0-1') {
    if (termination.toLowerCase().includes('checkmate')) return 'Black won by Checkmate';
    if (termination.toLowerCase().includes('resignation')) return 'Black won by Resignation';
    if (termination.toLowerCase().includes('time')) return 'Black won on Time';
    if (termination.toLowerCase().includes('abandon')) return 'Black won by Abandonment';
    return 'Black won';
  } else if (result === '1/2-1/2') {
    if (termination.toLowerCase().includes('stalemate')) return 'Game drawn by Stalemate';
    if (termination.toLowerCase().includes('repetition')) return 'Game drawn by Repetition';
    if (termination.toLowerCase().includes('insufficient')) return 'Game drawn by Insufficient Material';
    if (termination.toLowerCase().includes('agreement')) return 'Game drawn by Agreement';
    if (termination.toLowerCase().includes('time')) return 'Game drawn by Time vs Insufficient Material';
    return 'Game drawn';
  }
  return '';
}

function renderBoardFromFEN(fen) {
  const container = document.getElementById('chessboard');
  if (!container) return;
  // preserve existing overlay SVG (if present) and replace only the mini-board
  const existingOverlay = document.getElementById('boardOverlay');
  // remove previous mini-board(s) but keep overlay/defs
  Array.from(container.querySelectorAll('.mini-board')).forEach(n => n.remove());
  const boardEl = document.createElement('div');
  boardEl.className = 'mini-board';
  boardEl.style.display = 'grid';
  boardEl.style.gridTemplateColumns = 'repeat(8, 1fr)';
  boardEl.style.gridTemplateRows = 'repeat(8, 1fr)';
  boardEl.style.width = '420px';
  boardEl.style.height = '420px';
  boardEl.style.borderRadius = '6px';
  boardEl.style.overflow = 'hidden';

  // parse fen
  const parts = fen.split(' ');
  const rows = parts[0].split('/');
  // Lichess-style: rows are from rank 8 (top) to rank 1 (bottom) in FEN
  for (let r = 0; r < 8; r++) {
    const row = rows[r];
    let file = 0;
    for (let ch of row) {
      if (/[1-8]/.test(ch)) {
        const n = parseInt(ch, 10);
        for (let k = 0; k < n; k++) {
          const sq = document.createElement('div');
          sq.className = 'sq ' + ((((r + file) % 2) === 0) ? 'light' : 'dark');
          // Provide coordinate data attribute (a8..h1) for future features
          const coordFile = String.fromCharCode('a'.charCodeAt(0) + file);
          const coordRank = 8 - r;
          sq.dataset.coord = coordFile + String(coordRank);
          boardEl.appendChild(sq);
          file++;
        }
      } else {
        const sq = document.createElement('div');
        sq.className = 'sq ' + ((((r + file) % 2) === 0) ? 'light' : 'dark');
        // use background-image on the square to avoid intrinsic SVG viewBox offsets
        const map = {
          'K': 'wK','Q':'wQ','R':'wR','B':'wB','N':'wN','P':'wP',
          'k': 'bK','q':'bQ','r':'bR','b':'bB','n':'bN','p':'bP'
        };
        const fname = map[ch] || null;
        if (fname) {
          const svgUrl = `https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/${fname}.svg`;
          sq.style.backgroundImage = `url('${svgUrl}')`;
          sq.classList.add('has-piece');
          sq.dataset.piece = fname;
        }
        boardEl.appendChild(sq);
        // set coordinate data attribute
        const coordFile = String.fromCharCode('a'.charCodeAt(0) + file);
        const coordRank = 8 - r;
        sq.dataset.coord = coordFile + String(coordRank);
        boardEl.appendChild(sq);
        file++;
      }
    }
  }
  // ensure overlay stays on top: insert board before overlay if overlay exists
  if (existingOverlay) container.insertBefore(boardEl, existingOverlay);
  else container.appendChild(boardEl);
}

// piece images are used instead of Unicode glyphs

// state for board stepping
window._fenHistory = [];
window._movesMeta = [];
window._fenIndex = 0;

function setupBoardControls() {
  const prev = document.getElementById('prevMove');
  const next = document.getElementById('nextMove');
  const moveType = document.getElementById('moveType');

    function updateUI() {
    const idx = window._fenIndex;
    const fen = window._fenHistory[idx];
    renderBoardFromFEN(fen);
    const meta = window._movesMeta.find(m => m.ply_index === idx) || null;

    // Find the previous position's metadata to show what the best move was
    const prevMeta = idx > 0 ? window._movesMeta.find(m => m.ply_index === idx - 1) : null;
    
    // Clear any existing arrows
    const existingArrows = document.querySelectorAll('.move-arrow');
    existingArrows.forEach(arrow => arrow.remove());
    
    // Draw arrows based on the previous position's metadata
    if (prevMeta) {
      // Always show the played move arrow in orange
      if (prevMeta.played_uci && prevMeta.played_uci.length >= 4) {
        const playedFromSquare = prevMeta.played_uci.slice(0, 2);
        const playedToSquare = prevMeta.played_uci.slice(2, 4);
        drawMoveArrow(playedFromSquare, playedToSquare, 'actual-move');
      }
      
      // Always show the best move arrow if it exists
      if (prevMeta.best_uci && prevMeta.best_uci.length >= 4) {
        const bestFromSquare = prevMeta.best_uci.slice(0, 2);
        const bestToSquare = prevMeta.best_uci.slice(2, 4);
        drawMoveArrow(bestFromSquare, bestToSquare, 'best-move');
      }
    }    // Handle move type display
    if (moveType) {
      if (idx === window._fenHistory.length - 1) {
        // Last position - show game result
        const resultText = getGameEndText(window._currentPGN || '');
        moveType.textContent = resultText;
        moveType.classList.add('result');
      } else if (meta) {
        // Regular move - show category with icon
        moveType.classList.remove('result');
        moveType.innerHTML = `${moveTypeSvg(meta.category)} <span style="margin-left:8px; vertical-align:middle;">${(meta.category || '').toUpperCase()}</span>`;
      } else {
        moveType.textContent = '';
        moveType.classList.remove('result');
      }
    }
    if (prev) prev.disabled = idx <= 0;
    if (next) next.disabled = idx >= (window._fenHistory.length - 1);
    // Clear previous highlights and apply new highlights for the last-played move (the move that led to the displayed FEN)
    try {
      // Remove any existing highlight classes
      document.querySelectorAll('.mini-board .sq.highlight-from, .mini-board .sq.highlight-to').forEach(el => {
        el.classList.remove('highlight-from');
        el.classList.remove('highlight-to');
      });
      // Determine the move that produced the current FEN: moves_meta.ply_index records the
      // position BEFORE the move, so the move that produced fen_history[idx] has ply_index === idx - 1.
      let playedUci = null;
      if (idx > 0) {
        const playedMeta = (window._movesMeta || []).find(m => m.ply_index === (idx - 1)) || null;
        if (playedMeta && playedMeta.played_uci) playedUci = playedMeta.played_uci;
      }
      // Fallback: if we couldn't find the played move, fall back to meta.played_uci (move to play from this position)
      if (!playedUci && meta) playedUci = meta.played_uci || meta.best_uci || null;
      if (playedUci && playedUci.length >= 4) {
        const from = playedUci.slice(0,2);
        const to = playedUci.slice(2,4);
        const fromEl = document.querySelector(`.mini-board .sq[data-coord="${from}"]`);
        const toEl = document.querySelector(`.mini-board .sq[data-coord="${to}"]`);
        if (fromEl) fromEl.classList.add('highlight-from');
        if (toEl) toEl.classList.add('highlight-to');
      }
    } catch (e) {
      // non-fatal if DOM queries fail
    }
  }

  // expose for external calls
  window._updateBoardUI = updateUI;

  // Use onclick with a small guard to prevent double-processing (some environments fire multiple handlers)
  let navLock = false;
  if (prev) prev.onclick = () => {
    if (navLock) return;
    navLock = true;
    try { if (window._fenIndex > 0) { window._fenIndex = window._fenIndex - 1; updateUI(); } } finally { setTimeout(() => { navLock = false; }, 80); }
  };
  if (next) next.onclick = () => {
    if (navLock) return;
    navLock = true;
    try { if (window._fenIndex < window._fenHistory.length - 1) { window._fenIndex = window._fenIndex + 1; updateUI(); } } finally { setTimeout(() => { navLock = false; }, 80); }
  };
  // Keyboard navigation: left/right arrow keys control prev/next
  document.removeEventListener('keydown', window._boardKeyHandler || (()=>{}));
  window._boardKeyHandler = (e) => {
    if (!document.getElementById('boardContainer') || document.getElementById('boardContainer').classList.contains('hidden')) return;
    if (e.key === 'ArrowLeft') {
      // emulate prev click
      if (navLock) return;
      navLock = true;
      try { if (window._fenIndex > 0) { window._fenIndex = window._fenIndex - 1; updateUI(); } } finally { setTimeout(() => { navLock = false; }, 80); }
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      if (navLock) return;
      navLock = true;
      try { if (window._fenIndex < window._fenHistory.length - 1) { window._fenIndex = window._fenIndex + 1; updateUI(); } } finally { setTimeout(() => { navLock = false; }, 80); }
      e.preventDefault();
    }
  };
  document.addEventListener('keydown', window._boardKeyHandler);
}

// expose update function so init can call it and tests can trigger UI refresh
window._updateBoardUI = null;

// Arrow rendering utilities
const SVG_NS = 'http://www.w3.org/2000/svg';

function createArrowElement(from, to, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('move-arrow');
  if (className) svg.classList.add(className);
  
  // Set viewBox and size
  svg.setAttribute('viewBox', '0 0 420 420');
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.pointerEvents = 'none';
  
  // Create path for arrow shaft and head
  const path = document.createElementNS(SVG_NS, 'path');
  
  // Calculate positions
  const startX = (from.x + 0.5) * (420/8);
  const startY = (from.y + 0.5) * (420/8);
  const endX = (to.x + 0.5) * (420/8);
  const endY = (to.y + 0.5) * (420/8);
  
  // Calculate arrow head points
  const angle = Math.atan2(endY - startY, endX - startX);
  const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
  const headLength = 25; // Length of arrow head
  const headWidth = 15; // Width of arrow head
  
  // Adjust end point to accommodate arrow head
  const adjustedEndX = startX + (length - headLength) * Math.cos(angle);
  const adjustedEndY = startY + (length - headLength) * Math.sin(angle);
  
  // Create path data
  const pathData = `
    M ${startX} ${startY}
    L ${adjustedEndX} ${adjustedEndY}
    L ${endX} ${endY}
    l ${-headLength * Math.cos(angle - Math.PI/6)} ${-headLength * Math.sin(angle - Math.PI/6)}
    M ${endX} ${endY}
    l ${-headLength * Math.cos(angle + Math.PI/6)} ${-headLength * Math.sin(angle + Math.PI/6)}
  `;
  
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  
  return svg;
}

function drawMoveArrow(fromCoord, toCoord, type = 'best-move') {
  // Convert algebraic coordinates to x,y coordinates (0-7)
  const fromFile = fromCoord.charCodeAt(0) - 'a'.charCodeAt(0);
  const fromRank = 8 - parseInt(fromCoord[1]);
  const toFile = toCoord.charCodeAt(0) - 'a'.charCodeAt(0);
  const toRank = 8 - parseInt(toCoord[1]);
  
  // Create container for arrows if it doesn't exist
  let arrowContainer = document.querySelector('.arrow-container');
  if (!arrowContainer) {
    arrowContainer = document.createElement('div');
    arrowContainer.className = 'arrow-container';
    const chessboard = document.getElementById('chessboard');
    if (chessboard) chessboard.appendChild(arrowContainer);
  }
  
  // Create and append the arrow
  const arrow = createArrowElement(
    { x: fromFile, y: fromRank },
    { x: toFile, y: toRank },
    type
  );
  arrowContainer.appendChild(arrow);
}

// Call this after analysis completes to initialize board and controls
function initBoardFromAnalysis(result) {
  window._fenHistory = (result.fen_history || []);
  window._movesMeta = (result.moves_meta || []);
  window._fenIndex = 0;
  if ((window._fenHistory || []).length) {
    const bc = document.getElementById('boardContainer');
    if (bc) bc.classList.remove('hidden');
    setupBoardControls();
    // render initial position
    const firstFen = window._fenHistory[0];
    renderBoardFromFEN(firstFen);
    // update move info
  const moveType = document.getElementById('moveType');
  if (moveType) moveType.textContent = '';
    // populate player labels if available
    try {
      const blackLabel = document.getElementById('boardBlackPlayer');
      const whiteLabel = document.getElementById('boardWhitePlayer');
      const gameTypeEl = document.getElementById('boardGameType');
      if (blackLabel) blackLabel.textContent = `${result.black_name || result.black || ''}${result.black_rating ? ' ('+result.black_rating+')' : ''}`;
      if (whiteLabel) whiteLabel.textContent = `${result.white_name || result.white || ''}${result.white_rating ? ' ('+result.white_rating+')' : ''}`;
      if (gameTypeEl) gameTypeEl.textContent = (result.type || result.time_class || result.speed || '') ;
    } catch (e) {}
    // ensure the full UI state is consistent (buttons, arrow, etc.)
    try { if (window._updateBoardUI) window._updateBoardUI(); } catch (e) {}
  }
}

