// Imported first by every entry point so environment variables are loaded before
// any other module runs. Reads <backend root>/.env when present; on Render/Railway
// the variables are injected and no file is needed.
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(here, '../../.env') })
