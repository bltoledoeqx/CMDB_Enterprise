FROM node:20-alpine

WORKDIR /app

# Dependências
COPY server/package*.json ./
RUN npm install --omit=dev

# Código do servidor
COPY server/server.js ./

# Frontend
COPY public/ ./public/

# Volume para dados persistentes
VOLUME ["/data"]

ENV DATA_DIR=/data
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/api/auth/me || exit 1

CMD ["node", "server.js"]
