FROM node:22.23.2-alpine3.24

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

ENV NODE_ENV=development

COPY . .

EXPOSE 3000
CMD ["npm", "run", "start:dev"]
