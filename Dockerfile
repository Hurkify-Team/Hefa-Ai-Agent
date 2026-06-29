# Render uses this image to run the full Next.js app plus Playwright portal automation.
# Node 22 is required because the project uses node:sqlite for local audit logs.
FROM node:22-bookworm

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app/frontend

# Install dependencies first so Docker can reuse this layer between app changes.
COPY frontend/package*.json ./
RUN npm install

# Install Chromium and Linux system libraries required by Playwright in Render.
RUN npx playwright install --with-deps chromium

COPY frontend ./

RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "npm run start -- -p ${PORT:-3000} -H 0.0.0.0"]
