# Build the static bundle, then serve it from nginx.
#
# Vite inlines `import.meta.env.VITE_*` at *build* time, not at container start, so the
# API origin has to be supplied as a build argument. `docker-compose.yml` passes
# `http://localhost:8000` rather than the in-network `http://backend:8000`, because the
# URL is resolved by the *browser* on the host, not by this container.
FROM node:22-alpine AS build

WORKDIR /app

ARG VITE_API_BASE_URL=http://127.0.0.1:8000
ARG VITE_WS_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_WS_URL=$VITE_WS_URL

# Lockfile-exact install; the dependency layer is cached until the manifests change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `npm run build` runs `tsc -b && vite build`, so a type error fails the image.
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
