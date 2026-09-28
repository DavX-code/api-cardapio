import { pgTable, uuid, varchar, index, unique } from 'drizzle-orm/pg-core'
import { empresas } from './empresas.ts'

/**
 * categorias -- agrupam os itens dentro de uma empresa (1:N).
 *
 * Aqui o onDelete e 'cascade': apagar a empresa apaga suas categorias,
 * pois uma categoria nao faz sentido fora da empresa que a criou.
 */
export const categorias = pgTable(
  'categorias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    nome: varchar('nome', { length: 100 }).notNull(),
  },
  (table) => [
    index('categorias_empresa_id_idx').on(table.empresaId),
    unique('categorias_empresa_id_nome_unique').on(table.empresaId, table.nome),
  ],
)

export type Categoria = typeof categorias.$inferSelect
export type NovaCategoria = typeof categorias.$inferInsert
