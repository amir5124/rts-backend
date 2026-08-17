# Gunakan Node.js versi 20 (LTS)
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json dan package-lock.json (untuk caching)
COPY package*.json ./

# Install dependencies (hanya production)
RUN npm ci --only=production

# Copy seluruh kode aplikasi
COPY . .

# Buat user non-root untuk keamanan
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Expose port (sesuaikan dengan port app kamu)
EXPOSE 3000

# Start aplikasi
CMD ["node", "server.js"]