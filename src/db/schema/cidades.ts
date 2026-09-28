import { pgTable, uuid, varchar, index, unique } from 'drizzle-orm/pg-core'
import { ufs } from './ufs.ts'

/**
 * cidades -- pertencem a exatamente uma UF (relacionamento 1:N).
 *
 * onDelete: 'restrict' impede apagar uma UF que ainda tenha cidades,
 * preservando a integridade referencial no proprio banco.
 */
export const cidades = pgTable(
  'cidades',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ufId: uuid('uf_id')
      .notNull()
      .references(() => ufs.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    nome: varchar('nome', { length: 150 }).notNull(),
  },
  (table) => [
    index('cidades_uf_id_idx').on(table.ufId),
    // Nao existem duas cidades de mesmo nome dentro da mesma UF.
    unique('cidades_uf_id_nome_unique').on(table.ufId, table.nome),
  ],
)

export type Cidade = typeof cidades.$inferSelect
export type NovaCidade = typeof cidades.$inferInsert
