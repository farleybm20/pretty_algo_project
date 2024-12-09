import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
  plugins: [glsl()],
  resolve: {
    alias: {
      'three/examples': '/node_modules/three/examples',
    },
  },
  server: {
    port: 5173,
    open: true,
  },
});
