import { z } from 'zod'
import { and, asc, eq, ilike } from 'drizzle-orm'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

import { db } from '../db/client.ts'
import { categorias, itens } from '../db/schema/index.ts'
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

const categoriaSchema = z.object({
  id: z.uuid(),
  empresaId: z.uuid(),
  nome: z.string(),
})

const categoriaComEmpresaSchema = categoriaSchema.extend({
  empresa: z.object({ id: z.uuid(), nome: z.string() }),
})

const categoriaDetalheSchema = categoriaComEmpresaSchema.extend({
  itens: z.array(
    z.object({ id: z.uuid(), nome: z.string(), preco: z.number(), ativo: z.boolean() }),
  ),
})

const criarCategoriaSchema = z.object({
  empresaId: z.uuid({ message: 'Informe o id (UUID) de uma empresa existente.' }),
  nome: z.string().trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(100),
})

const atualizarCategoriaSchema = criarCategoriaSchema.partial()

const listarCategoriasQuerySchema = paginationQuerySchema.extend({
  empresaId: z.uuid().optional(),
})

const itemResumoSchema = z.object({
  id: z.uuid(),
  empresaId: z.uuid(),
  categoriaId: z.uuid(),
  nome: z.string(),
  preco: z.number(),
  ativo: z.boolean(),
})

/* -------------------------------------------------------------------------- */
/* Rotas                                                                       */
/* -------------------------------------------------------------------------- */

export const categoriasRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ------------------------------- LIST ----------------------------------- */
  app.get(
    '/categorias',
    {
      schema: {
        tags: ['Categorias'],
        summary: 'Lista as categorias',
        description: 'Filtros: `q` (nome) e `empresaId`.',
        querystring: listarCategoriasQuerySchema,
        response: { 200: paginatedSchema(categoriaComEmpresaSchema), ...errorResponses },
      },
    },
    async ({ query }) => {
      const { page, limit, q, empresaId } = query

      const filtro = and(
        empresaId ? eq(categorias.empresaId, empresaId) : undefined,
        q ? ilike(categorias.nome, `%${q}%`) : undefined,
      )

      const [data, total] = await Promise.all([
        db.query.categorias.findMany({
          where: filtro,
          columns: { id: true, empresaId: true, nome: true },
          with: { empresa: { columns: { id: true, nome: true } } },
          orderBy: asc(categorias.nome),
          limit,
          offset: (page - 1) * limit,
        }),
        db.$count(categorias, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------- READ ----------------------------------- */
  app.get(
    '/categorias/:id',
    {
      schema: {
        tags: ['Categorias'],
        summary: 'Busca uma categoria pelo id',
        description: 'Retorna a empresa dona da categoria e os itens classificados nela.',
        params: uuidParamSchema,
        response: { 200: categoriaDetalheSchema, ...errorResponses },
      },
    },
    async ({ params }) => {
      const categoria = await db.query.categorias.findFirst({
        where: eq(categorias.id, params.id),
        columns: { id: true, empresaId: true, nome: true },
        with: {
          empresa: { columns: { id: true, nome: true } },
          itens: {
            columns: { id: true, nome: true, preco: true, ativo: true },
            orderBy: asc(itens.nome),
          },
        },
      })

      if (!categoria) throw new NotFoundError('Categoria', params.id)

      return categoria
    },
  )

  /* -------------------- LIST ANINHADA: itens da categoria ----------------- */
  app.get(
    '/categorias/:id/itens',
    {
      schema: {
        tags: ['Categorias'],
        summary: 'Lista os itens de uma categoria',
        params: uuidParamSchema,
        querystring: paginationQuerySchema,
        response: { 200: paginatedSchema(itemResumoSchema), ...errorResponses },
      },
    },
    async ({ params, query }) => {
      const { page, limit, q } = query

      const existe = await db.query.categorias.findFirst({
        where: eq(categorias.id, params.id),
        columns: { id: true },
      })
      if (!existe) throw new NotFoundError('Categoria', params.id)

      const filtro = and(
        eq(itens.categoriaId, params.id),
        q ? ilike(itens.nome, `%${q}%`) : undefined,
      )

      const [data, total] = await Promise.all([
        db
          .select({
            id: itens.id,
            empresaId: itens.empresaId,
            categoriaId: itens.categoriaId,
            nome: itens.nome,
            preco: itens.preco,
            ativo: itens.ativo,
          })
          .from(itens)
          .where(filtro)
          .orderBy(asc(itens.nome))
          .limit(limit)
          .offset((page - 1) * limit),
        db.$count(itens, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------ CREATE ---------------------------------- */
  app.post(
    '/categorias',
    {
      schema: {
        tags: ['Categorias'],
        summary: 'Cadastra uma categoria',
        description: 'O nome da categoria e unico dentro de cada empresa.',
        body: criarCategoriaSchema,
        response: { 201: categoriaSchema, ...errorResponses },
      },
    },
    async ({ body }, reply) => {
      const [categoria] = await db.insert(categorias).values(body).returning()
      return reply.status(201).send(categoria!)
    },
  )

  /* ------------------------------ UPDATE ---------------------------------- */
  app.put(
    '/categorias/:id',
    {
      schema: {
        tags: ['Categorias'],
        summary: 'Atualiza uma categoria por completo',
        params: uuidParamSchema,
        body: criarCategoriaSchema,
        response: { 200: categoriaSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      const [categoria] = await db
        .update(categorias)
        .set(body)
        .where(eq(categorias.id, params.id))
        .returning()

      if (!categoria) throw new NotFoundError('Categoria', params.id)
      return categoria
    },
  )

  app.patch(
    '/categorias/:id',
    {
      schema: {
        tags: ['Categorias'],
        summary: 'Atualiza parcialmente uma categoria',
        params: uuidParamSchema,
        body: atualizarCategoriaSchema,
        response: { 200: categoriaSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      if (Object.keys(body).length === 0) {
        throw new BadRequestError('Informe ao menos um campo para atualizar.')
      }

      const [categoria] = await db
        .update(categorias)
        .set(body)
        .where(eq(categorias.id, params.id))
        .returning()

      if (!categoria) throw new NotFoundError('Categoria', params.id)
      return categoria
    },
  )

  /* ------------------------------ DELETE ---------------------------------- */
  app.delete(
    '/categorias/:id',
    {
      schema: {
        tags: ['Categorias'],
        summary: 'Remove uma categoria',
        description:
          'Falha com 409 se a categoria ainda classificar itens (onDelete: restrict). ' +
          'Reclassifique ou remova os itens antes.',
        params: uuidParamSchema,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async ({ params }, reply) => {
      const [categoria] = await db
        .delete(categorias)
        .where(eq(categorias.id, params.id))
        .returning({ id: categorias.id })

      if (!categoria) throw new NotFoundError('Categoria', params.id)

      return reply.status(204).send(null)
    },
  )
}
