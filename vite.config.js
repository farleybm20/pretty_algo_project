import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      'three/examples': '/node_modules/three/examples',
    },
  },
});


// import { defineConfig } from 'vite';

// export default defineConfig({
//   resolve: {
//     alias: {
//       three: '/node_modules/three/build/three.module.js',
//     },
//   },
// });
