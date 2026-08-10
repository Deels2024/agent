FROM node:22-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends coreutils \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8788 \
    WRANGLER_SEND_METRICS=false \
    WRANGLER_LOG_PATH=/app/.wrangler/logs \
    WRANGLER_STATE_DIR=/app/.wrangler/state
WORKDIR /app
COPY --from=build /app /app
RUN mkdir -p /app/.wrangler /app/.sites-runtime \
    && chown -R node:node /app
USER node
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'8788')+'/api/health').then(async r=>{const body=await r.json();if(!r.ok||!body.ok||!body.capabilities?.persistentSearches||!body.capabilities?.accounts)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "run", "start:docker"]
