import { z } from 'zod'
import { and, asc, eq, ilike, or } from 'drizzle-orm'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

import { db } from '../db/client.ts'
import { ufs, cidades } from '../db/schema/index.ts'
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

const ufSchema = z.object({
  id: z.uuid(),
  sigla: z.string(),
  nome: z.string(),
})

const cidadeResumoSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
})

const ufComCidadesSchema = ufSchema.extend({
  cidades: z.array(cidadeResumoSchema),
})

const criarUfSchema = z.object({
  sigla: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, 'A sigla deve ter exatamente 2 letras (ex.: SP).'),
  nome: z.string().trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(100),
})

const atualizarUfSchema = criarUfSchema.partial()

/* -------------------------------------------------------------------------- */
/* Rotas                                                                       */
/* -------------------------------------------------------------------------- */

export const ufsRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ------------------------------- LIST ----------------------------------- */
  app.get(
    '/ufs',
    {
      schema: {
        tags: ['UFs'],
        summary: 'Lista as UFs',
        description: 'Retorna as UFs paginadas. O parametro `q` busca por sigla ou nome.',
        querystring: paginationQuerySchema,
        response: { 200: paginatedSchema(ufSchema), ...errorResponses },
      },
    },
    async ({ query }) => {
      const { page, limit, q } = query
      const filtro = q ? or(ilike(ufs.nome, `%${q}%`), ilike(ufs.sigla, `%${q}%`)) : undefined

      const [data, total] = await Promise.all([
        db
          .select({ id: ufs.id, sigla: ufs.sigla, nome: ufs.nome })
          .from(ufs)
          .where(filtro)
          .orderBy(asc(ufs.sigla))
          .limit(limit)
          .offset((page - 1) * limit),
        db.$count(ufs, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------- READ ----------------------------------- */
  app.get(
    '/ufs/:id',
    {
      schema: {
        tags: ['UFs'],
        summary: 'Busca uma UF pelo id',
        description: 'Retorna a UF junto com as cidades relacionadas (relacionamento 1:N).',
        params: uuidParamSchema,
        response: { 200: ufComCidadesSchema, ...errorResponses },
      },
    },
    async ({ params }) => {
      /**
       * `db.query` + `with` e a Relational Query API do Drizzle: ela resolve
       * a UF e suas cidades numa unica ida ao banco, ja devolvendo o objeto
       * aninhado e tipado -- sem o "N+1" de buscar as cidades num segundo loop.
       */
      const uf = await db.query.ufs.findFirst({
        where: eq(ufs.id, params.id),
        columns: { id: true, sigla: true, nome: true },
        with: {
          cidades: {
            columns: { id: true, nome: true },
            orderBy: asc(cidades.nome),
          },
        },
      })

      if (!uf) throw new NotFoundError('UF', params.id)

      return uf
    },
  )

  /* -------------------- LIST ANINHADA: cidades da UF ---------------------- */
  app.get(
    '/ufs/:id/cidades',
    {
      schema: {
        tags: ['UFs'],
        summary: 'Lista as cidades de uma UF',
        params: uuidParamSchema,
        querystring: paginationQuerySchema,
        response: {
          200: paginatedSchema(z.object({ id: z.uuid(), ufId: z.uuid(), nome: z.string() })),
          ...errorResponses,
        },
      },
    },
    async ({ params, query }) => {
      const { page, limit, q } = query

      const existe = await db.query.ufs.findFirst({
        where: eq(ufs.id, params.id),
        columns: { id: true },
      })
      if (!existe) throw new NotFoundError('UF', params.id)

      const filtro = and(
        eq(cidades.ufId, params.id),
        q ? ilike(cidades.nome, `%${q}%`) : undefined,
      )

      const [data, total] = await Promise.all([
        db
          .select({ id: cidades.id, ufId: cidades.ufId, nome: cidades.nome })
          .from(cidades)
          .where(filtro)
          .orderBy(asc(cidades.nome))
          .limit(limit)
          .offset((page - 1) * limit),
        db.$count(cidades, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------ CREATE ---------------------------------- */
  app.post(
    '/ufs',
    {
      schema: {
        tags: ['UFs'],
        summary: 'Cadastra uma UF',
        body: criarUfSchema,
        response: { 201: ufSchema, ...errorResponses },
      },
    },
    async ({ body }, reply) => {
      const [uf] = await db.insert(ufs).values(body).returning()
      // O INSERT com RETURNING sempre devolve uma linha; o `!` apenas informa
      // isso ao TypeScript, que nao tem como saber o tamanho do array.
      return reply.status(201).send(uf!)
    },
  )

  /* ------------------------------ UPDATE ---------------------------------- */
  app.put(
    '/ufs/:id',
    {
      schema: {
        tags: ['UFs'],
        summary: 'Atualiza uma UF por completo',
        params: uuidParamSchema,
        body: criarUfSchema,
        response: { 200: ufSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      const [uf] = await db.update(ufs).set(body).where(eq(ufs.id, params.id)).returning()
      if (!uf) throw new NotFoundError('UF', params.id)
      return uf
    },
  )

  app.patch(
    '/ufs/:id',
    {
      schema: {
        tags: ['UFs'],
        summary: 'Atualiza parcialmente uma UF',
        params: uuidParamSchema,
        body: atualizarUfSchema,
        response: { 200: ufSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      if (Object.keys(body).length === 0) {
        throw new BadRequestError('Informe ao menos um campo para atualizar.')
      }

      const [uf] = await db.update(ufs).set(body).where(eq(ufs.id, params.id)).returning()
      if (!uf) throw new NotFoundError('UF', params.id)
      return uf
    },
  )

  /* ------------------------------ DELETE ---------------------------------- */
  app.delete(
    '/ufs/:id',
    {
      schema: {
        tags: ['UFs'],
        summary: 'Remove uma UF',
        description:
          'Falha com 409 se a UF ainda possuir cidades vinculadas (onDelete: restrict).',
        params: uuidParamSchema,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async ({ params }, reply) => {
      const [uf] = await db
        .delete(ufs)
        .where(eq(ufs.id, params.id))
        .returning({ id: ufs.id })

      if (!uf) throw new NotFoundError('UF', params.id)

      return reply.status(204).send(null)
    },
  )
}
