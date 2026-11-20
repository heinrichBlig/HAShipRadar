#!/usr/bin/with-contenv bashio
# with-contenv exposes SUPERVISOR_TOKEN to the process
exec python3 /app/relay.py
