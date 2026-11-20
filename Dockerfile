FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src
COPY views ./views
COPY public ./public
COPY data ./data
COPY scripts ./scripts
ENV NODE_ENV=production
ENV DATA_DIR=/var/data
EXPOSE 3000
CMD ["npm", "start"]
