FROM node:26-alpine AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:26-alpine
RUN apk add --no-cache ca-certificates wget
WORKDIR /opt/tealfabric-nanite
COPY --from=build /src/package.json /src/package-lock.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY scripts/entrypoint.sh /usr/local/bin/tealfabric-nanite-entrypoint
ARG NANITE_SPKI_SHA256=
RUN chmod 755 /usr/local/bin/tealfabric-nanite-entrypoint \
  && mkdir -p /var/lib/tealfabric-nanite /etc/tealfabric-nanite \
  && chmod 700 /var/lib/tealfabric-nanite \
  && if [ -n "$NANITE_SPKI_SHA256" ]; then printf '%s\n' "$NANITE_SPKI_SHA256" > /etc/tealfabric-nanite/spki.sha256; fi
ENV TF_NANITE_STATE_DIR=/var/lib/tealfabric-nanite
ENV TF_NANITE_LOCAL_HEALTH_PORT=8787
ENTRYPOINT ["tealfabric-nanite-entrypoint"]
