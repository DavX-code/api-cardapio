import { pgTable, uuid, varchar, index } from 'drizzle-orm/pg-core'

/**
 * ufs -- Unidades Federativas (estados).
 * Raiz da hierarquia geografica: ufs -> cidades -> empresas.
 */
export const ufs = pgTable(
  'ufs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sigla: varchar('sigla', { length: 2 }).notNull().unique(),
    nome: varchar('nome', { length: 100 }).notNull(),
  },
  (table) => [index('ufs_nome_idx').on(table.nome)],
)

export type Uf = typeof ufs.$inferSelect
export type NovaUf = typeof ufs.$inferInsert
