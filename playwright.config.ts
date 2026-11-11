import { defineConfig, devices } from '@playwright/test'

try {
  process.loadEnvFile()
} catch {}

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1'

const port = Number(process.env.E2E_PORT ?? 5199)

const chromiumGL = process.platform === 'darwin'
  ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']

const iphone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-TW',
  timezoneId: 'Asia/Taipei',
}

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',

  use: {
    baseURL: `http://localhost:${port}/`,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },

  webServer: {
    command: `npx vite --port ${port}`,
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Pixel 7'], ...iphone, launchOptions: { args: chromiumGL } },
    },
    {
      name: 'webkit',
      use: { ...devices['iPhone 15'], ...iphone },
    },
  ],
})
