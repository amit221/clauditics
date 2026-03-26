import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: '.',
  plugins: [react()],
  build: { outDir: 'dist' },
  server: { proxy: { '/api': 'http://localhost:3000', '/verify': 'http://localhost:3000' } },
});
