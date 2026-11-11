import { defineConfig, devices } from '@playwright/test'

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1'

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'pwa.spec.ts',
  reporter: 'list',

  use: { baseURL: 'http://localhost:5193/outgoing-map/' },

  webServer: {
    command: 'npx vite preview --base /outgoing-map/ --port 5193 --strictPort',
    url: 'http://localhost:5193/outgoing-map/',
    reuseExistingServer: false,
  },

  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'] } }],
})
