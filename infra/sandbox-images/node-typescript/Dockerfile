# Sandbox execution image for TypeScript submissions.
#
# worker-service-go can't `npm install typescript` at request time: the
# sandbox container always runs with --network none (see sandbox.go), so
# `tsc` has to already exist inside the image before the container ever
# starts. No
# official Docker Hub image ships both Node and the TypeScript compiler, so
# this one is built and tagged locally instead of pulled.
#
# Build once (or whenever this file changes) with:
#   docker build -t platform/node-typescript:20 infra/sandbox-images/node-typescript
#
# worker-service-go references the resulting local tag via
# LANG_IMAGE_TYPESCRIPT (internal/config/config.go) - update it if this
# tag ever changes.
#
# TypeScript version pinned explicitly (rather than "npm install -g
# typescript", which silently tracks whatever's newest on every rebuild) -
# the frontend's TypeScript language option is labeled "TypeScript 7.0" to
# match, so an unpinned drift would make that label a lie.
FROM node:20-alpine

RUN npm install -g typescript@7.0.2
