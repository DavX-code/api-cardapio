import { z } from 'zod'
import { and, asc, count, eq, ilike, inArray } from 'drizzle-orm'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

import { db } from '../db/client.ts'
import { itens, pratoItens, pratos } from '../db/schema/index.ts'
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

const pratoSchema = z.object({
  id: z.uuid(),
  empresaId: z.uuid(),
  nome: z.string(),
  descricao: z.string().nullable(),
  preco: z.number(),
  ativo: z.boolean(),
})

const pratoComEmpresaSchema = pratoSchema.extend({
  empresa: z.object({ id: z.uuid(), nome: z.string() }),
})

const itemDoPratoSchema = z.object({
  id: z.uuid(),
  nome: z.string(),
  preco: z.number(),
  ativo: z.boolean(),
  categoria: z.object({ id: z.uuid(), nome: z.string() }),
})

const pratoDetalheSchema = pratoComEmpresaSchema.extend({
  itens: z.array(itemDoPratoSchema),
  /** Soma dos precos dos itens -- util para comparar com o preco de venda. */
  custoItens: z.number(),
})

const precoSchema = z
  .number()
  .nonnegative('O preco nao pode ser negativo.')
  .max(99_999_999.99, 'O preco excede o limite de numeric(10,2).')
  .multipleOf(0.01, 'O preco deve ter no maximo 2 casas decimais.')

const criarPratoSchema = z.object({
  empresaId: z.uuid({ message: 'Informe o id (UUID) de uma empresa existente.' }),
  nome: z.string().trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(150),
  descricao: z.string().trim().max(2000).nullish(),
  preco: precoSchema.default(0),
  ativo: z.boolean().default(true),
  /**
   * Composicao opcional ja no cadastro: criar o prato e vincular seus itens
   * numa unica requisicao, dentro de uma transacao.
   */
  itensIds: z.array(z.uuid()).max(100).optional(),
})

const atualizarPratoSchema = criarPratoSchema.omit({ itensIds: true }).partial()

const listarPratosQuerySchema = paginationQuerySchema.extend({
  empresaId: z.uuid().optional(),
  ativo: z.stringbool().optional(),
})

const vincularItemSchema = z.object({
  itemId: z.uuid({ message: 'Informe o id (UUID) de um item existente.' }),
})

const definirComposicaoSchema = z.object({
  itensIds: z.array(z.uuid()).max(100),
})

/* -------------------------------------------------------------------------- */
/* Rotas                                                                       */
/* -------------------------------------------------------------------------- */

