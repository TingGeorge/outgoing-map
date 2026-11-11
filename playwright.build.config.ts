import { defineConfig, devices } from '@playwright/test'

try {
  process.loadEnvFile()
} catch {}

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1'

const chromiumGL = process.platform === 'darwin'
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'pwa.spec.ts',
  reporter: 'list',

  use: {
    baseURL: 'http://localhost:5193/outgoing-map/',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },

  webServer: {
    command: 'npx vite preview --base /outgoing-map/ --port 5193 --strictPort',
    url: 'http://localhost:5193/outgoing-map/',
    reuseExistingServer: false,
  },

  projects: [{ name: 'chromium', use: { ...devices['Pixel 7'], locale: 'zh-TW', timezoneId: 'Asia/Taipei', launchOptions: { args: chromiumGL } } }],
})
