# Third-party notices

ApexNav is proprietary (see LICENSE). It uses the open components below under their own licences.
Check each licence before redistributing a build. The notices that must ship inside the app are in `web/licenses.html`
(Settings → Sources and licences → Licences); keep the two in step. Audit 2026-10-28 (IDEAS L-03): every shipped
component is permissive (BSD-3, MIT, Apache-2.0, OFL); no GPL code ships; the app downloads no code at run time
(the live voice engine is website-only, `tests/test_no_downloaded_code.py`).

| Component | Used for | Licence |
|---|---|---|
| Kokoro-82M (hexgrad) and voice packs | stock co-driver voices, source voice for conversion | Apache-2.0 |
| transformers.js 3.5.1 (Hugging Face), loaded from jsDelivr | running Kokoro in the browser (LIVE) | Apache-2.0; bundles onnxruntime-web (MIT) |
| misaki 0.9.4 (hexgrad): G2P method and en gold/silver dictionaries (`web/g2p/`, ported in `web/g2p.js`) | text to phonemes for LIVE | Apache-2.0 |
| graphemes_to_phonemes_en_us / _en_gb (Peter Reid, Hugging Face), `web/g2p/*_fallback.safetensors` | phonemes for unknown words | Apache-2.0 (model card) |
| kNN-VC, WavLM, HiFi-GAN (bshall, Microsoft, Jungil Kong) | converting the owner's voice | MIT |
| Chatterbox (Resemble AI) | experimental voice clone (not shipped) | MIT |
| MapLibre GL JS 4.7.1 | map rendering | BSD-3-Clause |
| maplibre-contour (Michael Barry), `web/vendor/maplibre-contour.min.js` | contour lines | BSD-3-Clause |
| QR Code Generator 2.0.4 (Kazuhiko Arase), `web/vendor/qrcode.js` | the convoy QR code | MIT |
| Valhalla (via FOSSGIS public server) | routing, map matching, speed limits | MIT |
| OpenStreetMap data, OpenFreeMap tiles | roads, base map | ODbL 1.0; attribution required: © OpenStreetMap contributors |
| AWS Terrain Tiles (Terrarium) | elevation | see https://registry.opendata.aws/terrain-tiles/ |
| Nominatim (OpenStreetMap) | address search | ODbL; usage policy applies |
| Fonts (Barlow Condensed, IBM Plex, Inter Tight) | UI | SIL OFL 1.1 |

## espeak-ng (GPL-3.0): removed from the shipped app
Earlier builds loaded kokoro-js, whose web bundle inlines an espeak-ng WebAssembly build (GPL-3.0). Since 2026-10-25 the
web app loads transformers.js directly and phonemises with `web/g2p.js` (misaki dictionaries + BART fallback, Apache-2.0);
no espeak-ng code or data is shipped (guarded by `tests/test_g2p.py`). espeak-ng is still used offline by the Python bank
tools (`tools/voicebank.py`, `tools/g2p_compare.py`) to render audio and measure; only their audio output ships.
Apache-2.0 text: `web/g2p/LICENSE-APACHE-2.0.txt`. Open questions for a lawyer: docs/VOICE.md "Removing espeak-ng (GPL)".
