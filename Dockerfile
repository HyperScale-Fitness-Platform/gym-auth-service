# alpine = a much smaller base image than the default node image
FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests first so Docker can cache this layer —
# rebuilds are much faster when only source code changed, not dependencies.
COPY package*.json ./
RUN npm install --omit=dev

# Now copy the actual source code.
COPY . .

# Informational only — doesn't publish the port by itself.
EXPOSE 4000

CMD ["node", "src/index.js"]
