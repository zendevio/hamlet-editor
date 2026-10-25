import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/e2e',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: 0,
	workers: process.env.CI ? 2 : undefined,
	outputDir: process.env.H1_OUTPUT_DIR ?? 'test-results/h1',
	reporter: [['list']],
	use: { baseURL: 'http://127.0.0.1:4175', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'] } },
		{ name: 'webkit', use: { ...devices['Desktop Safari'] } }
	],
	webServer: {
		command: 'pnpm dev --host 127.0.0.1 --port 4175 --strictPort',
		url: 'http://127.0.0.1:4175',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	}
});
