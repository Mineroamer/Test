# Puzzle Club has no dependencies to install and nothing to compile, so the
# image is the base runtime plus the repository. Alpine keeps it around 60 MB.
FROM node:22-alpine

# su-exec drops privileges in the entrypoint; see the note on /data below.
RUN apk add --no-cache su-exec

WORKDIR /app

# The word lists and the app. .dockerignore keeps the rest out.
COPY --chown=node:node . .

# /app/data holds the generated word lists and stays part of the image; the
# store itself goes on a mounted volume so accounts and streaks survive a
# deploy.
ENV DATA_FILE=/data/store.json \
    HOST=0.0.0.0 \
    PORT=8080 \
    TRUST_PROXY=1 \
    NODE_ENV=production

RUN mkdir -p /data

# A mounted volume arrives owned by root, whatever the image did at build time,
# so the ownership has to be fixed at start rather than baked in - otherwise
# the first attempt to save would fail on a fresh volume. The entrypoint runs
# as root only long enough to do that, then hands over to `node`.
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

# Answered without touching the store, so a health check costs nothing.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
