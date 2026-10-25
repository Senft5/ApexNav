# Third-party notices

ApexNav is proprietary (see LICENSE). It uses the open components below under their own licences.
Check each licence before redistributing a build; some notices must ship inside the app.

| Component | Used for | Licence |
|---|---|---|
| Kokoro-82M (hexgrad) and voice packs | stock co-driver voices, source voice for conversion | Apache-2.0 |
| kokoro-js | in-browser speech synthesis | Apache-2.0 (depends on `phonemizer`/espeak-ng, GPL-3.0: see below) |
| kNN-VC, WavLM, HiFi-GAN (bshall, Microsoft, Jungil Kong) | converting the owner's voice | MIT |
| Chatterbox (Resemble AI) | experimental voice clone (not shipped) | MIT |
| MapLibre GL JS | map rendering | BSD-3-Clause |
| Valhalla (via FOSSGIS public server) | routing, map matching, speed limits | MIT |
| OpenStreetMap data, OpenFreeMap tiles | roads, base map | ODbL 1.0; attribution required: © OpenStreetMap contributors |
| AWS Terrain Tiles (Terrarium) | elevation | see https://registry.opendata.aws/terrain-tiles/ |
| Nominatim (OpenStreetMap) | address search | ODbL; usage policy applies |
| Fonts (Barlow Condensed, IBM Plex, Inter Tight) | UI | SIL OFL 1.1 |

## Open issue before charging for or closing the app
kokoro-js depends on an espeak-ng WebAssembly build (GPL-3.0) for text-to-phoneme conversion. For a
proprietary app, replace it with a precomputed phoneme lexicon for the closed pace-note vocabulary
(generated offline with misaki), or confirm the licence position with a lawyer. See docs/VOICE.md.
