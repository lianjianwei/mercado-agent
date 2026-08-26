import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../.vite/renderer/main_window',
  },
  plugins: [react()],
});
