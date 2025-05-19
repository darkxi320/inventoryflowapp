
FROM node:20-alpine

RUN apk add --no-cache openssl

EXPOSE 6004

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --legacy-peer-deps && npm cache clean --force

COPY . .

RUN npx prisma generate


RUN npm run build

ENV NODE_ENV=production

CMD ["npm", "run", "docker-start"]

