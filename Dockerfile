# 1) web app
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# 2) server, with the web app embedded in the binary
FROM rust:1-bookworm AS server
WORKDIR /app
COPY server/ server/
COPY --from=web /web/dist web/dist
RUN cd server && cargo build --release

# 3) runtime: one binary, one volume
FROM debian:bookworm-slim
ARG TARGETARCH=amd64
ARG LITESTREAM_VERSION=0.3.13
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${TARGETARCH}.tar.gz" | tar -xz -C /usr/local/bin litestream \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
COPY --from=server /app/server/target/release/daybook /usr/local/bin/daybook
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENV DAYBOOK_DATA=/data PORT=8080
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["/entrypoint.sh"]
