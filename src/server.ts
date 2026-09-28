import { buildApp } from './app.ts'
import { env } from './env.ts'
import { connection } from './db/client.ts'

const app = await buildApp()

try {
  await app.listen({ port: env.PORT, host: env.HOST })

  console.log(`\n  API no ar em http://localhost:${env.PORT}`)
  console.log(`  Documentacao em http://localhost:${env.PORT}/docs\n`)
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

/**
 * Graceful shutdown: fecha o servidor HTTP e o pool do Postgres antes de sair,
 * para nao deixar conexoes penduradas quando o processo e reiniciado.
 */
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, async () => {
    console.log(`\n[${sinal}] encerrando...`)
    await app.close()
    await connection.end()
    process.exit(0)
  })
}
