"""Pick which whole phrases to pre-render, from real calls (tools/call_corpus.json).

Greedy: repeatedly add the contiguous token run that removes the most clip-joins across the
corpus (each call is covered with the fewest clips the chosen set allows). The clone voice
renders slowly (~25 s a phrase), so this spends that budget where real routes use it.
  python tools/mine_phrases.py N  -> tools/mined_phrases.json (ordered, best first)
"""
import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAX_LEN = 7


def min_segments(call, chosen):
    n = len(call)
    best = [0] + [10 ** 9] * n
    for i in range(1, n + 1):
        for j in range(max(0, i - MAX_LEN), i):
            if i - j == 1 or tuple(call[j:i]) in chosen:
                best[i] = min(best[i], best[j] + 1)
    return best[n]


def main(budget: int) -> None:
    corpus = [tuple(c) for c in json.load(open(os.path.join(ROOT, "tools", "call_corpus.json")))]
    counts = Counter(corpus)
    calls = list(counts)                 # distinct calls weighted by frequency
    chosen, order = set(), []
    cur = {c: min_segments(c, chosen) for c in calls}
    total0 = sum(counts[c] * cur[c] for c in calls)
    cand = Counter()
    for c in calls:
        for i in range(len(c)):
            for j in range(i + 2, min(len(c), i + MAX_LEN) + 1):
                cand[c[i:j]] += counts[c]
    cands = [k for k, v in cand.items() if v >= 3]
    print(f"{len(corpus)} calls, {len(calls)} distinct, {len(cands)} candidate phrases; mean clips/call {total0 / len(corpus):.2f}")
    users = {k: [c for c in calls if any(c[i:i + len(k)] == k for i in range(len(c) - len(k) + 1))] for k in cands}
    while len(order) < budget and cands:
        best, gain = None, 0
        for k in cands:
            if k in chosen:
                continue
            g = sum(counts[c] * (cur[c] - min_segments(c, chosen | {k})) for c in users[k])
            if g > gain:
                best, gain = k, g
        if best is None:
            break
        chosen.add(best)
        order.append(best)
        for c in users[best]:
            cur[c] = min_segments(c, chosen)
        if len(order) in (50, 100, 200, 300, 400, 500, 700):
            tot = sum(counts[c] * cur[c] for c in calls)
            single = sum(counts[c] for c in calls if cur[c] == 1) / len(corpus)
            two = sum(counts[c] for c in calls if cur[c] <= 2) / len(corpus)
            print(f"  {len(order):4d} phrases: {tot / len(corpus):.2f} clips/call, {single:.0%} one clip, {two:.0%} at most two")
    json.dump([list(k) for k in order], open(os.path.join(ROOT, "tools", "mined_phrases.json"), "w"))


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 400)
