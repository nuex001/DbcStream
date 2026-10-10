FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm install --no-save ws dotenv
COPY . .
ENV PORT=8080
EXPOSE 8080
CMD ["node", "examples/server.js"]
