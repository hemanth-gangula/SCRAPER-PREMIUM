# Playwright official image — runs as root, all system deps pre-installed
FROM mcr.microsoft.com/playwright:v1.48.2-noble

WORKDIR /app

# Install Node dependencies
COPY package*.json ./
RUN npm ci

# Install Chromium browser
RUN npx playwright install chromium

# Copy source
COPY src/ ./src/

EXPOSE 4001

CMD ["node", "src/index.js"]
