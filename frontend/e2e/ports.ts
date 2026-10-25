// Shared by playwright.config.ts, the stack launcher and the tests. The ports are
// fixed (each Playwright worker re-reads the config) and away from the usual dev
// ports, so a running `npm run dev` or uvicorn does not get in the way.
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export const FAKE_PORT = Number(process.env.E2E_FAKE_PORT ?? 18880)
export const API_PORT = Number(process.env.E2E_API_PORT ?? 18000)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 15173)

export const frontendDir = resolve(import.meta.dirname, '..')
export const backendDir = resolve(frontendDir, '../backend')

/** The interpreter with the backend requirements: $PYTHON, else the repo's .venv, else python3. */
const venvPython = resolve(frontendDir, '../.venv/bin/python')
export const python = process.env.PYTHON ?? (existsSync(venvPython) ? venvPython : 'python3')
