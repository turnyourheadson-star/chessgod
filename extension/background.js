// Service worker for ChessGod extension
// Handles message passing, native messaging with Stockfish, and browser events

const BACKEND_URL = 'https://chessgod-backend-wa2i.onrender.com';
const LOCAL_BACKEND = 'http://localhost:8000';

// Native messaging host name for Stockfish
const STOCKFISH_HOST = "com.chessgod.stockfish";

let activeTabId = null;
let nativePort = null;
let isLocalMode = false;

// Initialize connection to native messaging host
function connectToNativeHost() {
    try {
        nativePort = chrome.runtime.connectNative(STOCKFISH_HOST);
        console.log("Connected to native messaging host");
        
        nativePort.onMessage.addListener((message) => {
            console.log("Received from native host:", message);
            if (activeTabId) {
                chrome.tabs.sendMessage(activeTabId, {
                    type: 'stockfish_output',
                    data: message
                });
            }
        });

        nativePort.onDisconnect.addListener(() => {
            console.error("Disconnected from native host:", chrome.runtime.lastError);
            nativePort = null;
        });

        return true;
    } catch (error) {
        console.error("Failed to connect to native host:", error);
        return false;
    }
}

// Handle local/remote backend switching
async function toggleBackendMode(useLocal) {
    isLocalMode = useLocal;
    const url = isLocalMode ? LOCAL_BACKEND : BACKEND_URL;
    
    try {
        const response = await fetch(`${url}/health`);
        if (!response.ok) throw new Error(`Backend health check failed: ${response.status}`);
        return { success: true, mode: isLocalMode ? 'local' : 'remote' };
    } catch (error) {
        console.error('Backend health check failed:', error);
        return { success: false, error: error.message };
    }
}

// Handle fetching game data from Chess.com or Lichess
async function fetchGameData(platform, username) {
    const url = isLocalMode ? LOCAL_BACKEND : BACKEND_URL;
    try {
        const response = await fetch(`${url}/games/${platform}/${username}`);
        if (!response.ok) throw new Error(`Failed to fetch games: ${response.status}`);
        const data = await response.json();
        return { success: true, games: data };
    } catch (error) {
        console.error('Game fetch failed:', error);
        return { success: false, error: error.message };
    }
}

// Handle game analysis requests
async function analyzeGame(gameId, platform, pgn, options = {}) {
    const url = isLocalMode ? LOCAL_BACKEND : BACKEND_URL;
    try {
        const response = await fetch(`${url}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: gameId,
                platform,
                pgn,
                options: {
                    depth: options.depth || 18,
                    multipv: options.multipv || 3,
                    threads: options.threads || 4,
                    hash: options.hash || 128,
                    use_nnue: options.useNNUE !== false,
                    ...options
                }
            })
        });
        
        if (!response.ok) throw new Error(`Analysis failed: ${response.status}`);
        return { success: true, data: await response.json() };
    } catch (error) {
        console.error('Analysis failed:', error);
        return { success: false, error: error.message };
    }
}

// Message handling from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Track active tab for stockfish communication
    if (sender.tab) activeTabId = sender.tab.id;
    
    switch (message.type) {
        case 'toggle_backend':
            toggleBackendMode(message.useLocal)
                .then(sendResponse);
            return true;
            
        case 'fetch_games':
            fetchGameData(message.platform, message.username)
                .then(sendResponse);
            return true;
            
        case 'analyze_game':
            analyzeGame(message.gameId, message.platform, message.pgn, message.options)
                .then(sendResponse);
            return true;
            
        case 'connect_stockfish':
            const success = connectToNativeHost();
            sendResponse({ success });
            return false;
            
        case 'stockfish_command':
            if (nativePort) {
                try {
                    nativePort.postMessage(message.command);
                    sendResponse({ success: true });
                } catch (error) {
                    console.error('Failed to send command to Stockfish:', error);
                    sendResponse({ success: false, error: error.message });
                }
            } else {
                sendResponse({ success: false, error: 'Not connected to Stockfish' });
            }
            return false;
    }
});

// Handle extension installation/update
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // First time installation
        chrome.tabs.create({
            url: chrome.runtime.getURL('welcome.html')
        });
    } else if (details.reason === 'update') {
        // Extension updated - check for breaking changes
        const currentVersion = chrome.runtime.getManifest().version;
        const previousVersion = details.previousVersion;
        
        // Major version change - show update notes
        if (currentVersion.split('.')[0] > previousVersion.split('.')[0]) {
            chrome.tabs.create({
                url: chrome.runtime.getURL('update.html')
            });
        }
    }
});

// Clean up native port on unload
window.addEventListener('unload', () => {
    if (nativePort) {
        nativePort.disconnect();
    }
});
