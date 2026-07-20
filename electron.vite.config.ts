import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          // Renderer entries: the main app, the transient client picker, and
          // the always-on-top pinned timer widget.
          index: resolve('src/renderer/index.html'),
          picker: resolve('src/renderer/picker.html'),
          pinned: resolve('src/renderer/pinned.html')
        }
      }
    }
  }
})
