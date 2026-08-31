import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve('src/tablet-web'),
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  plugins: [vue()],
  build: {
    outDir: resolve('out/tablet-web'),
    emptyOutDir: true,
    target: 'es2022'
  }
})
