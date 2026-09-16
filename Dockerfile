FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev
RUN npx puppeteer browsers install chrome

COPY . .

EXPOSE 3000

ENV PORT=3000

CMD ["npm", "start"]
