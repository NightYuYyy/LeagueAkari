import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('src/shared')
    }
  },
  ssr: {
    noExternal: true
  },
  build: {
    ssr: resolve('src/tablet-server/index.ts'),
    target: 'node22',
    outDir: resolve('out/tablet-server'),
    emptyOutDir: true,
    minify: true,
    rollupOptions: {
      output: {
        entryFileNames: 'server.mjs'
      }
    }
  }
})
