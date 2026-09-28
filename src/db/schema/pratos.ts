import { pgTable, uuid, varchar, text, numeric, boolean, index } from 'drizzle-orm/pg-core'
import { empresas } from './empresas.ts'

/**
 * pratos -- o que a empresa vende. Um prato e composto por varios itens,
 * atraves da tabela de juncao prato_itens (N:N).
 */
export const pratos = pgTable(
  'pratos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    nome: varchar('nome', { length: 150 }).notNull(),
    descricao: text('descricao'),
    preco: numeric('preco', { precision: 10, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    ativo: boolean('ativo').notNull().default(true),
  },
  (table) => [
    index('pratos_empresa_id_idx').on(table.empresaId),
    index('pratos_ativo_idx').on(table.ativo),
  ],
)

export type Prato = typeof pratos.$inferSelect
export type NovoPrato = typeof pratos.$inferInsert
