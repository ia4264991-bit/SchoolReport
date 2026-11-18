# SchoolReport GES API — production image.
# Build:  docker build -t schoolreport-api .
# Run:    docker run --env-file .env -p 3000:3000 schoolreport-api
#
# Base image pinned by digest (multi-arch: runs on x86 and on ARM/Graviton servers).
# To update: pick a newer node:24.x.y-alpine tag and its digest from Docker Hub, run the tests.
FROM node:24.22.3-alpine3.23@sha256:3946fb783fdce8a2812136ea694bc95c698c4f4096f3fd18568dc27a8ac389dc

ENV NODE_ENV=production \
    PORT=3000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

WORKDIR /app

# Dependencies first (cached until a package file changes). Exact versions from the lockfile,
# production dependencies only.
COPY package.json package-lock.json ./
COPY gateway/package.json gateway/
COPY services/auth/package.json services/auth/
COPY services/school/package.json services/school/
COPY services/students/package.json services/students/
COPY services/reports/package.json services/reports/
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Application code (read-only for the app user) and the Amazon RDS CA bundle.
COPY gateway/src gateway/src
COPY services services
COPY shared shared
COPY certs certs

# Never run as root inside the container.
USER node
EXPOSE 3000

# Restarted by Docker if the process stops answering.
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health/live || exit 1

# Node handles SIGTERM itself (finishes open requests, closes the database pool).
CMD ["node", "gateway/src/index.js"]
