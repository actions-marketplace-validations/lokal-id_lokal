# Samaran Proxy in a container: @lokal-id/mcp from npm, the same version as this repository's release.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914

ARG LOKAL_VERSION=0.13.0
RUN npm install -g --ignore-scripts @lokal-id/mcp@${LOKAL_VERSION} && npm cache clean --force

# The proxy reads .samaran.json from the folder it starts in, and writes the audit log under it.
WORKDIR /app
RUN mkdir .lokal && chown -R node:node /app
USER node
EXPOSE 8787
# 0.0.0.0 inside the container only: compose.yaml publishes the port on 127.0.0.1 of the host.
ENTRYPOINT ["lokal-mcp", "proxy", "--host", "0.0.0.0", "--port", "8787"]
