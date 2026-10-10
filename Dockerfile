FROM node:22-alpine
WORKDIR /app
COPY server.js ./
COPY public ./public
RUN mkdir /data && chown node:node /data
ENV PORT=3050 DATA_DIR=/data NODE_ENV=production
# uid 1000 – katalog ./data na hoście musi do niego należeć (patrz README)
USER node
EXPOSE 3050
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- http://127.0.0.1:3050/healthz || exit 1
CMD ["node", "server.js"]
