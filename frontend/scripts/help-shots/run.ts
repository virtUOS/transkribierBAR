// Screenshot runner for the help content. Usage (from frontend/):
//   npm run help:shots [-- --only <id>]
// Set PYTHON to the interpreter that has the backend requirements.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, createWriteStream, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { clipFor, computeMarks, unionBox, type Box } from './marks.ts'
import { shots } from './shots.ts'

const frontendDir = resolve(import.meta.dirname, '../..')
const backendDir = resolve(frontendDir, '../backend')
const outRoot = join(frontendDir, 'src/help/shots')
const python = process.env.PYTHON ?? 'python3'
const TZ = 'Europe/Berlin'
const LANGS = ['de', 'en'] as const
const OUTSIDE = 'http://127.0.0.1:9' // nothing listens here; real ASR/LLM hosts are never contacted
const VIEWPORT = { width: 1280, height: 800 }
/** Px between a control and its marker frame, so the numbered badge does not cover the control's corner. */
const MARK_MARGIN = 8

const children: ChildProcess[] = []
let tempDir = ''

function log(msg: string): void {
  console.log(`[help:shots] ${msg}`)
}

function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.once('error', rej)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number }
      srv.close(() => res(port))
    })
  })
}

async function waitFor(url: string, what: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`${what} did not become ready at ${url}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

function start(cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }, logPath: string): ChildProcess {
  const out = createWriteStream(logPath)
  const child = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.pipe(out)
  child.stderr?.pipe(out)
  children.push(child)
  return child
}

function stopChildren(): void {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      setTimeout(() => child.kill('SIGKILL'), 2000).unref()
    }
  }
}

function cleanup(): void {
  stopChildren()
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
}

/** Today's date in Berlin as YYYY-MM-DD, and 10:00 Berlin wall time that day as a Date. */
function berlinToday(): { date: string; at10: Date } {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
  const [y, m, d] = date.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 10)
  const wall = new Date(new Date(guess).toLocaleString('en-US', { timeZone: TZ }))
  const offset = Date.UTC(wall.getFullYear(), wall.getMonth(), wall.getDate(), wall.getHours(), wall.getMinutes()) - guess
  return { date, at10: new Date(guess - offset) }
}

function isLocal(url: string): boolean {
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return true
  const { hostname } = new URL(url)
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

async function main(): Promise<void> {
  const onlyIdx = process.argv.indexOf('--only')
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : undefined
  const specs = shots.filter((s) => !only || s.id === only)
  if (specs.length === 0) throw new Error(`no shot spec matches --only ${only}`)

  tempDir = mkdtempSync(join(tmpdir(), 'help-shots-'))
  const { date, at10 } = berlinToday()
  log(`temp dir ${tempDir}, base date ${date}`)

  // Tiny generated audio file for the upload.
  const audio = join(tempDir, 'sample.mp3')
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audio])
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr?.toString() ?? ff.error?.message}`)
  process.env.HELP_SHOTS_AUDIO = audio

  // Seed the demo database.
  const dbPath = join(tempDir, 'demo.db')
  const seed = spawnSync(
    python,
    ['-m', 'scripts.seed_help_demo', '--db', dbPath, '--media-dir', join(tempDir, 'media'), '--base-date', date],
    { cwd: backendDir, encoding: 'utf8' },
  )
  if (seed.status !== 0) throw new Error(`seeding failed (PYTHON=${python}): ${seed.stderr || seed.error?.message}`)

  const backendEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DEV_MODE: 'true',
    DATABASE_PATH: dbPath,
    TEMP_PATH: join(tempDir, 'files'),
    WHISPER_MODELS: 'large-v3-turbo,large-v3',
    DEFAULT_WHISPER_MODEL: 'large-v3-turbo',
    LLM_PROVIDER: 'openai',
    LLM_MODEL: 'demo',
    // Secret-looking keys of the repo .env must not reach the screenshot backend.
    ASR_API_KEY: '',
    LLM_API_KEY: 'unused',
    SMTP_PASSWORD: '',
    KEYCLOAK_ADMIN_CLIENT_SECRET: '',
    ASR_URL: OUTSIDE,
    LLM_BASE_URL: OUTSIDE,
    ENABLE_API_TOKENS: 'true',
    ENABLE_METRICS: 'false',
    CONTACT_EMAIL: 'hilfe@example.org',
  }
  log(`effective ASR_URL=${backendEnv.ASR_URL} LLM_BASE_URL=${backendEnv.LLM_BASE_URL}`)

  const apiPort = await freePort()
  const webPort = await freePort()
  const apiLog = join(tempDir, 'uvicorn.log')
  start(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(apiPort)], { cwd: backendDir, env: backendEnv }, apiLog)
  start(
    join(frontendDir, 'node_modules/.bin/vite'),
    ['--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    { cwd: frontendDir, env: { ...process.env, VITE_API_TARGET: `http://127.0.0.1:${apiPort}` } },
    join(tempDir, 'vite.log'),
  )
  for (const child of children) {
    child.once('exit', (code) => {
      if (code !== null && code !== 0 && code !== 143) log(`child exited early with code ${code}`)
    })
  }
  await waitFor(`http://127.0.0.1:${apiPort}/api/config`, 'backend')
  await waitFor(`http://127.0.0.1:${webPort}/`, 'vite')
  log(`backend :${apiPort}, frontend :${webPort}`)

  const browser = await chromium.launch()
  const outside: string[] = []
  try {
    for (const lang of LANGS) {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        timezoneId: TZ,
        // The app picks its language from navigator.language (src/i18n/index.ts), so the locale sets it.
        locale: lang === 'de' ? 'de-DE' : 'en-US',
      })
      await context.route('**/*', (route) => {
        const url = route.request().url()
        if (isLocal(url)) return route.continue()
        outside.push(url)
        return route.abort()
      })
      const page = await context.newPage()
      await page.clock.setFixedTime(at10)
      const dir = join(outRoot, lang)
      mkdirSync(dir, { recursive: true })

      for (const spec of specs) {
        // Stubs are per spec: none may leak into the next one.
        await page.unrouteAll({ behavior: 'ignoreErrors' })
        await page.goto(`http://127.0.0.1:${webPort}/`)
        await page.waitForLoadState('load')
        await spec.prepare(page, lang)
        await page.evaluate('document.fonts.ready')

        const box = async (selector: string): Promise<Box | null> => {
          try {
            const b = await page.locator(selector).first().boundingBox({ timeout: 3000 })
            return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : null
          } catch {
            return null
          }
        }
        const clipSelectors = typeof spec.clip === 'string' ? [spec.clip] : spec.clip
        const clipBoxes: Box[] = []
        for (const selector of clipSelectors) {
          const b = await box(selector)
          if (!b) throw new Error(`clip ${selector} not found for ${spec.id}`)
          clipBoxes.push(b)
        }
        const clip = clipFor(clipBoxes, spec.pad ?? 0, VIEWPORT)
        // A mark given as several selectors frames all of their elements together.
        const markBox = async (mark: string | string[]): Promise<Box | null> => {
          const found = await Promise.all((typeof mark === 'string' ? [mark] : mark).map(box))
          return found.includes(null) ? null : unionBox(found as Box[])
        }
        const boxes = await Promise.all(spec.marks.map(markBox))
        const meta = computeMarks(clip, boxes, spec.marks.map((m) => [m].flat().join(' + ')), MARK_MARGIN)
        await page.screenshot({
          path: join(dir, `${spec.id}.png`),
          animations: 'disabled',
          clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h },
        })
        writeFileSync(join(dir, `${spec.id}.json`), `${JSON.stringify(meta, null, 2)}\n`)
        log(`wrote ${lang}/${spec.id}.png and .json`)
      }
      await context.close()
    }
  } finally {
    await browser.close()
  }

  if (outside.length > 0) throw new Error(`the page requested outside hosts: ${[...new Set(outside)].join(', ')}`)
  const requests = readFileSync(apiLog, 'utf8').split('\n').filter((l) => /"(GET|POST|PUT|DELETE|PATCH) /.test(l))
  log(`browser made no outside requests; uvicorn served ${requests.length} requests (log: ${apiLog}, removed at exit)`)
  if (process.env.HELP_SHOTS_SHOW_LOG) console.log(requests.join('\n'))
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    cleanup()
    process.exit(130)
  })
}

try {
  await main()
  cleanup()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  cleanup()
  process.exit(1)
}
