import { defineNuxtConfig } from 'nuxt/config'
import Inspector from 'vite-plugin-vue-inspect-jeesite'

export default defineNuxtConfig({
  vite: {
    plugins: [
      Inspector({
        enabled: true,
        toggleButtonVisibility: 'always',
        launchEditor: 'code',
        appendTo: /\/entry\.m?js$/,
      }),
    ],
  },
})
