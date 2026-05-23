FROM node:lts

COPY --from=alpine/bombardier@sha256:7be639b288fce624fee54e2ef95c35685f90fc9ed1399812cf856b4b7c6c55ab /usr/bin/bombardier /usr/local/bin/bombardier
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bench/package.json bench/
RUN pnpm install --frozen-lockfile

COPY src/ src/
COPY bench/ bench/
COPY tsconfig.json ./
