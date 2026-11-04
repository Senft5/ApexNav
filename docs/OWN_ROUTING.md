
- 2026-11-04 (region grid): the context grid for OH+KY+IN on graph-data ctx/v1 (ctx-region.yml, 6 shards, 32 min):
  33 bundles, 35.6 MB, 1.46 M HPMS road spans, 13,574 fatal crashes; served at /api/ctx/v1/ (KV first, then the branch).
  The region graph was rebuilt with it (build 2026-45-95960e6d-gebab6b, 584 tiles, 228.9 MB; Columbus tile 388_519:
  known share of the model's weight 0.65 -> 0.76), and the shipped Cincinnati set is that build's 16 tiles (17.4 MB),
  committed by the workflow. The relay asks raw GitHub with Cloudflare's subrequest cache (a week, keyed by build);
  timed on the preview, repeats were 0.3-0.8 s against 0.6-1.0 s first, too noisy from here to call a cache hit.
