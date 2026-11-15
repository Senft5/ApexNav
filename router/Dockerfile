# Our own Valhalla router (backend/src/valhalla.ts), run as a Cloudflare Container by the ValhallaRouter Durable Object.
# The image is the Valhalla project's own, pinned by digest (3.9.2); the tiles are not in it: start.sh fetches this
# week's tile tar from R2 through the Worker (http://tiles.vetta) when the container starts, so a new tile build needs
# no new image. The same digest builds the tiles (.github/workflows/valhalla-tiles.yml), so tiles and server always match.
FROM ghcr.io/valhalla/valhalla@sha256:f0e58e726de82e242be749043df906da99a6441e9bdb7f662635f5d8527346d7
COPY start.sh /usr/local/bin/vetta-router
USER root
RUN chmod 0755 /usr/local/bin/vetta-router && mkdir -p /data && chmod 0777 /data
EXPOSE 8002
ENTRYPOINT ["/usr/local/bin/vetta-router"]
