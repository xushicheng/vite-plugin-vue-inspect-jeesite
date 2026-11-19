import { fileURLToPath } from 'node:url'
import { DevTools } from '@vitejs/devtools'
import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import VueJsx from '@vitejs/plugin-vue-jsx'
import Inspect from 'vite-plugin-inspect'
import Inspector from '../../core/src'

const r = (filepath: string) => fileURLToPath(new URL(filepath, import.meta.url))

export default defineConfig({
  plugins: [
    DevTools(),
    Vue(),
    VueJsx(),
    Inspector({
      enabled: true,
      toggleButtonVisibility: 'always',
      launchEditor: 'cursor',
      viteDevtools: true,
    }),
    Inspect(),
  ],
  resolve: {
    alias: {
      'vite-plugin-vue-inspect-jeesite/client/record': r('../../core/src/client/record.ts'),
      'vite-plugin-vue-inspect-jeesite/client/listeners': r('../../core/src/client/listeners.ts'),
      'vite-plugin-vue-inspect-jeesite/client/overlay': r('../../core/src/client/overlay.ts'),
      'vite-plugin-vue-inspect-jeesite/client/vite-devtools': r('../../core/src/client/vite-devtools.ts'),
    },
  },
})
