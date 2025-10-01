#!/usr/bin/env python3
"""
Advanced calibrator for chess move classification thresholds.

This script calibrates centipawn-loss thresholds for move categories by:
1. Analyzing a set of reference games with Stockfish
2. Computing statistical measures of CP losses
3. Using machine learning techniques to find optimal thresholds
4. Validating results against known good/bad moves

The calibration can use two modes:
1. Reference JSON with pre-labeled moves (fast)
2. Full game analysis with Stockfish (thorough)

Usage:
  python calibrate_thresholds.py [--mode reference|analysis] input_file

For reference mode: input_file should be JSON with move objects:
  [{"cp_loss": 42, "ref_category": "inaccuracy"}, ...]
  
For analysis mode: input_file should be a PGN file with games to analyze.

The script uses statistical analysis and cross-validation to ensure robust
threshold values that work well across different playing strengths and styles.
"""
import json
import sys
import chess
import chess.pgn
import chess.engine
import logging
import statistics
import random
from pathlib import Path
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# All possible move categories in order of quality
CATS = ["brilliant", "great", "best", "excellent", "good", "inaccuracy", "mistake", "blunder"]

# Initial threshold guesses (will be optimized)
INITIAL_THRESHOLDS = {
    'brilliant': -50,  # Sacrifice that works out
    'great': 0,       # Perfect moves
    'best': 5,        # Among top engine choices
    'excellent': 15,  # Very good moves
    'good': 50,       # Solid moves
    'inaccuracy': 100,# Small mistakes
    'mistake': 200,   # Significant mistakes
    'blunder': 400    # Game-changing errors
}

def map_category(cp_loss: float, thresholds: Dict[str, float], 
                position_features: Optional[Dict] = None) -> str:
    """
    Map a centipawn loss to a move category using thresholds and position features.
    
    Args:
        cp_loss: Centipawn loss from the move
        thresholds: Dictionary of category thresholds
        position_features: Optional dict of position features (complexity, etc.)
    
    Returns:
        Category string from CATS list
    """
    # Special case: Brilliant moves often involve temporary material sacrifice
    if position_features and position_features.get('material_sacrificed'):
        if cp_loss <= thresholds['brilliant']:
            return 'brilliant'
    
    # Standard threshold mapping
    if cp_loss <= 0:
        return 'best' if cp_loss == 0 else 'great'
        
    for cat in ['excellent', 'good', 'inaccuracy', 'mistake']:
        if cp_loss <= thresholds[cat]:
            return cat
            
    return 'blunder'


def score_thresholds(data, thresholds):
    mismatches = 0
    total = 0
    for item in data:
        cp = item.get('cp_loss')
        ref = item.get('ref_category')
        if cp is None or ref is None:
            continue
        pred = map_category(cp, thresholds)
        if pred != ref:
            mismatches += 1
        total += 1
    return mismatches, total


def analyze_position(engine: chess.engine.SimpleEngine, board: chess.Board, 
                    depth: int = 18) -> Tuple[float, List[str], Dict]:
    """
    Analyze a position with Stockfish and extract relevant features.
    
    Returns:
        Tuple of (evaluation, best_moves, position_features)
    """
    try:
        # Get deep analysis
        info = engine.analyse(
            board,
            chess.engine.Limit(depth=depth),
            multipv=3,
            info=chess.engine.INFO_SCORE | chess.engine.INFO_PV
        )
        
        # Extract evaluation
        score = info[0]["score"].relative.score()
        if score is None:  # Handle mate scores
            score = 10000 if info[0]["score"].relative.is_mate() else -10000
            
        # Get best moves
        best_moves = [line["pv"][0].uci() for line in info if "pv" in line]
        
        # Calculate position features
        features = {
            'material_count': len(board.piece_map()),
            'material_sacrificed': False,  # Set by move analysis
            'position_complexity': len(info[0].get("pv", [])),
            'attacking_possibilities': sum(1 for _ in board.legal_moves),
        }
        
        return score, best_moves, features
        
    except Exception as e:
        logger.error(f"Engine analysis failed: {e}")
        return 0, [], {}

