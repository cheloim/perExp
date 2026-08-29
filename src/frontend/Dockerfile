FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

# --- Dev: Vite dev server with HMR ---
FROM base AS dev
COPY vite.config.ts tsconfig.json tsconfig.node.json tsconfig.workers.json tailwind.config.js postcss.config.js ./
COPY docker-entrypoint.sh .
RUN chmod +x docker-entrypoint.sh
EXPOSE 5173
ENTRYPOINT ["./docker-entrypoint.sh"]

# --- Build stage ---
FROM base AS build
ARG VITE_APP_ENV=development
ENV VITE_APP_ENV=$VITE_APP_ENV
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
COPY . .
RUN npm run build

# --- Prod: nginx serving built files ---
FROM nginx:alpine AS prod
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1
