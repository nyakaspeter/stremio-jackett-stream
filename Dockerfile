ARG NODE_VERSION=22.12.0
ARG PNPM_VERSION=8.15.4
ARG TS_VERSION=5.3.3

# Builder stage
FROM node:${NODE_VERSION} as build

WORKDIR /usr/src/app

RUN npm install -g typescript@${TS_VERSION}
RUN --mount=type=cache,target=/root/.npm \
    npm install -g pnpm@${PNPM_VERSION}
RUN --mount=type=bind,source=package.json,target=package.json \
    --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
    --mount=type=bind,source=patches,target=patches \
    --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

RUN pnpm run build
RUN pnpm prune --prod

# Runner stage
FROM node:${NODE_VERSION}-slim as final

COPY package.json .
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist

ENV NODE_ENV production
ENV HTTPS_METHOD local-ip.medicmobile.org
ENV DOWNLOAD_DIR /data
ENV KEEP_DOWNLOADED_FILES false
ENV MAX_CONNS_PER_TORRENT 50
ENV DOWNLOAD_SPEED_LIMIT 20971520
ENV UPLOAD_SPEED_LIMIT 1048576
ENV SEED_TIME 60000
ENV TORRENT_TIMEOUT 5000

VOLUME /data

RUN mkdir -p /data
RUN chown -R node /data

USER node

EXPOSE 58827
EXPOSE 58828

CMD npm start