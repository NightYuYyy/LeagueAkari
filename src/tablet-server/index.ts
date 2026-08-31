import { ZodError } from 'zod'

import { loadTabletServerConfig } from './config'
import { createTabletHttpServer } from './http-server'

try {
  const config = loadTabletServerConfig()
  const server = createTabletHttpServer(config)
  server.listen(config.port, config.host, () => {
    console.log(
      `[tablet-server] listening on http://${config.host}:${config.port}/room/${config.roomCode}`
    )
  })
} catch (error) {
  if (error instanceof ZodError) {
    console.error('[tablet-server] invalid configuration', error.issues)
  } else {
    console.error('[tablet-server] failed to start', error)
  }
  process.exitCode = 1
}
