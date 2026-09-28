import { pgTable, uuid, index, unique } from 'drizzle-orm/pg-core'
import { pratos } from './pratos.ts'
import { itens } from './itens.ts'

/**
 * prato_itens -- tabela de juncao (join table) que materializa o
 * relacionamento muitos-para-muitos entre pratos e itens.
 *
 * O diagrama define uma PK propria (id uuid) em vez de chave composta.
 * Para que o par (prato, item) nao se repita, a regra e garantida por uma
 * constraint UNIQUE -- no banco, e nao apenas na aplicacao.
 */
export const pratoItens = pgTable(
  'prato_itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    pratoId: uuid('prato_id')
      .notNull()
      .references(() => pratos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => itens.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
  },
  (table) => [
    index('prato_itens_prato_id_idx').on(table.pratoId),
    index('prato_itens_item_id_idx').on(table.itemId),
    unique('prato_itens_prato_id_item_id_unique').on(table.pratoId, table.itemId),
  ],
)

export type PratoItem = typeof pratoItens.$inferSelect
export type NovoPratoItem = typeof pratoItens.$inferInsert
