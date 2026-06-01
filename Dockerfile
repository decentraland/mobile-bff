FROM node:24-alpine as builderenv

WORKDIR /app

# Alpine uses apk, not apt-get
RUN apk add --no-cache python3 make g++

# install dependencies
COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
RUN npm install

# build the app
COPY . /app
RUN npm run build

# remove devDependencies, keep only used dependencies
RUN npm prune --production

########################## END OF BUILD STAGE ##########################

FROM node:24-alpine

# NODE_ENV is used to configure some runtime options, like JSON logger
ENV NODE_ENV production

# Install tini for proper signal handling
RUN apk add --no-cache tini

WORKDIR /app
COPY --from=builderenv /app /app

# Please _DO NOT_ use a custom ENTRYPOINT because it may prevent signals
# (i.e. SIGTERM) to reach the service
# Read more here: https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/
#            and: https://www.ctl.io/developers/blog/post/gracefully-stopping-docker-containers/
ENTRYPOINT ["/sbin/tini", "--"]
# Run the program under Tini
CMD [ "node", "--trace-warnings", "--abort-on-uncaught-exception", "--unhandled-rejections=strict", "dist/index.js" ]
