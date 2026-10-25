// Node runner for web/g2p.js: reads a JSON list of texts on stdin, prints phonemes. Used by tests/test_g2p.py and tools/g2p_compare.py.
// usage: node tools/g2p_node.js <repo> <gb|us> [phrase|fallback]
const fs = require('fs'); const path = require('path');
const repo = process.argv[2], acc = process.argv[3];
const G = require(path.join(repo, 'web/g2p.js'));
const d = path.join(repo, 'web/g2p');
const buf = fs.readFileSync(path.join(d, `en_${acc}_fallback.safetensors`));
const g = G.create({ lexicon: JSON.parse(fs.readFileSync(path.join(d, `en_${acc}_lexicon.json`))), british: acc === 'gb',
  fallback: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), fallbackMeta: JSON.parse(fs.readFileSync(path.join(d, `en_${acc}_fallback.json`))),
  places: process.env.G2P_NO_PLACES ? null : JSON.parse(fs.readFileSync(path.join(d, 'places.json'))) });
const texts = JSON.parse(fs.readFileSync(0, 'utf8'));
const mode = process.argv[4] || 'phrase';
const out = texts.map(t => mode === 'fallback' ? g.fallback(t) : g.phonemize(t));
process.stdout.write(JSON.stringify(out));
