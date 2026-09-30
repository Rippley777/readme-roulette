FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY vendor ./vendor
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_HOUSE_EDGE_PROJECT
ARG NEXT_PUBLIC_HOUSE_EDGE_KEY
ARG NEXT_PUBLIC_HOUSE_EDGE_ENDPOINT
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
VOLUME ["/app/.data"]
CMD ["node", "server.js"]