def find_best_thresholds(data: List[Dict], folds: int = 5) -> Dict[str, float]:
    """
    Find optimal thresholds using cross-validation and grid search.
    
    Args:
        data: List of move data with cp_loss and ref_category
        folds: Number of cross-validation folds
        
    Returns:
        Dictionary of optimized thresholds
    """
    best_accuracy = 0
    best_thresholds = INITIAL_THRESHOLDS.copy()
    
    # Extract features for grid search
    cp_losses = [x['cp_loss'] for x in data if 'cp_loss' in x]
    if not cp_losses:
        return best_thresholds
        
    # Calculate statistics for search ranges
    stats = {
        'mean': statistics.mean(cp_losses),
        'stdev': statistics.stdev(cp_losses) if len(cp_losses) > 1 else 100,
        'median': statistics.median(cp_losses),
        'q1': statistics.quantiles(cp_losses, n=4)[0],
        'q3': statistics.quantiles(cp_losses, n=4)[2]
    }
    
    # Grid search with adaptive ranges
    ranges = {
        'brilliant': (-100, 0, 10),
        'excellent': (0, stats['q1'], 5),
        'good': (stats['q1'], stats['median'], 10),
        'inaccuracy': (stats['median'], stats['q3'], 15),
        'mistake': (stats['q3'], stats['mean'] + 2*stats['stdev'], 25)
    }
    
    # Try different threshold combinations
    for b in range(*ranges['brilliant']):
        for e in range(*ranges['excellent']):
            for g in range(*ranges['good']):
                for i in range(*ranges['inaccuracy']):
                    for m in range(*ranges['mistake']):
                        thresholds = {
                            'brilliant': b,
                            'excellent': e,
                            'good': g,
                            'inaccuracy': i,
                            'mistake': m,
                            'blunder': m + 100  # Fixed offset for blunders
                        }
                        
                        # Simple validation scoring
                        # Randomly split data into train/test sets
                        n = len(data)
                        test_size = n // folds
                        accuracies = []
                        
                        for _ in range(folds):
                            # Random sampling for validation
                            test_indices = random.sample(range(n), test_size)
                            test_data = [data[i] for i in test_indices]
                            
                            mismatches, total = score_thresholds(test_data, thresholds)
                            if total > 0:
                                accuracies.append(1 - mismatches/total)
                                
                        if accuracies:
                            avg_accuracy = sum(accuracies) / len(accuracies)
                            if avg_accuracy > best_accuracy:
                                best_accuracy = avg_accuracy
                                best_thresholds = thresholds.copy()
    
    logger.info(f"Found best thresholds with {best_accuracy:.2%} accuracy")
    return best_thresholds

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Calibrate move classification thresholds")
    parser.add_argument("input_file", help="Input file (PGN or JSON)")
    parser.add_argument("--mode", choices=['reference', 'analysis'], 
                      default='reference', help="Calibration mode")
    parser.add_argument("--depth", type=int, default=18,
                      help="Analysis depth for PGN mode")
    args = parser.parse_args()
    
    try:
        if args.mode == 'reference':
            with open(args.input_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
        else:
            # Analyze games mode
            from analysis.analyzer import get_stockfish_path
            engine_path = get_stockfish_path()
            if not engine_path:
                logger.error("Stockfish engine not found")
                sys.exit(1)
                
            engine = chess.engine.SimpleEngine.popen_uci(engine_path)
            try:
                data = []
                with open(args.input_file) as pgn:
                    while True:
                        game = chess.pgn.read_game(pgn)
                        if game is None:
                            break
                            
                        board = game.board()
                        for move in game.mainline_moves():
                            if board.fullmove_number < 5:  # Skip early moves
                                board.push(move)
                                continue
                                
                            score_before, best_moves, features = analyze_position(
                                engine, board, args.depth)
                            
                            board.push(move)
                            score_after, _, _ = analyze_position(engine, board, args.depth)
                            
                            cp_loss = score_before - (-score_after)
                            data.append({
                                'cp_loss': cp_loss,
                                'features': features
                            })
                            
            finally:
                engine.quit()
                
        # Find and save optimal thresholds
        thresholds = find_best_thresholds(data)
        print("\nCalibrated Thresholds:")
        print(json.dumps(thresholds, indent=2))
        
        output_file = "thresholds.json"
        with open(output_file, 'w') as f:
            json.dump(thresholds, indent=2, fp=f)
        print(f"\nThresholds saved to {output_file}")
        
    except Exception as e:
        logger.error(f"Calibration failed: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
