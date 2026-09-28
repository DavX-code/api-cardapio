/**
 * Erros de dominio da aplicacao.
 *
 * As rotas lancam estes erros; quem traduz para uma resposta HTTP e o
 * error handler central em `src/app.ts`. Assim a regra de negocio nao precisa
 * saber nada sobre status codes.
 */
export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(recurso: string, id?: string) {
    super(
      id ? `${recurso} com id "${id}" nao foi encontrado(a).` : `${recurso} nao encontrado(a).`,
      404,
      'NOT_FOUND',
    )
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, 'CONFLICT', details)
    this.name = 'ConflictError'
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, 'BAD_REQUEST', details)
    this.name = 'BadRequestError'
  }
}

/** Erro vindo do servidor PostgreSQL, com os campos do protocolo. */
export interface PostgresErrorLike {
  code: string
  constraint_name?: string
  detail?: string
  table_name?: string
}

/**
 * Um SQLSTATE tem exatamente 5 caracteres alfanumericos maiusculos (ex.: 23505).
 *
 * Checar apenas `'code' in valor` nao serve: erros do Fastify tambem carregam
 * `code`, so que no formato `FST_ERR_...`. Sem o teste de formato, um erro do
 * framework seria confundido com um erro do banco.
 */
const SQLSTATE = /^[0-9A-Z]{5}$/

function pareceErroDoPostgres(valor: unknown): valor is PostgresErrorLike {
  if (typeof valor !== 'object' || valor === null) return false

  const code = (valor as { code?: unknown }).code

  return typeof code === 'string' && SQLSTATE.test(code)
}

/**
 * Procura o erro original do PostgreSQL percorrendo a cadeia de `cause`.
 *
 * O Drizzle nao propaga o erro do driver diretamente: ele o embrulha em um
 * `DrizzleQueryError` (que carrega a query e os parametros) e coloca o erro
 * real em `cause`. Olhar so o nivel de cima faria toda violacao de constraint
 * cair no 500 generico, perdendo a traducao para 409.
 */
export function getPostgresError(error: unknown): PostgresErrorLike | null {
  let atual: unknown = error

  for (let profundidade = 0; atual && profundidade < 5; profundidade++) {
    if (pareceErroDoPostgres(atual)) return atual
    atual = (atual as { cause?: unknown }).cause
  }

  return null
}

/**
 * Codigos SQLSTATE da classe 23 (integrity constraint violation).
 *
 * Vale destacar a diferenca entre os dois primeiros, porque eles apontam para
 * problemas opostos:
 *
 *   RESTRICT_VIOLATION (23001) -- tentou APAGAR um registro que ainda e
 *     referenciado por outros. A constraint citada no erro pertence a tabela
 *     FILHA (ex.: apagar uma UF que tem cidades).
 *
 *   FOREIGN_KEY_VIOLATION (23503) -- tentou GRAVAR uma referencia para um
 *     registro que nao existe (ex.: cidade apontando para uma UF inexistente).
 */
export const PG_ERROR = {
  RESTRICT_VIOLATION: '23001',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  UNIQUE_VIOLATION: '23505',
  CHECK_VIOLATION: '23514',
  INVALID_TEXT_REPRESENTATION: '22P02',
} as const
