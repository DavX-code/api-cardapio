import { z } from 'zod'

/**
 * Blocos de validacao reaproveitados por todas as rotas.
 * Centralizar aqui mantem as mensagens de erro consistentes em toda a API.
 */

export const uuidParamSchema = z.object({
  id: z.uuid({ message: 'O id informado nao e um UUID valido.' }),
})

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(150).optional(),
})

export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
})

/** Envelope padrao das rotas de listagem. */
export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    meta: paginationMetaSchema,
  })
}

export function buildMeta(total: number, { page, limit }: { page: number; limit: number }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  }
}

/** Formato unico de erro devolvido pela API. */
export const errorResponseSchema = z.object({
  message: z.string(),
  code: z.string(),
  details: z.unknown().optional(),
})

/**
 * Atalho para declarar as respostas de erro de uma rota sem repetir
 * o mesmo objeto em cada handler.
 */
export const errorResponses = {
  400: errorResponseSchema.describe('Requisicao invalida'),
  404: errorResponseSchema.describe('Recurso nao encontrado'),
  409: errorResponseSchema.describe('Conflito de dados'),
} as const
