import { mergeConfig, defineConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'scripts/**/*.test.ts'],
      coverage: {
        // `npm run test:coverage` (CI runs it that way). The thresholds sit just
        // below the current numbers so coverage cannot quietly drop; raise them
        // as coverage grows.
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/test/**', 'src/main.tsx'],
        reporter: ['text-summary', 'html'],
        thresholds: { lines: 55, statements: 55, branches: 53, functions: 59 },
      },
    },
  }),
)
