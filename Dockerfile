# --- Build stage ---
FROM node:22-alpine AS build

# argon2 + cpu-features need native compilation
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Remove dev dependencies so only production deps remain
RUN npm prune --omit=dev

# --- Runtime stage ---
FROM node:22-alpine

# argon2 native addon needs libstdc++ at runtime
RUN apk add --no-cache libstdc++

WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules/ node_modules/
COPY --from=build /app/dist/ dist/

# Default vault mount point (matches .env.example)
VOLUME ["/config"]

ENV MCP_TRANSPORT=http
ENV MCP_HTTP_PORT=8000
ENV MCP_HOST=0.0.0.0
ENV ROUTEROS_REST_PORT=443
ENV ROUTEROS_REST_SCHEME=https
ENV ROUTEROS_TIMEOUT_MS=10000
ENV SSH_TIMEOUT_MS=10000
# Set READ_ONLY=true to expose only read-only tools (no writes/execution/active diagnostics)
ENV READ_ONLY=false

EXPOSE 8000

ENTRYPOINT ["node", "dist/index.js"]
