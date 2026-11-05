FROM node:22-bookworm-slim

WORKDIR /app
COPY . .
ARG VITE_NETWORK_ARTWORK_URL
ENV VITE_NETWORK_ARTWORK_URL=${VITE_NETWORK_ARTWORK_URL}
RUN npm install -g corepack@latest && corepack pnpm install && corepack pnpm run build

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
