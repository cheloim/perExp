FROM node:20-alpine AS build

WORKDIR /app

# Copy dep files first — layer caches when only source changes
COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

# Now copy source
COPY . .
RUN npm run build

FROM nginx:alpine

# Rewrite /api → backend:8000 so React dev and prod share the same nginx config
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1