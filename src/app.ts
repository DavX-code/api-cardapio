import fastify, { type FastifyInstance } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'

import { env } from './env.ts'
import { AppError, getPostgresError, PG_ERROR } from './lib/errors.ts'
import { CONSTRAINT_MESSAGES, RESTRICT_MESSAGES } from './lib/constraints.ts'
import { registerRoutes } from './routes/index.ts'

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { transport: undefined, level: 'info' }
        : { level: 'warn' },
  }).withTypeProvider<ZodTypeProvider>()

  /**
   * Um unico "dialeto" de validacao para a API inteira: os mesmos schemas Zod
   * validam a entrada, serializam a saida e geram a documentacao OpenAPI.
   */
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(fastifyCors, { origin: true })

  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'API Cardapio',
        description:
          'API REST de cardapio construida com Fastify, TypeScript e Drizzle ORM sobre PostgreSQL. ' +
          'Modela a hierarquia ufs -> cidades -> empresas -> (categorias, itens, pratos), ' +
          'com relacionamento N:N entre pratos e itens.',
        version: '1.0.0',
      },
      tags: [
        { name: 'UFs', description: 'Unidades federativas' },
        { name: 'Cidades', description: 'Cidades vinculadas a uma UF' },
        { name: 'Empresas', description: 'Estabelecimentos de uma cidade' },
        { name: 'Categorias', description: 'Categorias de itens de uma empresa' },
        { name: 'Itens', description: 'Itens de uma empresa, classificados por categoria' },
        { name: 'Pratos', description: 'Pratos de uma empresa e sua composicao de itens' },
      ],
    },
    transform: jsonSchemaTransform,
  })

  await app.register(fastifySwaggerUi, { routePrefix: '/docs' })

  /**
   * Error handler central.
   *
   * Todo erro da aplicacao passa por aqui e sai no mesmo formato
   * { message, code, details? }. Isso evita `try/catch` repetido em cada rota
   * e garante que nenhum stack trace vaze para o cliente em producao.
   */
  app.setErrorHandler((error, request, reply) => {
    // 1. Corpo/params/query que nao passaram na validacao Zod.
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        message: 'Os dados enviados sao invalidos.',
        code: 'VALIDATION_ERROR',
        details: error.validation.map((issue) => {
          // `params.issue` carrega o ZodIssue original, com path e mensagem.
          const zodIssue = issue.params?.issue as
            | { path?: Array<string | number>; message?: string }
            | undefined

          const campo =
            issue.instancePath.replace(/^\//, '').replace(/\//g, '.') ||
            zodIssue?.path?.join('.') ||
            '(corpo)'

          return { campo, erro: zodIssue?.message ?? issue.message ?? 'Valor invalido.' }
        }),
      })
    }

    // 2. A resposta nao bateu com o schema declarado -- e bug nosso, nao do cliente.
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'Resposta fora do schema declarado')
      return reply.status(500).send({
        message: 'Erro interno ao serializar a resposta.',
        code: 'RESPONSE_SERIALIZATION_ERROR',
      })
    }

    // 3. Erros de dominio lancados pelas rotas.
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        message: error.message,
        code: error.code,
        ...(error.details !== undefined ? { details: error.details } : {}),
      })
    }

    // 4. Erros vindos do PostgreSQL (desembrulhados de dentro do DrizzleQueryError).
    const erroDoBanco = getPostgresError(error)

    if (erroDoBanco) {
      const constraint = erroDoBanco.constraint_name ?? ''

      if (erroDoBanco.code === PG_ERROR.UNIQUE_VIOLATION) {
        return reply.status(409).send({
          message: CONSTRAINT_MESSAGES[constraint] ?? 'Ja existe um registro com esses dados.',
          code: 'UNIQUE_VIOLATION',
        })
      }

      // DELETE barrado porque ainda existem registros dependentes.
      if (erroDoBanco.code === PG_ERROR.RESTRICT_VIOLATION) {
        return reply.status(409).send({
          message:
            RESTRICT_MESSAGES[constraint] ??
            'Nao e possivel excluir: existem registros vinculados a este.',
          code: 'RESTRICT_VIOLATION',
        })
      }

      // Referencia apontando para um registro que nao existe.
      if (erroDoBanco.code === PG_ERROR.FOREIGN_KEY_VIOLATION) {
        return reply.status(409).send({
          message: CONSTRAINT_MESSAGES[constraint] ?? 'Um dos registros relacionados nao existe.',
          code: 'FOREIGN_KEY_VIOLATION',
        })
      }

      if (erroDoBanco.code === PG_ERROR.INVALID_TEXT_REPRESENTATION) {
        return reply.status(400).send({
          message: 'Algum valor enviado tem formato invalido para o seu tipo.',
          code: 'INVALID_INPUT',
        })
      }
    }

    // 5. Qualquer outra coisa.
    request.log.error({ err: error }, 'Erro nao tratado')

    return reply.status(500).send({
      message:
        env.NODE_ENV === 'development' && error instanceof Error
          ? error.message
          : 'Erro interno no servidor.',
      code: 'INTERNAL_SERVER_ERROR',
    })
  })

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      message: `Rota ${request.method} ${request.url} nao existe. Consulte /docs.`,
      code: 'ROUTE_NOT_FOUND',
    })
  })

  await app.register(registerRoutes)

  return app
}
