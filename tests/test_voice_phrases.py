"""Whole-phrase voice banks: playback covering, phrase text, mining and recording alignment helpers."""
import json
import os
import shutil
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import mine_phrases  # noqa: E402
import split_recording as sr  # noqa: E402
import voicebank as vb  # noqa: E402

NODE = shutil.which("node")


def test_phrase_text_reads_as_one_sentence():
    v = vb.codriver_vocabulary()
    assert vb.phrase_text(["head:L4-", "mod:long"], v) == "Left four minus long."
    assert vb.phrase_text(["head:L4-", "caution:1", "dist:150"], v) == "Left four minus, care, one fifty."
    assert vb.phrase_text(["head:RSQ", "link:into", "head:L3"], v) == "Square right into Left three."


def test_tts_text_breathes_before_caution_and_distance_only():
    v = vb.codriver_vocabulary()
    assert vb.tts_text(["head:L4-", "mod:long"], v) == "Left four minus long."
    assert vb.tts_text(["head:L4-", "mod:long", "caution:1", "dist:150"], v) == "Left four minus long ..... care ... one fifty."
    # a chunk joined by "into" runs together, as the owner says it
    assert vb.tts_text(["head:RSQ", "link:into", "head:L3"], v) == "Square right into Left three."
    assert "," not in vb.tts_text(["head:L4-", "caution:2", "link:and", "head:R2", "dist:80"], v)


def test_rally_numbers_are_spoken_like_a_codriver():
    assert sr.words_of("120") == ["one", "twenty"]
    assert sr.words_of("450") == ["four", "fifty"]
    assert sr.words_of("500") == ["five", "hundred"]
    assert sr.words_of("30") == ["thirty"]
    assert sr.words_of("Right 3 minus,") == ["right", "three", "minus"]


def test_min_segments_uses_the_longest_available_clip():
    call = ("head:L4-", "mod:long", "caution:1", "dist:150")
    assert mine_phrases.min_segments(call, set()) == 4
    assert mine_phrases.min_segments(call, {("head:L4-", "mod:long")}) == 3
    assert mine_phrases.min_segments(call, {("head:L4-", "mod:long"), ("caution:1", "dist:150")}) == 2
    assert mine_phrases.min_segments(call, {call}) == 1


def test_every_shipped_call_has_vocabulary_for_each_token():
    v = vb.codriver_vocabulary()
    calls = vb.route_phrases()
    assert len(calls) > 40
    assert all(t in v for c in calls for t in c)


@pytest.mark.skipif(NODE is None, reason="node not installed")
def test_voice_js_plays_the_longest_whole_phrase():
    runner = r"""
    global.window = {}; require(process.argv[1] + '/web/voice.js');
    const V = window.ApexVoice;
    // inject a bank through load(): fetch is stubbed
    const bank = { id: 't', style: 'codriver', tokens: {} };
    for (const k of ['head:L4-', 'mod:long', 'caution:1', 'dist:150', 'link:into', 'head:RSQ',
                     'head:L4-+mod:long', 'head:L4-+mod:long+caution:1']) bank.tokens[k] = { file: k + '.m4a', dur: 1 };
    global.fetch = async () => ({ ok: true, json: async () => bank });
    (async () => {
      await V.load('t');
      const call = ['head:L4-', 'mod:long', 'caution:1', 'dist:150'];
      const one = V.cover(call), two = V.cover(['head:RSQ', 'link:into', 'head:L4-', 'mod:long']);
      process.stdout.write(JSON.stringify({ one, two, joins: V.joins(call) }));
    })();
    """
    out = subprocess.run([NODE, "-e", runner, os.path.abspath(".")], capture_output=True, text=True, check=True)
    r = json.loads(out.stdout)
    assert r["one"] == ["head:L4-+mod:long+caution:1", "dist:150"]
    assert r["two"] == ["head:RSQ", "link:into", "head:L4-+mod:long"]
    assert r["joins"] == 1
