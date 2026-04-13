FROM node:20-alpine
WORKDIR /app
COPY . .
# Install and build server
WORKDIR /app/server
RUN npm install
# Build dashboard
WORKDIR /app/dashboard
RUN npm install
RUN VITE_ADMIN_SECRET=BlackRabbit!(0588) npm run build
# Build docs
WORKDIR /app/docs
RUN npm install && npm run build
# Back to server for runtime
WORKDIR /app/server
EXPOSE 3000
CMD ["sh", "-c", "npm run migrate && npm start"]