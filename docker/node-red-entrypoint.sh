#!/bin/sh
set -eu

flow_file="${FLOW_FILE:-flows.json}"
if [ "$flow_file" != "flows.json" ]; then
  echo "FLOW_FILE no permitido: $flow_file" >&2
  exit 1
fi

if [ ! -e /data/node_modules ]; then
  ln -s /opt/celda/node_modules /data/node_modules
fi
if [ ! -f /data/flows.json ]; then
  cp "/opt/celda/$flow_file" /data/flows.json
fi
exec /opt/celda/node_modules/.bin/node-red --userDir /data --settings /opt/celda/settings.js /data/flows.json
