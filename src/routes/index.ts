import { z } from 'zod'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

import { ufsRoutes } from './ufs.ts'
import { cidadesRoutes } from './cidades.ts'
import { empresasRoutes } from './empresas.ts'
import { categoriasRoutes } from './categorias.ts'
import { itensRoutes } from './itens.ts'
import { pratosRoutes } from './pratos.ts'

/**
 * Ponto unico de registro das rotas.
 *
 * Cada recurso e um plugin Fastify independente: encapsulado, registrado aqui
 * e sem conhecer os outros. Para adicionar um recurso novo basta criar o
 * arquivo e acrescentar uma linha abaixo.
 */
export const registerRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['Sistema'],
        summary: 'Verifica se a API esta no ar',
        response: {
          200: z.object({ status: z.literal('ok'), uptime: z.number() }),
        },
      },
    },
    async () => ({ status: 'ok' as const, uptime: process.uptime() }),
  )

  await app.register(ufsRoutes)
  await app.register(cidadesRoutes)
  await app.register(empresasRoutes)
  await app.register(categoriasRoutes)
  await app.register(itensRoutes)
  await app.register(pratosRoutes)
}
