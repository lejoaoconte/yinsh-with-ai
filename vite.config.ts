import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      cli:       fileURLToPath(new URL('./src/cli',       import.meta.url)),
      component: fileURLToPath(new URL('./src/component', import.meta.url)),
      hooks:     fileURLToPath(new URL('./src/hooks',     import.meta.url)),
      ts:        fileURLToPath(new URL('./src/ts',        import.meta.url)),
      styles:    fileURLToPath(new URL('./src/styles',    import.meta.url)),
    },
  },
})
