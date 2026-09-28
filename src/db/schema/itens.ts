import { pgTable, uuid, varchar, numeric, boolean, index } from 'drizzle-orm/pg-core'
import { empresas } from './empresas.ts'
import { categorias } from './categorias.ts'

/**
 * itens -- insumos/produtos de uma empresa, classificados por categoria.
 *
 * Note que a tabela guarda DUAS chaves estrangeiras (empresa_id e categoria_id),
 * exatamente como no diagrama. A empresa e redundante em teoria (daria para
 * chegar nela via categoria), mas evita um JOIN extra nas consultas mais comuns
 * e permite filtrar itens por empresa direto no indice.
 *
 * `preco` usa numeric(10,2). O modo 'number' faz o Drizzle converter para
 * number no TypeScript; sem ele, o driver do Postgres devolveria string para
 * preservar a precisao arbitraria do tipo NUMERIC.
 */
export const itens = pgTable(
  'itens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    categoriaId: uuid('categoria_id')
      .notNull()
      .references(() => categorias.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    nome: varchar('nome', { length: 150 }).notNull(),
    preco: numeric('preco', { precision: 10, scale: 2, mode: 'number' })
      .notNull()
      .default(0),
    ativo: boolean('ativo').notNull().default(true),
  },
  (table) => [
    index('itens_empresa_id_idx').on(table.empresaId),
    index('itens_categoria_id_idx').on(table.categoriaId),
    index('itens_ativo_idx').on(table.ativo),
  ],
)

export type Item = typeof itens.$inferSelect
export type NovoItem = typeof itens.$inferInsert
