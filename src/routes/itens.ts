import { z } from 'zod'
import { and, asc, eq, ilike } from 'drizzle-orm'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

import { db } from '../db/client.ts'
import { categorias, itens } from '../db/schema/index.ts'
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.ts'
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

const itemSchema = z.object({
  id: z.uuid(),
  empresaId: z.uuid(),
  categoriaId: z.uuid(),
  nome: z.string(),
  preco: z.number(),
  ativo: z.boolean(),
})

const itemComRelacoesSchema = itemSchema.extend({
  empresa: z.object({ id: z.uuid(), nome: z.string() }),
  categoria: z.object({ id: z.uuid(), nome: z.string() }),
})

const itemDetalheSchema = itemComRelacoesSchema.extend({
  /** Pratos que usam este item -- o N:N visto a partir do lado do item. */
  pratos: z.array(z.object({ id: z.uuid(), nome: z.string(), preco: z.number() })),
})

/**
 * Preco em reais com ate 2 casas. `multipleOf(0.01)` rejeita 10.999 antes que
 * o Postgres arredonde silenciosamente ao gravar em numeric(10,2).
 */
const precoSchema = z
  .number()
  .nonnegative('O preco nao pode ser negativo.')
  .max(99_999_999.99, 'O preco excede o limite de numeric(10,2).')
  .multipleOf(0.01, 'O preco deve ter no maximo 2 casas decimais.')

const criarItemSchema = z.object({
  empresaId: z.uuid({ message: 'Informe o id (UUID) de uma empresa existente.' }),
  categoriaId: z.uuid({ message: 'Informe o id (UUID) de uma categoria existente.' }),
  nome: z.string().trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(150),
  preco: precoSchema.default(0),
  ativo: z.boolean().default(true),
})

const atualizarItemSchema = criarItemSchema.partial()

const listarItensQuerySchema = paginationQuerySchema.extend({
  empresaId: z.uuid().optional(),
  categoriaId: z.uuid().optional(),
  ativo: z.stringbool().optional(),
})

/* -------------------------------------------------------------------------- */
/* Rotas                                                                       */
/* -------------------------------------------------------------------------- */

