// Benchmark roads (IDEAS R-32 / Q-19): famous driving roads and how high the stage scorer must rank them in their region
// (`top`: the share of the region's stages above which the road's best stage must sit). The Dragon must be in the top
// tenth. The others guard today's ranks while the scorer can't do better: only 4-7 of the Stelvio's 48 hairpins are found (zoom-14
// tiles don't change it: stroke joining or corner detection under-counts dense hairpin sequences), Big Sur is a coast road of sweepers in a region with Nacimiento-Fergusson Road
// in it, and CA-33 sits just outside the top tenth (#3 of 28).
// `match`: the road's ref or name in the map tiles; tools/make_benchmark_fixture.js saves each region's road pieces and
// points along the matching named lines; tests/test_benchmark_roads.py scores the pieces and finds the road's stages.
exports.BENCHMARKS = [
  { id: 'tail_of_the_dragon', name: 'US-129, Tail of the Dragon (Tennessee / North Carolina)', lat: 35.50, lon: -83.95, radiusKm: 12, match: /^(US )?129$|Calderwood Highway|Tail of the Dragon/i, top: 0.10 },
  { id: 'big_sur', name: 'CA-1, Big Sur (California)', lat: 36.18, lon: -121.68, radiusKm: 12, match: /^(CA|SR) 1$|Cabrillo Highway/i, top: 0.45 },
  { id: 'stelvio', name: 'SS38, Stelvio Pass (Italy)', lat: 46.52, lon: 10.45, radiusKm: 10, match: /^SS ?38$|Stelvio/i, top: 0.20 },
  { id: 'route_33', name: 'CA-33, Maricopa Highway north of Ojai (California)', lat: 34.55, lon: -119.30, radiusKm: 12, match: /^(CA|SR) 33$|Maricopa/i, top: 0.12 },
];
