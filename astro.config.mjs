// @ts-check
import { defineConfig } from 'astro/config'
import tailwindcss from '@tailwindcss/vite'
import icon from 'astro-icon'

export default defineConfig({
  integrations: [icon()],
  site: 'https://patchworkanalytics.github.io',
  base: '/',
  output: 'static',
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    shikiConfig: {
      themes: {
        dark: 'monokai',
        light: 'monokai',
        // light: 'solarized-light',
      },
    },
  },
})
