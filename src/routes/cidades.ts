import { z } from 'zod'
import { and, asc, eq, ilike } from 'drizzle-orm'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

import { db } from '../db/client.ts'
import { cidades, empresas } from '../db/schema/index.ts'
import { BadRequestError, NotFoundError } from '../lib/errors.ts'
import {
  buildMeta,
  errorResponses,
  paginatedSchema,
  paginationQuerySchema,
  uuidParamSchema,
} from '../lib/validation.ts'

/* -------------------------------------------------------------------------- */
/* Schemas                                                                     */
/* -------------------------------------------------------------------------- */

const cidadeSchema = z.object({
  id: z.uuid(),
  ufId: z.uuid(),
  nome: z.string(),
})

/** Cidade com a UF embutida -- evita um segundo request so para saber o estado. */
const cidadeComUfSchema = cidadeSchema.extend({
  uf: z.object({ id: z.uuid(), sigla: z.string(), nome: z.string() }),
})

const cidadeDetalheSchema = cidadeComUfSchema.extend({
  empresas: z.array(z.object({ id: z.uuid(), nome: z.string(), ativo: z.boolean() })),
})

const criarCidadeSchema = z.object({
  ufId: z.uuid({ message: 'Informe o id (UUID) de uma UF existente.' }),
  nome: z.string().trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(150),
})

const atualizarCidadeSchema = criarCidadeSchema.partial()

const listarCidadesQuerySchema = paginationQuerySchema.extend({
  ufId: z.uuid().optional(),
})

const empresaResumoSchema = z.object({
  id: z.uuid(),
  cidadeId: z.uuid(),
  nome: z.string(),
  cnpj: z.string().nullable(),
  ativo: z.boolean(),
})

/* -------------------------------------------------------------------------- */
/* Rotas                                                                       */
/* -------------------------------------------------------------------------- */

export const cidadesRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ------------------------------- LIST ----------------------------------- */
  app.get(
    '/cidades',
    {
      schema: {
        tags: ['Cidades'],
        summary: 'Lista as cidades',
        description:
          'Cada cidade ja vem com a UF a que pertence. O filtro `ufId` restringe a uma UF.',
        querystring: listarCidadesQuerySchema,
        response: { 200: paginatedSchema(cidadeComUfSchema), ...errorResponses },
      },
    },
    async ({ query }) => {
      const { page, limit, q, ufId } = query

      /**
       * `and(...)` ignora os `undefined`, entao os filtros opcionais podem ser
       * montados de forma declarativa, sem if/else concatenando SQL.
       */
      const filtro = and(
        ufId ? eq(cidades.ufId, ufId) : undefined,
        q ? ilike(cidades.nome, `%${q}%`) : undefined,
      )

      const [data, total] = await Promise.all([
        db.query.cidades.findMany({
          where: filtro,
          columns: { id: true, ufId: true, nome: true },
          with: { uf: { columns: { id: true, sigla: true, nome: true } } },
          orderBy: asc(cidades.nome),
          limit,
          offset: (page - 1) * limit,
        }),
        db.$count(cidades, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------- READ ----------------------------------- */
  app.get(
    '/cidades/:id',
    {
      schema: {
        tags: ['Cidades'],
        summary: 'Busca uma cidade pelo id',
        description: 'Traz a UF (lado N:1) e as empresas da cidade (lado 1:N) na mesma consulta.',
        params: uuidParamSchema,
        response: { 200: cidadeDetalheSchema, ...errorResponses },
      },
    },
    async ({ params }) => {
      const cidade = await db.query.cidades.findFirst({
        where: eq(cidades.id, params.id),
        columns: { id: true, ufId: true, nome: true },
        with: {
          uf: { columns: { id: true, sigla: true, nome: true } },
          empresas: {
            columns: { id: true, nome: true, ativo: true },
            orderBy: asc(empresas.nome),
          },
        },
      })

      if (!cidade) throw new NotFoundError('Cidade', params.id)

      return cidade
    },
  )

  /* ------------------- LIST ANINHADA: empresas da cidade ------------------ */
  app.get(
    '/cidades/:id/empresas',
    {
      schema: {
        tags: ['Cidades'],
        summary: 'Lista as empresas de uma cidade',
        params: uuidParamSchema,
        querystring: paginationQuerySchema,
        response: { 200: paginatedSchema(empresaResumoSchema), ...errorResponses },
      },
    },
    async ({ params, query }) => {
      const { page, limit, q } = query

      const existe = await db.query.cidades.findFirst({
        where: eq(cidades.id, params.id),
        columns: { id: true },
      })
      if (!existe) throw new NotFoundError('Cidade', params.id)

      const filtro = and(
        eq(empresas.cidadeId, params.id),
        q ? ilike(empresas.nome, `%${q}%`) : undefined,
      )

      const [data, total] = await Promise.all([
        db
          .select({
            id: empresas.id,
            cidadeId: empresas.cidadeId,
            nome: empresas.nome,
            cnpj: empresas.cnpj,
            ativo: empresas.ativo,
          })
          .from(empresas)
          .where(filtro)
          .orderBy(asc(empresas.nome))
          .limit(limit)
          .offset((page - 1) * limit),
        db.$count(empresas, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------ CREATE ---------------------------------- */
  app.post(
    '/cidades',
    {
      schema: {
        tags: ['Cidades'],
        summary: 'Cadastra uma cidade',
        description:
          'Se `ufId` nao existir, o proprio banco rejeita pela foreign key e a API responde 409.',
        body: criarCidadeSchema,
        response: { 201: cidadeSchema, ...errorResponses },
      },
    },
    async ({ body }, reply) => {
      const [cidade] = await db.insert(cidades).values(body).returning()
      return reply.status(201).send(cidade!)
    },
  )

  /* ------------------------------ UPDATE ---------------------------------- */
  app.put(
    '/cidades/:id',
    {
      schema: {
        tags: ['Cidades'],
        summary: 'Atualiza uma cidade por completo',
        params: uuidParamSchema,
        body: criarCidadeSchema,
        response: { 200: cidadeSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      const [cidade] = await db
        .update(cidades)
        .set(body)
        .where(eq(cidades.id, params.id))
        .returning()

      if (!cidade) throw new NotFoundError('Cidade', params.id)
      return cidade
    },
  )

  app.patch(
    '/cidades/:id',
    {
      schema: {
        tags: ['Cidades'],
        summary: 'Atualiza parcialmente uma cidade',
        params: uuidParamSchema,
        body: atualizarCidadeSchema,
        response: { 200: cidadeSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      if (Object.keys(body).length === 0) {
        throw new BadRequestError('Informe ao menos um campo para atualizar.')
      }

      const [cidade] = await db
        .update(cidades)
        .set(body)
        .where(eq(cidades.id, params.id))
        .returning()

      if (!cidade) throw new NotFoundError('Cidade', params.id)
      return cidade
    },
  )

  /* ------------------------------ DELETE ---------------------------------- */
  app.delete(
    '/cidades/:id',
    {
      schema: {
        tags: ['Cidades'],
        summary: 'Remove uma cidade',
        description: 'Falha com 409 se ainda houver empresas vinculadas.',
        params: uuidParamSchema,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async ({ params }, reply) => {
      const [cidade] = await db
        .delete(cidades)
        .where(eq(cidades.id, params.id))
        .returning({ id: cidades.id })

      if (!cidade) throw new NotFoundError('Cidade', params.id)

      return reply.status(204).send(null)
    },
  )
}
