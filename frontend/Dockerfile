FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_APP_ENV=development
ENV VITE_APP_ENV=$VITE_APP_ENV

ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1