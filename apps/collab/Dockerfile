# Standalone Papervine collab socket (Hocuspocus/Yjs). Build context is THIS dir (apps/collab) —
# the service has no workspace-internal deps, so it installs standalone, no monorepo build needed.
# Run it anywhere that holds a WebSocket open (Fly/Railway/Render/a container host) — not Vercel,
# which can't. `crossws` means it's portable to Bun/Deno/CF too.
FROM node:22-alpine

WORKDIR /app

# Install only this service's deps (few, no lockfile needed). legacy-peer-deps mirrors the repo's
# .npmrc so peer-dep resolution matches.
COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY tsconfig.json ./
COPY src ./src

ENV COLLAB_PORT=1234
EXPOSE 1234

# COLLAB_JWT_SECRET must be provided at runtime (compose / Fly secret); the server refuses to
# start without it rather than open an unauthenticated socket.
CMD ["npm", "start"]
