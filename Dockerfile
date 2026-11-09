# Vetwise — container image for a hosted demo or a self-hosted household.
# The server runs TypeScript through tsx (no build step), so dev dependencies
# are installed on purpose.
FROM node:22-slim

ENV NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=3000 \
    VETWISE_DATA=/app/data/db.json \
    VETWISE_AGENT=scripted

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY web ./web
COPY assets ./assets

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Run node directly (not npm) so SIGTERM reaches the server's shutdown handler.
CMD ["node", "--import", "tsx", "src/index.ts"]
