# VETTA — CO-DRIVER VOICE

## How it works
1. **Voice banks (pace notes)** — `tools/voicebank.py` renders the whole co-driver vocabulary
   (78 tokens: "Left four minus", "Square right", "long", "tightens", "care" … "triple caution",
   "into", "and", "thirty" … "five hundred", "Bump", "Crest", …) with an open-source TTS model,
   trims silence and encodes AAC clips + `manifest.json` under `web/voices/<id>/`.
   `web/voice.js` turns each structured note (`dir`, `severity`, `grade`, `shape`, `mods`,
   `caution`, `link`) into a token sequence and stitches the clips with WebAudio — the way rally
   games do it. Works offline, starts instantly, sounds identical in Safari, the iOS app and
   (later) CarPlay.
2. **Live synthesis (names, routes)** — the same model runs in the browser via transformers.js
   (ONNX, quantised WASM, ~90 MB one-time download, cached); text becomes phonemes in `web/g2p.js`, not espeak-ng. Known phrases (a route's name) are
   pre-rendered in the background when the route loads; a phrase that isn't ready within 1.5 s
   falls back to the device voice so pace notes are never delayed. Toggle: LIVE in the route book.
3. **Voice packs come with themes** (docs/design/REVIEW.md 4.4, 2026-10-29): Roadbook's **Marguerite** (calm, exact;
   Kokoro `af_bella`; she was `bf_isabella`, but every British female Kokoro voice adds a syllable to short calls), Tapedeck's **Kit** (quick, dry, a little cheeky; `bm_fable`), Billet's **Hale** (low, even;
   `bm_lewis`). The calls are identical in every pack; each pack has its own system lines (`PACK_LINES` in
   tools/voicebank.py: ready, full, quiet, end, and the sample the theme picker's Hear key plays). The voice list,
   custom voices ("My Voice") and Jarvis are retired, and so are the George, Daniel, Emma and Michael banks.
   The end of a drive (web/end_line.js): each pack closes in its own words around the Vetta Score, spoken from the
   pack's own number clips (`n:0`-`n:99`, `n:h1`-`n:h9`, `n:k1`) and `end:score` / `end:best`, so no second voice
   joins in. Add new tokens to a bank without re-rendering it: `voicebank.py --voice ID --missing`.
4. **The rest of a drive in the pack's voice** (2026-10-29): directions without the street name, rerouting and traffic,
   reported hazards, coaching memos, break nudges, regroup and track-mode lines are in every bank too (`web/voice_lines.js`,
   one JSON table the bank builder reads). A line with a name in it plays its fixed part from the bank and leaves the
   name on screen; on the website with the live voice loaded, the whole sentence is rendered in the pack's voice instead.
5. **DEVICE** — the phone's own voice, used only when a pack's bank isn't on the phone or a line isn't in it (the convoy
   lines with a friend's handle and hazard, for now).

### Checked rendering and loudness
`voicebank.py --voice ID --rebuild-checked [--only FILE]` renders each clip, transcribes it with Whisper (base.en,
faster-whisper) and keeps the best of up to six takes (three spellings, at the voice's speed and 12 % slower: Kit's
fast "forty" was heard as "fourteen"); a clip scoring under 0.8 is listed for a look. Each manifest entry
records what was `heard` and the `voice` that said it, and a re-run skips entries already heard right in that voice.
Every clip is levelled to -20 dB RMS over its voiced part with peaks at 0.89 or lower (`--relevel` redoes a bank
without re-rendering), so the three packs and the clips inside each play at one loudness.
Playback (`web/voice.js`) waits for the audio context to actually run (iOS suspends it after a call or Siri) and ends a
stitched call when its last clip ends, not on a timer; if the context won't start, the device voice speaks instead of
silence.

Voices shipped: Marguerite, Kit, Hale.
Model: Kokoro-82M, Apache-2.0 (hexgrad/Kokoro-82M).

## Building banks
```
uv venv -p 3.12 /opt/tts12
uv pip install --python /opt/tts12/bin/python torch --index-url https://download.pytorch.org/whl/cpu
uv pip install --python /opt/tts12/bin/python kokoro soundfile "numpy<2.3" "spacy==3.8.7" \
    "preshed==3.0.9" "cymem==2.0.10" "murmurhash==1.0.12"      # spaCy pins avoid a tokenizer crash
/opt/tts12/bin/python tools/voicebank.py --all                  # ~3 min on 4 CPU cores
```

## Whole phrases, not stitched words
Stitched single words were audibly choppy, so every bank now plays **whole-phrase clips**:
- Clips are keyed by their token run joined with `+` (`head:L4-+mod:long+caution:1`). `web/voice.js`
  `cover()` plays the longest clip it has for each run and only uses single words for gaps.
- Rendered per voice: every head with each single modifier (units), the 56 exact calls on the shipped
  drives, and ~470 phrases **mined from 1,586 real calls** (`tools/mine_phrases.py`, built from loops in
  seven regions, `tools/call_corpus.json`). Mining takes the average call from 4.3 clips to ~2.
- Kokoro voices go further: at route load the cockpit renders every call the bank can only voice by
  joining clips as one whole phrase in the browser (kokoro-js) and plays that instead (`playWhole`). The
  render happens in route order in the background and never delays a note: if it is not ready, the bank plays.
- `My Voice` (Chatterbox clone + the owner's real recordings) cannot render live, so it relies on the
  pre-rendered phrases above; its real recordings (`src: "recording"`) win over renders.

## Rhythm: why it did not "flow" (measured on the owner's real calls)
Stock TTS reads a call as one run-on at ~3.1–3.4 words/s with no pauses. The owner chunks a call at 2.7
words/s: chunks run together ("Left four opens over crest into right two") and they breathe
**before the caution (0.29–0.43 s) and before the distance (0.18–0.25 s)**, nowhere else (51 clips,
Whisper word timings, `scratchpad` analysis in STATE). Kokoro commas give <0.1 s; a run of dots gives ~0.24 s
inside one sentence. `tts_text()` (Python) and `spokenText(text, rhythm)` (app) put `.....` before the caution
and `...` before the distance; everything else is spoken unpunctuated. Device TTS never gets the dots.

## My Voice: voice conversion, not zero-shot cloning
Chatterbox gave "a voice like me, not me" and cannot run on a phone. Now: Kokoro **Michael** (American male;
a British source leaked its accent) speaks each whole call; **kNN-VC** (MIT, WavLM + HiFi-GAN) replaces every
20 ms frame by the nearest frames of the owner's own recording, then the owner's 54 real calls override the
converted ones. `tools/vc_bank.py`. Held-out calls, Resemblyzer speaker similarity to the owner:
real clip vs own voice 0.89 (ceiling) | stock Kokoro US voices 0.50–0.65 | converted Michael 0.86 (George, British,
sounded British to the owner). Conversion runs ~0.6 s per second of speech on 4 CPU cores. Reference audio stays
local (`--ref-wav`), only converted clips are published. Possible phone path: ONNX WavLM-Base + kNN + HiFi-GAN.

## In-app voice enrollment (design only; owner put voice work on hold)
Goal (owner, 2026-10-25): any user records a short guided session inside the app and the co-driver speaks in their voice from then on, with every phrase
generated whole. No giant call sheet, no server-side training, nothing about the voice leaves the phone.

**Flow.** Setup → Co-driver voice → *Use my voice*:
1. Consent screen: "Only record your own voice. It stays on this phone." (Chatterbox/other models that clone are not used; this is conversion of our own TTS.)
2. Check the room: 3 s of silence measures noise (needs roughly 25 dB below speech), then a level meter coaches distance and warns on clipping or a loud fan.
3. About 4 minutes of **ordinary reading**, 20–25 short lines, one at a time, big text, auto-advancing on silence. The lines are everyday sentences chosen for sound coverage
   (all English phonemes in several contexts) with the pace-note words woven in naturally ("banked", "crest", "tightens", numbers). Resumable; can be extended later.
4. Build (about a minute, once): the voice is made on the phone and a short sample plays: "Left four, long, into square right. Care." Keep / re-record.
5. Delete my voice: one button erases the recording and the voice.

**How the voice is made (kNN-VC, MIT).** The app already speaks every call as one whole sentence with its fast built-in voice. A small model turns each 20 ms of that speech
into the closest 20 ms of the user's own recording. So the words and rhythm come from the app's voice and the sound of it comes from the user's real audio. More recorded speech means a
better match (we measured the owner's 5.7 min at 0.83 speaker similarity against a 0.89 ceiling); extra sessions can be added at any time.
- Needs on the phone: WavLM (feature extractor), a nearest-neighbour search over the user's recording (a few minutes of audio is ~17k vectors), and a vocoder. The research
  checkpoint is WavLM-Large (1.2 GB): too heavy; the spike below tests WavLM-Base+ (~95M parameters, ~100 MB quantised) exported to ONNX and run with ONNX Runtime Web (WASM/WebGPU).
- Timing: our CPU measurement was ~0.6 s of compute per second of speech with the Large model; a route's calls (~300) are converted in the background at route load and cached, never mid-drive.
- Known limit, from the owner's listening: the conversion keeps the source voice's phrasing, so it can sound like "me, but a computer talking". Measurements cannot see this. The best-sounding
  path remains a voice **fine-tuned** on the owner's real speech (Kokoro, on a GPU); in-app enrollment is the zero-setup path that works for every user.

**Spike (1 day, when voice work resumes).** Pass if all hold: (a) WavLM-Base+ ONNX q8 converts a 3 s call in under 3 s on an iPhone 12-class device; (b) speaker similarity with the Base+ model is within 0.05 of
the Large model on the owner's recording; (c) the owner calls it "clearly me" on 10 held-out calls. If it fails, enrollment stays a desktop/PC feature (tools/vc_bank.py) and users get stock voices on the phone.

**Rules.** Only the signed-in person's own recording; no uploading of voice audio ever; the converted clips and the reference both live in the browser's IndexedDB; no sharing of voices between accounts.

## Real recordings (docs/VOICE_SCRIPT.md)
`tools/make_voice_script.py` writes a script; the owner reads it; `tools/split_recording.py` cuts it:
Whisper word timestamps -> fuzzy alignment of every script line -> cut at the quietest point between
lines -> every clip is re-transcribed and checked. Lines read as a rapid list (the bare heads) bleed into
their neighbours and are dropped; the calls read as calls are kept (54 of 56). Clone reference = Part A.

## Building banks (phrases)
```
/opt/tts12/bin/python tools/voicebank.py --voice george --phrases mined          # also calls|core|units
/opt/cbx/bin/python tools/voicebank.py --voice own --ref voice_test/ref.wav      # word bank (clone)
/opt/cbx/bin/python tools/voicebank.py --voice own --ref voice_test/ref.wav --phrases calls --recorded <dir>
/opt/cbx/bin/python tools/voicebank.py --voice own --ref voice_test/ref.wav --phrases mined
```
Renders are resumable (the manifest is written after every clip). The clone needs `setuptools<81`
(Perth watermarker) and takes ~25 s per phrase on 4 CPU cores.

## Path to ANY phrase in the owner's voice (not built; needs a free GPU)
Option research (Opus review, 2026): voice conversion on top of Kokoro stacks two models' errors; a
Kokoro voicepack alone captures about a third of the identity; Piper is GPL (espeak-ng); so the plan is
**distillation into Kokoro itself**:
1. On Kaggle (free T4) render `tools/training_phrases.json` (4,000 phrases: the 1,202 distinct real calls,
   then grammar-random calls) with Chatterbox from the clean reference, ~1–2 h on a GPU (~28 h on CPU).
2. Filter: Whisper must match the text exactly; drop the lowest-10% speaker similarity against the real
   recordings; trim and normalise to -20 LUFS; add the real recordings weighted 3x.
3. Fine-tune Kokoro-82M with the kikiri-tts recipe (StyleTTS2 stages 1+2, ~10 epochs each, 4–8 T4-hours);
   pick the epoch by listening. Fit a voicepack by averaging style vectors over the real lines.
4. Export to ONNX + q8 like `onnx-community/Kokoro-82M-v1.0-ONNX`, host it, point kokoro-js at it. The
   in-browser path is then identical to the stock voices: any call rendered whole at route load.
Spike first (~1 h on Kaggle): fine-tune on ~400 phrases + 134 real lines, hold out 10 real lines; pass if
speaker similarity is within 0.05 of Chatterbox, word error rate is no worse, and 4/10 blind A/B clips are
"as good or better".

## Licences to check before charging for the app
- espeak-ng (GPL-3.0) is no longer loaded by the web app: see "Removing espeak-ng (GPL)" below.
- Chatterbox: MIT; its output carries an inaudible Perth watermark. Clone only voices whose owners consented.

## Known limits
- New routes still need ~2 clips per call on the clone (distance tails, "into/and" chains): the mined
  phrases cover ~30% of calls as one clip, ~70% as at most two. The Kokoro voices close the gap live.
- Per-clip loudness is peak-normalised, so clips from different renders can differ in level; an LUFS
  pass over the banks would hide more seams.

## Removing espeak-ng (GPL)
**Done (2026-10-25): the shipped LIVE path no longer contains GPL code.** Verified by reading package sources, not npm metadata alone.

**What was wrong.** `kokoro-js@1.2.1` is Apache-2.0 (https://registry.npmjs.org/kokoro-js/1.2.1) but depends on
`phonemizer@^1.2.1` (https://github.com/xenova/phonemizer.js, declared Apache-2.0, README: "Simple text to phones converter using
eSpeak NG"), and the jsDelivr build we loaded (`dist/kokoro.web.js`, 2.1 MB) **inlines** that espeak-ng WebAssembly build: it
contains `espeak-ng-data`, the emscripten `espeak_VOICE_*` bindings and transformers.js 3.5.1. espeak-ng: "released under the GPL
version 3 or later" (https://github.com/espeak-ng/espeak-ng/blob/master/README.md, COPYING = GNU GPL v3). So skipping kokoro-js's
phonemiser at runtime (e.g. calling `generate_from_ids` ourselves) would **not** have been enough: loading `kokoro.web.js` at all
ships the GPL code to the browser.

**What ships now** (`web/voice.js`, behind the same LIVE toggle):
| Piece | Licence (checked in the source) |
|---|---|
| `@huggingface/transformers@3.5.1` `dist/transformers.min.js` from jsDelivr, run directly (StyleTextToSpeech2Model + AutoTokenizer) | Apache-2.0 (https://github.com/huggingface/transformers.js/blob/3.5.1/LICENSE); bundle scanned: no espeak/phonemizer. Deps: onnxruntime-web MIT, @huggingface/jinja MIT; onnxruntime-web deps long Apache-2.0, platform MIT, protobufjs BSD-3-Clause, flatbuffers Apache-2.0, guid-typescript ISC (npm registry). `sharp`/`onnxruntime-node` are excluded from the browser build (`browser` field). |
| Kokoro-82M v1.0 ONNX q8 + voice packs, `onnx-community/Kokoro-82M-v1.0-ONNX` pinned at revision `1939ad2a` | Apache-2.0 (model card) |
| `web/g2p.js`: our JS port of misaki's English dictionary G2P (hexgrad/misaki `en.py`) | ours, port of Apache-2.0 code |
| `web/g2p/en_{gb,us}_lexicon.json`: misaki 0.9.4 `us/gb_gold.json` + `_silver.json` (PyPI wheel, sha256-pinned in `tools/g2p_export.py`) | Apache-2.0 (https://github.com/hexgrad/misaki/blob/main/LICENSE; PyPI metadata). The repo does not say how the dictionaries were made. |
| `web/g2p/en_{gb,us}_fallback.safetensors`: `PeterReid/graphemes_to_phonemes_en_{gb,us}`, the 1+1-layer BART (0.75 M params) that misaki itself uses as its non-espeak fallback (`misaki/en.py` `FallbackNetwork`), unmodified, revisions pinned | Apache-2.0 (model card metadata only; no LICENSE file in the repo). Trained on misaki's gold/silver dictionaries plus regular plurals found in a text corpus (its `english_to_phonemes.py`). |

The kokoro-js "glue" (pick the style vector by token count, call the model) is ~10 lines rewritten in `voice.js`.

**How text becomes phonemes.** Kokoro v1.0 was trained on misaki phonemes (diphthongs as `A I O Q W Y`, `ᵊ`, flap `T`), so
misaki's own path is the right target (kokoro-js fed espeak IPA instead). `g2p.js` ports misaki's lookup: gold, then silver,
case variants, `-s/-ed/-ing` stemming, hyphenated compounds with misaki's stress demotion, context words (*the/to/a/an/in*),
numbers (cardinal, ordinal, year), then the BART for anything unknown. It runs the BART in plain JS (no runtime). Not ported: the
spaCy tagger (heteronyms take the dictionary default), currency. Extensions: road abbreviations (Hwy, Pkwy, Rd, Mt, St→Saint before a
name / Street otherwise), `I-40` → "I 40", ALL-CAPS before a number spelled out (US 129), and `web/g2p/places.json`, a hand-written
list for names the fallback gets wrong. A phrase with a word nobody can voice is not rendered (device voice instead).

**Measured** (`tools/g2p_compare.py`; Python misaki + espeak-ng used offline as a ruler only, never shipped). Reference "espeak" =
misaki dictionary + espeak fallback, i.e. what the pre-rendered banks used. 1,436 random US Census place names
(2023 Gazetteer, public domain), 50 driving roads, 10 pace calls; phoneme error rate (PER) = character edit distance / length.
| | GB | US |
|---|---|---|
| JS BART vs Python BART, 1,472 single words | 100 % identical | 100 % identical |
| JS vs Python misaki+BART, place names | 99.3 % exact (rest: our St.→Saint) | 99.3 % exact (same) |
| pace calls vs espeak reference | 10/10 identical | 10/10 identical |
| roads vs espeak reference | 70 % exact, PER 5.8 % | 76 % exact, PER 5.3 % |
| place names vs espeak reference | 62 % exact, PER 9.7 % | 65 % exact, PER 8.3 % |
Half the place names (739/1,436) contain a word outside the dictionaries; every difference from espeak sits in those words. Neither
side is ground truth: espeak says Ocoee `ˈɑkO` (wrong; it is oh-KOH-ee), BART `OkˈOi`; BART said Mulholland `mˌʌlhˈɑnt` and
British Tellico `tɛlˈiːkQ` (both wrong), now fixed in `places.json`. Dictionary words (all pace-note vocabulary) are identical.

**End to end, in a browser.** Headless Chromium in this container ran the real `voice.js` + `g2p.js` (George and Michael, 5 phrases
each: Tail of the Dragon, Deals Gap to Cherohala Skyway, a full call with caution and distance, Nantahala Gorge/Tellico Plains,
Square right into left three tightens). Whisper small.en transcribed the browser renders and Python Kokoro's espeak-based renders of
the same texts **identically on all 10** (both e.g. "Deals Gap to Cherahala Skyway", "Tale of the Dragon", "tightens" heard as
"Titans"/"times" in both). Nobody has listened yet; Whisper agreement is intelligibility, not quality.

**Speed: background only.** Model load ~7.5 s, then 6–10 s per short phrase here (headless, 4 cores); the coordinator measured
10–17 s per phrase on a desktop-class CPU (~6 s model load), and threads via cross-origin isolation only brought that to 8–13 s.
So live synthesis is only viable as **background prefetch of route names and whole calls at route load**, never mid-drive; the
1.5 s `speakLive` timeout already falls back to the bank/device voice. Phones will be slower; unmeasured.

**Download.** LIVE now also fetches one accent's G2P data: lexicon 5.2–5.6 MB (~1.4 MB gzip) + BART 3 MB, cached.

**Remaining risks (for a lawyer, not settled here).** (1) The misaki dictionaries' provenance is undocumented; if any entries were
produced with espeak-ng, the GPL position of program *output* is generally favourable but is a legal question. (2) The BART card
declares Apache-2.0 only in metadata. (3) Apache-2.0 requires shipping the licence text and notices: `web/g2p/LICENSE-APACHE-2.0.txt`,
THIRD_PARTY_NOTICES.md. Fallback if any of this fails review: drop LIVE for the commercial build and rely on the pre-rendered banks +
the device voice; nothing else depends on it.
