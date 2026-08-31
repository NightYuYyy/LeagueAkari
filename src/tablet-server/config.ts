import { z } from 'zod'

const serverConfigSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  roomCode: z
    .string()
    .trim()
    .min(4)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/),
  publishToken: z.string().min(16).max(256),
  webRoot: z.string().trim().optional()
})

export type TabletServerConfig = z.infer<typeof serverConfigSchema>

export function loadTabletServerConfig(env: NodeJS.ProcessEnv = process.env): TabletServerConfig {
  return serverConfigSchema.parse({
    host: env.HOST ?? '0.0.0.0',
    port: env.PORT ?? '4174',
    roomCode: env.TABLET_ROOM_CODE,
    publishToken: env.TABLET_PUBLISH_TOKEN,
    webRoot: env.TABLET_WEB_ROOT || undefined
  })
}
