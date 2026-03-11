FROM node:18-alpine

# Create app directory
WORKDIR /app

# Install app dependencies (use package-lock.json if present)
COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . .

ENV NODE_ENV=production

CMD ["node", "sms2mqtt.js"]
