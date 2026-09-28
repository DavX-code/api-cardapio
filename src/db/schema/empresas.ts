import { pgTable, uuid, varchar, boolean, index } from 'drizzle-orm/pg-core'
import { cidades } from './cidades.ts'

/**
 * empresas -- estabelecimentos. Cada empresa fica em uma cidade (1:N)
 * e e a "dona" das suas categorias, itens e pratos.
 */
export const empresas = pgTable(
  'empresas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cidadeId: uuid('cidade_id')
      .notNull()
      .references(() => cidades.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    nome: varchar('nome', { length: 150 }).notNull(),
    // Nullable no diagrama ER, porem unico quando informado.
    cnpj: varchar('cnpj', { length: 14 }).unique(),
    ativo: boolean('ativo').notNull().default(true),
  },
  (table) => [
    index('empresas_cidade_id_idx').on(table.cidadeId),
    index('empresas_ativo_idx').on(table.ativo),
  ],
)

export type Empresa = typeof empresas.$inferSelect
export type NovaEmpresa = typeof empresas.$inferInsert
