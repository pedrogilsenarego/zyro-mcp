FROM node:22-slim

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

# OAuth client registrations live here — mount a persistent volume.
VOLUME ["/app/data"]

CMD ["pnpm", "start"]
