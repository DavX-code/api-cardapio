import { z } from 'zod'
import { and, asc, eq, ilike } from 'drizzle-orm'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'

import { db } from '../db/client.ts'
import { categorias, empresas, itens, pratos } from '../db/schema/index.ts'
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

const empresaSchema = z.object({
  id: z.uuid(),
  cidadeId: z.uuid(),
  nome: z.string(),
  cnpj: z.string().nullable(),
  ativo: z.boolean(),
})

const empresaComLocalSchema = empresaSchema.extend({
  cidade: z.object({
    id: z.uuid(),
    nome: z.string(),
    uf: z.object({ id: z.uuid(), sigla: z.string(), nome: z.string() }),
  }),
})

const empresaDetalheSchema = empresaComLocalSchema.extend({
  categorias: z.array(z.object({ id: z.uuid(), nome: z.string() })),
  pratos: z.array(
    z.object({ id: z.uuid(), nome: z.string(), preco: z.number(), ativo: z.boolean() }),
  ),
})

/**
 * O CNPJ chega do cliente em qualquer formato ("11.222.333/0001-81" ou so digitos)
 * e e normalizado para 14 digitos antes de tocar o banco. Guardar sempre no mesmo
 * formato e o que faz a constraint UNIQUE realmente funcionar -- caso contrario
 * o mesmo CNPJ formatado de duas maneiras entraria duas vezes.
 */
const cnpjSchema = z
  .string()
  .trim()
  .transform((valor) => valor.replace(/\D/g, ''))
  .refine((digitos) => digitos.length === 14, {
    message: 'O CNPJ deve conter 14 digitos.',
  })

const criarEmpresaSchema = z.object({
  cidadeId: z.uuid({ message: 'Informe o id (UUID) de uma cidade existente.' }),
  nome: z.string().trim().min(2, 'O nome deve ter ao menos 2 caracteres.').max(150),
  cnpj: cnpjSchema.nullish(),
  ativo: z.boolean().default(true),
})

const atualizarEmpresaSchema = criarEmpresaSchema.partial()

const listarEmpresasQuerySchema = paginationQuerySchema.extend({
  cidadeId: z.uuid().optional(),
  ativo: z.stringbool().optional(),
})

const categoriaResumoSchema = z.object({
  id: z.uuid(),
  empresaId: z.uuid(),
  nome: z.string(),
})

const itemResumoSchema = z.object({
  id: z.uuid(),
  empresaId: z.uuid(),
  categoriaId: z.uuid(),
  nome: z.string(),
  preco: z.number(),
  ativo: z.boolean(),
})

const pratoResumoSchema = z.object({
  id: z.uuid(),
  empresaId: z.uuid(),
  nome: z.string(),
  descricao: z.string().nullable(),
  preco: z.number(),
  ativo: z.boolean(),
})

/* -------------------------------------------------------------------------- */
/* Rotas                                                                       */
/* -------------------------------------------------------------------------- */

