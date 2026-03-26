FROM node:lts

COPY --from=alpine/bombardier /usr/bin/bombardier /usr/local/bin/bombardier
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bench/package.json bench/
RUN pnpm install --frozen-lockfile

COPY src/ src/
COPY bench/ bench/
COPY tsconfig.json ./
