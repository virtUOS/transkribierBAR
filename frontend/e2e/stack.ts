// Starts the backend for the end-to-end tests, together with the fake ASR/LLM
// services (backend/scripts/fake_services.py), on a fresh database in a temp
// dir. Playwright runs this as a web server (see playwright.config.ts) and
// stops it after the run; the temp dir goes with it.
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { API_PORT, FAKE_PORT, backendDir, python } from './ports.ts'

const tempDir = mkdtempSync(join(tmpdir(), 'transkribierbar-e2e-'))
const fakeUrl = `http://127.0.0.1:${FAKE_PORT}`
const children: ChildProcess[] = []

function start(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const child = spawn(python, args, { cwd: backendDir, env, stdio: 'inherit' })
  child.once('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[e2e] ${args.join(' ')} exited (${code ?? signal})`)
      stop(1)
    }
  })
  children.push(child)
  return child
}

let stopping = false
function stop(code = 0): void {
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  rmSync(tempDir, { recursive: true, force: true })
  process.exit(code)
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`${url} did not come up`)
}

start(['-m', 'scripts.fake_services', '--port', String(FAKE_PORT)], process.env)
await waitFor(`${fakeUrl}/_fake/health`)

// Every setting the backend reads from the environment that could reach a real
// service is set here, since load_dotenv() fills in anything left unset from a
// developer's backend/.env.
start(['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(API_PORT), '--log-level', 'warning'], {
  ...process.env,
  DEV_MODE: 'true',
  DATABASE_PATH: join(tempDir, 'e2e.db'),
  TEMP_PATH: join(tempDir, 'files'),
  STATIC_DIR: join(tempDir, 'no-static'),
  ASR_BACKEND: 'murmurai',
  ASR_URL: fakeUrl,
  ASR_API_KEY: '',
  WHISPER_MODELS: 'base,large-v3-turbo',
  DEFAULT_WHISPER_MODEL: 'base',
  LLM_PROVIDER: 'openai',
  LLM_MODEL: 'fake',
  LLM_API_KEY: 'fake',
  LLM_BASE_URL: `${fakeUrl}/v1`,
  ENABLE_API_TOKENS: 'true',
  ENABLE_METRICS: 'true',
  INVITATION_MODE: 'false',
  CONTACT_EMAIL: 'help@example.org',
  SMTP_HOST: '',
  SMTP_PASSWORD: '',
  KEYCLOAK_ADMIN_URL: '',
  KEYCLOAK_ADMIN_CLIENT_SECRET: '',
  PRIVACY_NOTICE_FILE_DE: '',
  PRIVACY_NOTICE_FILE_EN: '',
})
