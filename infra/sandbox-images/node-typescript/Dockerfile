# Sandbox execution image for TypeScript submissions.
#
# Neither worker can `npm install typescript` at request time: the sandbox
# container always runs with --network none (see worker-service-go's
# sandbox.go / worker-service's DockerExecutionService), so `tsc` has to
# already exist inside the image before the container ever starts. No
# official Docker Hub image ships both Node and the TypeScript compiler, so
# this one is built and tagged locally instead of pulled.
#
# Build once (or whenever this file changes) with:
#   docker build -t platform/node-typescript:20 infra/sandbox-images/node-typescript
#
# Both workers reference the resulting local tag via LANG_IMAGE_TYPESCRIPT
# (worker-service-go/internal/config/config.go) and the "typescript" entry
# in worker-service's CodeExecutionService registry - update both if this
# tag ever changes.
#
# TypeScript version pinned explicitly (rather than "npm install -g
# typescript", which silently tracks whatever's newest on every rebuild) -
# the frontend's TypeScript language option is labeled "TypeScript 7.0" to
# match, so an unpinned drift would make that label a lie.
FROM node:20-alpine

RUN npm install -g typescript@7.0.2
