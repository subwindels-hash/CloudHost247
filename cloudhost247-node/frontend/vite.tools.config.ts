import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: path.resolve(__dirname, '../../assets/cloudhost247-tools'),
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, 'src/tools-embed.tsx'),
      formats: ['es'],
      fileName: () => 'tools.js',
      cssFileName: 'tools',
    },
  },
});
