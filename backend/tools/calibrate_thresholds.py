#!/usr/bin/env python3
"""
Simple calibrator to fit centipawn-loss thresholds to a reference labeling.

Usage:
  python calibrate_thresholds.py reference.json

The reference JSON should be an array of move objects like:
  [{"cp_loss": 42, "ref_category": "inaccuracy"}, ...]

This script performs a small grid search over plausible threshold ranges and
prints the best matching thresholds (minimizing category mismatches).

Note: This is a helper for tuning; reproducing the exact analysis of Lichess
or Chess.com also depends on engine binary/version, engine options, tablebases,
and exact evaluation timing. Use this to adjust `THRESHOLDS_CP` in the
analyzer once you have reference-labeled moves.
"""
import json
import sys
from collections import Counter

CATS = ["brilliant","great","best","excellent","good","inaccuracy","mistake","blunder"]


def map_category(cp_loss, thresholds):
    # thresholds: dict with keys 'great','excellent','good','inaccuracy','mistake'
    if cp_loss == 0:
        # We cannot detect 'best' vs 'great' without is_best flag; assume 'best' is rare.
        return 'great'
    if cp_loss <= thresholds['great']:
        return 'great'
    if cp_loss <= thresholds['excellent']:
        return 'excellent'
    if cp_loss <= thresholds['good']:
        return 'good'
    if cp_loss <= thresholds['inaccuracy']:
        return 'inaccuracy'
    if cp_loss <= thresholds['mistake']:
        return 'mistake'
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


def find_best(data):
    # Coarse grid search ranges (tunable)
    best = None
    for g in range(5, 41, 5):
        for e in range(g+5, 81, 5):
            for go in range(e+5, 121, 5):
                for inc in range(go+10, 201, 10):
                    for m in range(inc+50, 501, 25):
                        thresholds = {
                            'great': g,
                            'excellent': e,
                            'good': go,
                            'inaccuracy': inc,
                            'mistake': m,
                        }
                        mismatches, total = score_thresholds(data, thresholds)
                        if total == 0:
                            continue
                        if best is None or mismatches < best[0]:
                            best = (mismatches, total, thresholds)
    return best


def main():
    if len(sys.argv) < 2:
        print("Usage: python calibrate_thresholds.py reference.json")
        sys.exit(1)
    path = sys.argv[1]
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    best = find_best(data)
    if not best:
        print('No valid data or no thresholds found')
        sys.exit(2)
    mismatches, total, thresholds = best
    accuracy = 100.0 * (1.0 - mismatches / total)
    print(f'Best thresholds (accuracy {accuracy:.2f}%):')
    print(json.dumps(thresholds, indent=2))


if __name__ == '__main__':
    main()
