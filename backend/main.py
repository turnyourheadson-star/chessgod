from fastapi import FastAPI, UploadFile, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from analysis.analyzer import analyze_game
import chess.pgn
import io

app = FastAPI()

# Allow requests from the extension and localhost development
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "chrome-extension://*"  # Allow any Chrome extension
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST"],  # Only allow necessary methods
    allow_headers=["*"]
)

@app.get("/")
def root():
    return {"message": "Chess Analyzer Backend running"}

@app.post("/analyze")
async def analyze(file: UploadFile, url: str | None = Form(None), depth: str | None = Form(None), multipv: str | None = Form(None)):
    """Receive PGN and optional game URL, run Stockfish analysis, return JSON.
    depth parameter controls Stockfish search depth (default: 15, min: 5, max: 25)."""
    pgn_text = (await file.read()).decode("utf-8")
    # Convert depth to int, as Form data comes as string
    depth_int = int(depth) if depth is not None else 15
    depth_int = max(5, min(25, depth_int))  # Clamp to valid range
    multipv_int = int(multipv) if multipv is not None else 1
    result = analyze_game(pgn_text, depth=depth_int, multipv=multipv_int)

    # Try to extract player names from PGN tags
    try:
        game = chess.pgn.read_game(io.StringIO(pgn_text))
        white = game.headers.get('White', '') if game else ''
        black = game.headers.get('Black', '') if game else ''
    except Exception:
        white = ''
        black = ''

    # result may now include 'fen_history' and 'moves_meta'
    response = {
        "white_name": white,
        "black_name": black,
        "game_url": url or "",
        **result,
    }
    return JSONResponse(content=response)