export const pratosRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ------------------------------- LIST ----------------------------------- */
  app.get(
    '/pratos',
    {
      schema: {
        tags: ['Pratos'],
        summary: 'Lista os pratos',
        description: 'Filtros: `q` (nome), `empresaId` e `ativo`.',
        querystring: listarPratosQuerySchema,
        response: { 200: paginatedSchema(pratoComEmpresaSchema), ...errorResponses },
      },
    },
    async ({ query }) => {
      const { page, limit, q, empresaId, ativo } = query

      const filtro = and(
        empresaId ? eq(pratos.empresaId, empresaId) : undefined,
        ativo === undefined ? undefined : eq(pratos.ativo, ativo),
        q ? ilike(pratos.nome, `%${q}%`) : undefined,
      )

      const [data, total] = await Promise.all([
        db.query.pratos.findMany({
          where: filtro,
          columns: {
            id: true,
            empresaId: true,
            nome: true,
            descricao: true,
            preco: true,
            ativo: true,
          },
          with: { empresa: { columns: { id: true, nome: true } } },
          orderBy: asc(pratos.nome),
          limit,
          offset: (page - 1) * limit,
        }),
        db.$count(pratos, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------- READ ----------------------------------- */
  app.get(
    '/pratos/:id',
    {
      schema: {
        tags: ['Pratos'],
        summary: 'Busca um prato pelo id, com sua composicao',
        description:
          'Percorre prato -> prato_itens -> item -> categoria em uma unica chamada ' +
          'da Relational Query API e devolve os itens ja achatados.',
        params: uuidParamSchema,
        response: { 200: pratoDetalheSchema, ...errorResponses },
      },
    },
    async ({ params }) => {
      const prato = await db.query.pratos.findFirst({
        where: eq(pratos.id, params.id),
        columns: {
          id: true,
          empresaId: true,
          nome: true,
          descricao: true,
          preco: true,
          ativo: true,
        },
        with: {
          empresa: { columns: { id: true, nome: true } },
          pratoItens: {
            // `columns: {}` descarta as colunas da tabela de juncao: ela so
            // interessa como caminho ate o item, nao como dado da resposta.
            columns: {},
            with: {
              item: {
                columns: { id: true, nome: true, preco: true, ativo: true },
                with: { categoria: { columns: { id: true, nome: true } } },
              },
            },
          },
        },
      })

      if (!prato) throw new NotFoundError('Prato', params.id)

      const { pratoItens: vinculos, ...resto } = prato
      const itensDoPrato = vinculos
        .map((vinculo) => vinculo.item)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

      const custoItens = Number(
        itensDoPrato.reduce((soma, item) => soma + item.preco, 0).toFixed(2),
      )

      return { ...resto, itens: itensDoPrato, custoItens }
    },
  )

  /* ------------------- LIST ANINHADA: itens do prato ---------------------- */
  app.get(
    '/pratos/:id/itens',
    {
      schema: {
        tags: ['Pratos'],
        summary: 'Lista os itens que compoem um prato',
        description: 'Travessia explicita do N:N com INNER JOIN em prato_itens.',
        params: uuidParamSchema,
        querystring: paginationQuerySchema,
        response: {
          200: paginatedSchema(
            z.object({
              id: z.uuid(),
              nome: z.string(),
              preco: z.number(),
              ativo: z.boolean(),
              categoriaId: z.uuid(),
            }),
          ),
          ...errorResponses,
        },
      },
    },
    async ({ params, query }) => {
      const { page, limit, q } = query
      await garantirPrato(params.id)

      const filtro = and(
        eq(pratoItens.pratoId, params.id),
        q ? ilike(itens.nome, `%${q}%`) : undefined,
      )

      /**
       * Aqui o JOIN e escrito na mao (em vez de usar `db.query`) porque a
       * listagem precisa paginar e filtrar pelas colunas do ITEM -- algo que
       * a Relational Query API nao expressa bem, ja que ela pagina o registro
       * raiz, nao a relacao.
       */
      const [data, total] = await Promise.all([
        db
          .select({
            id: itens.id,
            nome: itens.nome,
            preco: itens.preco,
            ativo: itens.ativo,
            categoriaId: itens.categoriaId,
          })
          .from(pratoItens)
          .innerJoin(itens, eq(pratoItens.itemId, itens.id))
          .where(filtro)
          .orderBy(asc(itens.nome))
          .limit(limit)
          .offset((page - 1) * limit),
        // COUNT no banco -- trazer as linhas so para medir o tamanho do array
        // anularia o ganho da paginacao.
        db
          .select({ total: count() })
          .from(pratoItens)
          .innerJoin(itens, eq(pratoItens.itemId, itens.id))
          .where(filtro)
          .then(([linha]) => linha?.total ?? 0),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------ CREATE ---------------------------------- */
  app.post(
    '/pratos',
    {
      schema: {
        tags: ['Pratos'],
        summary: 'Cadastra um prato',
        description:
          'Aceita `itensIds` para ja montar a composicao. Prato e vinculos sao ' +
          'gravados na mesma transacao: ou tudo entra, ou nada entra.',
        body: criarPratoSchema,
        response: { 201: pratoSchema, ...errorResponses },
      },
    },
    async ({ body }, reply) => {
      const { itensIds, ...dadosDoPrato } = body

      const prato = await db.transaction(async (tx) => {
        const [novo] = await tx.insert(pratos).values(dadosDoPrato).returning()

        if (itensIds?.length) {
          const unicos = [...new Set(itensIds)]
          await garantirItensDaEmpresa(unicos, dadosDoPrato.empresaId)

          await tx
            .insert(pratoItens)
            .values(unicos.map((itemId) => ({ pratoId: novo!.id, itemId })))
        }

        return novo!
      })

      return reply.status(201).send(prato)
    },
  )

  /* ------------------------------ UPDATE ---------------------------------- */
  app.put(
    '/pratos/:id',
    {
      schema: {
        tags: ['Pratos'],
        summary: 'Atualiza um prato por completo',
        description: 'Nao altera a composicao. Use PUT /pratos/{id}/itens para isso.',
        params: uuidParamSchema,
        body: criarPratoSchema.omit({ itensIds: true }),
        response: { 200: pratoSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      const [prato] = await db
        .update(pratos)
        .set(body)
        .where(eq(pratos.id, params.id))
        .returning()

      if (!prato) throw new NotFoundError('Prato', params.id)
      return prato
    },
  )

  app.patch(
    '/pratos/:id',
    {
      schema: {
        tags: ['Pratos'],
        summary: 'Atualiza parcialmente um prato',
        params: uuidParamSchema,
        body: atualizarPratoSchema,
        response: { 200: pratoSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      if (Object.keys(body).length === 0) {
        throw new BadRequestError('Informe ao menos um campo para atualizar.')
      }

      const [prato] = await db
        .update(pratos)
        .set(body)
        .where(eq(pratos.id, params.id))
        .returning()

      if (!prato) throw new NotFoundError('Prato', params.id)
      return prato
    },
  )

  /* ------------------------------ DELETE ---------------------------------- */
  app.delete(
    '/pratos/:id',
    {
      schema: {
        tags: ['Pratos'],
        summary: 'Remove um prato',
        description: 'Os vinculos em prato_itens sao removidos junto (onDelete: cascade).',
        params: uuidParamSchema,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async ({ params }, reply) => {
      const [prato] = await db
        .delete(pratos)
        .where(eq(pratos.id, params.id))
        .returning({ id: pratos.id })

      if (!prato) throw new NotFoundError('Prato', params.id)

      return reply.status(204).send(null)
    },
  )

  /* ======================================================================== */
  /* Composicao do prato (relacionamento N:N)                                 */
  /* ======================================================================== */

  /* ----------------------- Vincular um item ao prato ---------------------- */
  app.post(
    '/pratos/:id/itens',
    {
      schema: {
        tags: ['Pratos'],
        summary: 'Adiciona um item ao prato',
        description:
          'Cria uma linha em prato_itens. Responde 409 se o item ja estiver no prato ' +
          '(constraint UNIQUE) ou se pertencer a outra empresa.',
        params: uuidParamSchema,
        body: vincularItemSchema,
        response: {
          201: z.object({ id: z.uuid(), pratoId: z.uuid(), itemId: z.uuid() }),
          ...errorResponses,
        },
      },
    },
    async ({ params, body }, reply) => {
      const prato = await garantirPrato(params.id)
      await garantirItensDaEmpresa([body.itemId], prato.empresaId)

      const [vinculo] = await db
        .insert(pratoItens)
        .values({ pratoId: params.id, itemId: body.itemId })
        .returning()

      return reply.status(201).send(vinculo!)
    },
  )

  /* -------------------- Redefinir a composicao inteira -------------------- */
  app.put(
    '/pratos/:id/itens',
    {
      schema: {
        tags: ['Pratos'],
        summary: 'Substitui a composicao do prato',
        description:
          'Troca todos os itens do prato pela lista enviada. Enviar uma lista vazia ' +
          'esvazia a composicao. A troca acontece dentro de uma transacao.',
        params: uuidParamSchema,
        body: definirComposicaoSchema,
        response: {
          200: z.object({ pratoId: z.uuid(), itensIds: z.array(z.uuid()) }),
          ...errorResponses,
        },
      },
    },
    async ({ params, body }) => {
      const prato = await garantirPrato(params.id)
      const unicos = [...new Set(body.itensIds)]

      if (unicos.length > 0) {
        await garantirItensDaEmpresa(unicos, prato.empresaId)
      }

      /**
       * Apagar e reinserir precisa ser atomico: sem a transacao, uma falha no
       * INSERT deixaria o prato sem nenhum item -- pior do que nao ter mudado.
       */
      await db.transaction(async (tx) => {
        await tx.delete(pratoItens).where(eq(pratoItens.pratoId, params.id))

        if (unicos.length > 0) {
          await tx
            .insert(pratoItens)
            .values(unicos.map((itemId) => ({ pratoId: params.id, itemId })))
        }
      })

      return { pratoId: params.id, itensIds: unicos }
    },
  )

  /* --------------------- Desvincular um item do prato --------------------- */
  app.delete(
    '/pratos/:id/itens/:itemId',
    {
      schema: {
        tags: ['Pratos'],
        summary: 'Remove um item do prato',
        description: 'Apaga apenas a linha de prato_itens; o item em si continua existindo.',
        params: z.object({ id: z.uuid(), itemId: z.uuid() }),
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async ({ params }, reply) => {
      const [removido] = await db
        .delete(pratoItens)
        .where(and(eq(pratoItens.pratoId, params.id), eq(pratoItens.itemId, params.itemId)))
        .returning({ id: pratoItens.id })

      if (!removido) {
        throw new NotFoundError(
          `Vinculo entre o prato "${params.id}" e o item "${params.itemId}"`,
        )
      }

      return reply.status(204).send(null)
    },
  )
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

async function garantirPrato(id: string): Promise<{ id: string; empresaId: string }> {
  const prato = await db.query.pratos.findFirst({
    where: eq(pratos.id, id),
    columns: { id: true, empresaId: true },
  })

  if (!prato) throw new NotFoundError('Prato', id)

  return prato
}

/**
 * Valida a lista inteira de itens em UMA consulta (`inArray`), em vez de um
 * SELECT por item. Alem de mais rapido, permite dizer exatamente quais ids
 * falharam, em vez de parar no primeiro erro.
 */
async function garantirItensDaEmpresa(itensIds: string[], empresaId: string): Promise<void> {
  const encontrados = await db
    .select({ id: itens.id, empresaId: itens.empresaId })
    .from(itens)
    .where(inArray(itens.id, itensIds))

  const mapa = new Map(encontrados.map((item) => [item.id, item.empresaId]))

  const inexistentes = itensIds.filter((id) => !mapa.has(id))
  if (inexistentes.length > 0) {
    throw new NotFoundError(`Item(ns) ${inexistentes.join(', ')}`)
  }

  const deOutraEmpresa = itensIds.filter((id) => mapa.get(id) !== empresaId)
  if (deOutraEmpresa.length > 0) {
    throw new ConflictError(
      'Um prato so pode ser composto por itens da propria empresa.',
      { itensDeOutraEmpresa: deOutraEmpresa },
    )
  }
}
