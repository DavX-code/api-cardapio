import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import { env } from '../env.ts'
import * as schema from './schema/index.ts'

/**
 * Conexao unica (pool) reaproveitada por toda a aplicacao.
 * Abrir uma conexao por requisicao seria o erro classico de performance aqui.
 */
export const connection = postgres(env.DATABASE_URL, {
  max: env.NODE_ENV === 'production' ? 10 : 5,
  // Silencia os avisos de NOTICE do Postgres no terminal de desenvolvimento.
  onnotice: env.NODE_ENV === 'development' ? () => {} : undefined,
})

/**
 * Passar `schema` aqui e o que habilita `db.query.<tabela>.findMany(...)`
 * com autocomplete e tipagem do resultado aninhado.
 */
export const db = drizzle(connection, {
  schema,
  logger: env.NODE_ENV === 'development',
})

export type Database = typeof db
export { schema }
