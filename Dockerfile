# SPEC §6: web app + API (Express). Build: docker build -t pavement-pinn-app .
FROM node:22.14.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_BASE_PATH=/
RUN npx vite build \
 && npx esbuild server/index.ts --bundle --platform=node --format=cjs --packages=external --sourcemap --outfile=dist/server.cjs

FROM node:22.14.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3100 VITE_BASE_PATH=/ DATA_DIR=/data INFERENCE_URL=http://inference:8100 DEMO_AUTH=false
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY config ./config
COPY measurements ./measurements
COPY public ./public
EXPOSE 3100
CMD ["node", "dist/server.cjs"]
