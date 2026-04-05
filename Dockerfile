# ─── Stage 1: Install dependencies ───
FROM node:22-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 2: Production image ───
FROM node:22-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src/ ./src/
COPY public/ ./public/
RUN mkdir -p /app/data && chown -R node:node /app /app/data
ENV DB_DIR=/app/data NODE_ENV=production PORT=3460
USER node
EXPOSE 3460
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const p=process.env.PORT||3460;require('http').get('http://127.0.0.1:'+p+'/api/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["node", "src/server.js"]
