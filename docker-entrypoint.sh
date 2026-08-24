#!/bin/sh
# Make the mounted volume writable by the unprivileged user, then become them.
#
# Fly attaches a volume owned by root regardless of what the image set up at
# build time, so this cannot be done with a RUN chown - by the time the app
# starts, the mount has replaced whatever was there.
#
# Nothing here is allowed to stop the container. A platform that hands over an
# already-writable volume, or one that refuses chown entirely, should still get
# a running app; if the directory really is unwritable the server says so when
# it tries to save, which is a far clearer failure than dying at boot.
set -e

APP_USER=${APP_USER:-node}
DATA_DIR=$(dirname "${DATA_FILE:-/data/store.json}")

mkdir -p "$DATA_DIR" 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  if id "$APP_USER" >/dev/null 2>&1; then
    chown -R "$APP_USER" "$DATA_DIR" 2>/dev/null \
      || echo "entrypoint: could not take ownership of $DATA_DIR; continuing" >&2
    exec su-exec "$APP_USER" "$@"
  fi
  echo "entrypoint: no $APP_USER account in this image; staying as root" >&2
fi

exec "$@"