export const itensRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ------------------------------- LIST ----------------------------------- */
  app.get(
    '/itens',
    {
      schema: {
        tags: ['Itens'],
        summary: 'Lista os itens',
        description: 'Filtros: `q` (nome), `empresaId`, `categoriaId` e `ativo`.',
        querystring: listarItensQuerySchema,
        response: { 200: paginatedSchema(itemComRelacoesSchema), ...errorResponses },
      },
    },
    async ({ query }) => {
      const { page, limit, q, empresaId, categoriaId, ativo } = query

      const filtro = and(
        empresaId ? eq(itens.empresaId, empresaId) : undefined,
        categoriaId ? eq(itens.categoriaId, categoriaId) : undefined,
        ativo === undefined ? undefined : eq(itens.ativo, ativo),
        q ? ilike(itens.nome, `%${q}%`) : undefined,
      )

      const [data, total] = await Promise.all([
        db.query.itens.findMany({
          where: filtro,
          columns: {
            id: true,
            empresaId: true,
            categoriaId: true,
            nome: true,
            preco: true,
            ativo: true,
          },
          with: {
            empresa: { columns: { id: true, nome: true } },
            categoria: { columns: { id: true, nome: true } },
          },
          orderBy: asc(itens.nome),
          limit,
          offset: (page - 1) * limit,
        }),
        db.$count(itens, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------- READ ----------------------------------- */
  app.get(
    '/itens/:id',
    {
      schema: {
        tags: ['Itens'],
        summary: 'Busca um item pelo id',
        description:
          'Alem de empresa e categoria, lista os pratos que utilizam este item. ' +
          'Como o N:N passa por prato_itens, a lista e achatada antes de sair na resposta.',
        params: uuidParamSchema,
        response: { 200: itemDetalheSchema, ...errorResponses },
      },
    },
    async ({ params }) => {
      const item = await db.query.itens.findFirst({
        where: eq(itens.id, params.id),
        columns: {
          id: true,
          empresaId: true,
          categoriaId: true,
          nome: true,
          preco: true,
          ativo: true,
        },
        with: {
          empresa: { columns: { id: true, nome: true } },
          categoria: { columns: { id: true, nome: true } },
          pratoItens: {
            columns: {},
            with: { prato: { columns: { id: true, nome: true, preco: true } } },
          },
        },
      })

      if (!item) throw new NotFoundError('Item', params.id)

      const { pratoItens, ...resto } = item

      return { ...resto, pratos: pratoItens.map((vinculo) => vinculo.prato) }
    },
  )

  /* ------------------------------ CREATE ---------------------------------- */
  app.post(
    '/itens',
    {
      schema: {
        tags: ['Itens'],
        summary: 'Cadastra um item',
        description:
          'A categoria informada precisa pertencer a mesma empresa do item, ' +
          'caso contrario a API responde 409.',
        body: criarItemSchema,
        response: { 201: itemSchema, ...errorResponses },
      },
    },
    async ({ body }, reply) => {
      await garantirCategoriaDaEmpresa(body.categoriaId, body.empresaId)

      const [item] = await db.insert(itens).values(body).returning()
      return reply.status(201).send(item!)
    },
  )

  /* ------------------------------ UPDATE ---------------------------------- */
  app.put(
    '/itens/:id',
    {
      schema: {
        tags: ['Itens'],
        summary: 'Atualiza um item por completo',
        params: uuidParamSchema,
        body: criarItemSchema,
        response: { 200: itemSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      await garantirCategoriaDaEmpresa(body.categoriaId, body.empresaId)

      const [item] = await db.update(itens).set(body).where(eq(itens.id, params.id)).returning()

      if (!item) throw new NotFoundError('Item', params.id)
      return item
    },
  )

  app.patch(
    '/itens/:id',
    {
      schema: {
        tags: ['Itens'],
        summary: 'Atualiza parcialmente um item',
        params: uuidParamSchema,
        body: atualizarItemSchema,
        response: { 200: itemSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      if (Object.keys(body).length === 0) {
        throw new BadRequestError('Informe ao menos um campo para atualizar.')
      }

      const atual = await db.query.itens.findFirst({
        where: eq(itens.id, params.id),
        columns: { empresaId: true, categoriaId: true },
      })
      if (!atual) throw new NotFoundError('Item', params.id)

      /**
       * Num PATCH, empresa e categoria podem vir separadas. A coerencia precisa
       * ser avaliada sobre o estado FINAL do registro -- o que veio no corpo
       * combinado com o que ja estava gravado.
       */
      const empresaFinal = body.empresaId ?? atual.empresaId
      const categoriaFinal = body.categoriaId ?? atual.categoriaId

      if (body.empresaId || body.categoriaId) {
        await garantirCategoriaDaEmpresa(categoriaFinal, empresaFinal)
      }

      const [item] = await db.update(itens).set(body).where(eq(itens.id, params.id)).returning()

      if (!item) throw new NotFoundError('Item', params.id)
      return item
    },
  )

  /* ------------------------------ DELETE ---------------------------------- */
  app.delete(
    '/itens/:id',
    {
      schema: {
        tags: ['Itens'],
        summary: 'Remove um item',
        description:
          'Os vinculos em prato_itens sao removidos junto (onDelete: cascade), ' +
          'entao o item some automaticamente da composicao dos pratos.',
        params: uuidParamSchema,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async ({ params }, reply) => {
      const [item] = await db
        .delete(itens)
        .where(eq(itens.id, params.id))
        .returning({ id: itens.id })

      if (!item) throw new NotFoundError('Item', params.id)

      return reply.status(204).send(null)
    },
  )
}

/**
 * Regra de negocio que o banco sozinho nao garante.
 *
 * A tabela `itens` tem duas FKs independentes (empresa_id e categoria_id).
 * Cada uma isoladamente e valida, mas nada impede gravar um item da empresa A
 * apontando para uma categoria da empresa B. Garantir isso no banco exigiria
 * uma FK composta; aqui a verificacao fica explicita na aplicacao.
 */
async function garantirCategoriaDaEmpresa(
  categoriaId: string,
  empresaId: string,
): Promise<void> {
  const categoria = await db.query.categorias.findFirst({
    where: eq(categorias.id, categoriaId),
    columns: { id: true, empresaId: true },
  })

  if (!categoria) throw new NotFoundError('Categoria', categoriaId)

  if (categoria.empresaId !== empresaId) {
    throw new ConflictError(
      'A categoria informada pertence a outra empresa. ' +
        'Um item so pode usar categorias da propria empresa.',
    )
  }
}