export const empresasRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ------------------------------- LIST ----------------------------------- */
  app.get(
    '/empresas',
    {
      schema: {
        tags: ['Empresas'],
        summary: 'Lista as empresas',
        description:
          'Cada empresa vem com cidade e UF resolvidas. Filtros: `q` (nome), `cidadeId` e `ativo`.',
        querystring: listarEmpresasQuerySchema,
        response: { 200: paginatedSchema(empresaComLocalSchema), ...errorResponses },
      },
    },
    async ({ query }) => {
      const { page, limit, q, cidadeId, ativo } = query

      const filtro = and(
        cidadeId ? eq(empresas.cidadeId, cidadeId) : undefined,
        ativo === undefined ? undefined : eq(empresas.ativo, ativo),
        q ? ilike(empresas.nome, `%${q}%`) : undefined,
      )

      const [data, total] = await Promise.all([
        db.query.empresas.findMany({
          where: filtro,
          columns: { id: true, cidadeId: true, nome: true, cnpj: true, ativo: true },
          // Relacao aninhada em dois niveis: empresa -> cidade -> uf.
          with: {
            cidade: {
              columns: { id: true, nome: true },
              with: { uf: { columns: { id: true, sigla: true, nome: true } } },
            },
          },
          orderBy: asc(empresas.nome),
          limit,
          offset: (page - 1) * limit,
        }),
        db.$count(empresas, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------- READ ----------------------------------- */
  app.get(
    '/empresas/:id',
    {
      schema: {
        tags: ['Empresas'],
        summary: 'Busca uma empresa pelo id',
        description: 'Retorna a empresa com cidade/UF, suas categorias e seus pratos.',
        params: uuidParamSchema,
        response: { 200: empresaDetalheSchema, ...errorResponses },
      },
    },
    async ({ params }) => {
      const empresa = await db.query.empresas.findFirst({
        where: eq(empresas.id, params.id),
        columns: { id: true, cidadeId: true, nome: true, cnpj: true, ativo: true },
        with: {
          cidade: {
            columns: { id: true, nome: true },
            with: { uf: { columns: { id: true, sigla: true, nome: true } } },
          },
          categorias: { columns: { id: true, nome: true }, orderBy: asc(categorias.nome) },
          pratos: {
            columns: { id: true, nome: true, preco: true, ativo: true },
            orderBy: asc(pratos.nome),
          },
        },
      })

      if (!empresa) throw new NotFoundError('Empresa', params.id)

      return empresa
    },
  )

  /* ------------------ LIST ANINHADA: categorias da empresa ---------------- */
  app.get(
    '/empresas/:id/categorias',
    {
      schema: {
        tags: ['Empresas'],
        summary: 'Lista as categorias de uma empresa',
        params: uuidParamSchema,
        querystring: paginationQuerySchema,
        response: { 200: paginatedSchema(categoriaResumoSchema), ...errorResponses },
      },
    },
    async ({ params, query }) => {
      const { page, limit, q } = query
      await garantirEmpresa(params.id)

      const filtro = and(
        eq(categorias.empresaId, params.id),
        q ? ilike(categorias.nome, `%${q}%`) : undefined,
      )

      const [data, total] = await Promise.all([
        db
          .select({ id: categorias.id, empresaId: categorias.empresaId, nome: categorias.nome })
          .from(categorias)
          .where(filtro)
          .orderBy(asc(categorias.nome))
          .limit(limit)
          .offset((page - 1) * limit),
        db.$count(categorias, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* --------------------- LIST ANINHADA: itens da empresa ------------------ */
  app.get(
    '/empresas/:id/itens',
    {
      schema: {
        tags: ['Empresas'],
        summary: 'Lista os itens de uma empresa',
        params: uuidParamSchema,
        querystring: paginationQuerySchema,
        response: { 200: paginatedSchema(itemResumoSchema), ...errorResponses },
      },
    },
    async ({ params, query }) => {
      const { page, limit, q } = query
      await garantirEmpresa(params.id)

      const filtro = and(
        eq(itens.empresaId, params.id),
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

  /* -------------------- LIST ANINHADA: pratos da empresa ------------------ */
  app.get(
    '/empresas/:id/pratos',
    {
      schema: {
        tags: ['Empresas'],
        summary: 'Lista os pratos de uma empresa',
        params: uuidParamSchema,
        querystring: paginationQuerySchema,
        response: { 200: paginatedSchema(pratoResumoSchema), ...errorResponses },
      },
    },
    async ({ params, query }) => {
      const { page, limit, q } = query
      await garantirEmpresa(params.id)

      const filtro = and(
        eq(pratos.empresaId, params.id),
        q ? ilike(pratos.nome, `%${q}%`) : undefined,
      )

      const [data, total] = await Promise.all([
        db
          .select({
            id: pratos.id,
            empresaId: pratos.empresaId,
            nome: pratos.nome,
            descricao: pratos.descricao,
            preco: pratos.preco,
            ativo: pratos.ativo,
          })
          .from(pratos)
          .where(filtro)
          .orderBy(asc(pratos.nome))
          .limit(limit)
          .offset((page - 1) * limit),
        db.$count(pratos, filtro),
      ])

      return { data, meta: buildMeta(total, { page, limit }) }
    },
  )

  /* ------------------------------ CREATE ---------------------------------- */
  app.post(
    '/empresas',
    {
      schema: {
        tags: ['Empresas'],
        summary: 'Cadastra uma empresa',
        body: criarEmpresaSchema,
        response: { 201: empresaSchema, ...errorResponses },
      },
    },
    async ({ body }, reply) => {
      const [empresa] = await db.insert(empresas).values(body).returning()
      return reply.status(201).send(empresa!)
    },
  )

  /* ------------------------------ UPDATE ---------------------------------- */
  app.put(
    '/empresas/:id',
    {
      schema: {
        tags: ['Empresas'],
        summary: 'Atualiza uma empresa por completo',
        params: uuidParamSchema,
        body: criarEmpresaSchema,
        response: { 200: empresaSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      const [empresa] = await db
        .update(empresas)
        .set(body)
        .where(eq(empresas.id, params.id))
        .returning()

      if (!empresa) throw new NotFoundError('Empresa', params.id)
      return empresa
    },
  )

  app.patch(
    '/empresas/:id',
    {
      schema: {
        tags: ['Empresas'],
        summary: 'Atualiza parcialmente uma empresa',
        description: 'Util, por exemplo, para apenas desativar uma empresa: `{ "ativo": false }`.',
        params: uuidParamSchema,
        body: atualizarEmpresaSchema,
        response: { 200: empresaSchema, ...errorResponses },
      },
    },
    async ({ params, body }) => {
      if (Object.keys(body).length === 0) {
        throw new BadRequestError('Informe ao menos um campo para atualizar.')
      }

      const [empresa] = await db
        .update(empresas)
        .set(body)
        .where(eq(empresas.id, params.id))
        .returning()

      if (!empresa) throw new NotFoundError('Empresa', params.id)
      return empresa
    },
  )

  /* ------------------------------ DELETE ---------------------------------- */
  app.delete(
    '/empresas/:id',
    {
      schema: {
        tags: ['Empresas'],
        summary: 'Remove uma empresa',
        description:
          'Categorias, itens e pratos da empresa sao removidos junto (onDelete: cascade).',
        params: uuidParamSchema,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async ({ params }, reply) => {
      const [empresa] = await db
        .delete(empresas)
        .where(eq(empresas.id, params.id))
        .returning({ id: empresas.id })

      if (!empresa) throw new NotFoundError('Empresa', params.id)

      return reply.status(204).send(null)
    },
  )
}

/**
 * Nas rotas aninhadas, uma empresa inexistente deve dar 404 -- e nao uma lista
 * vazia, que faria o cliente achar que a empresa existe mas nao tem registros.
 */
async function garantirEmpresa(id: string): Promise<void> {
  const existe = await db.query.empresas.findFirst({
    where: eq(empresas.id, id),
    columns: { id: true },
  })

  if (!existe) throw new NotFoundError('Empresa', id)
}
