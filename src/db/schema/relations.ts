import { relations } from 'drizzle-orm'

import { ufs } from './ufs.ts'
import { cidades } from './cidades.ts'
import { empresas } from './empresas.ts'
import { categorias } from './categorias.ts'
import { itens } from './itens.ts'
import { pratos } from './pratos.ts'
import { pratoItens } from './prato-itens.ts'

/**
 * Relacoes do Drizzle.
 *
 * IMPORTANTE: `relations()` NAO cria nada no banco de dados. As chaves
 * estrangeiras ja foram declaradas com `.references()` nos arquivos de schema.
 * O que `relations()` faz e descrever essas ligacoes para a *aplicacao*, o que
 * habilita a Relational Query API (`db.query.x.findMany({ with: { ... } })`)
 * e da tipagem completa ao resultado aninhado.
 *
 * Por isso elas ficam num arquivo separado: os schemas descrevem o banco,
 * este arquivo descreve como o TypeScript enxerga o grafo de dados. De quebra,
 * evita imports circulares entre os arquivos de tabela.
 */

// ufs 1 -----> N cidades
export const ufsRelations = relations(ufs, ({ many }) => ({
  cidades: many(cidades),
}))

// cidades N -----> 1 uf  |  cidades 1 -----> N empresas
export const cidadesRelations = relations(cidades, ({ one, many }) => ({
  uf: one(ufs, {
    fields: [cidades.ufId],
    references: [ufs.id],
  }),
  empresas: many(empresas),
}))

// empresas N -----> 1 cidade  |  empresas 1 -----> N categorias/itens/pratos
export const empresasRelations = relations(empresas, ({ one, many }) => ({
  cidade: one(cidades, {
    fields: [empresas.cidadeId],
    references: [cidades.id],
  }),
  categorias: many(categorias),
  itens: many(itens),
  pratos: many(pratos),
}))

// categorias N -----> 1 empresa  |  categorias 1 -----> N itens
export const categoriasRelations = relations(categorias, ({ one, many }) => ({
  empresa: one(empresas, {
    fields: [categorias.empresaId],
    references: [empresas.id],
  }),
  itens: many(itens),
}))

/**
 * itens tem DUAS relacoes `one` apontando para tabelas diferentes.
 * Como cada uma usa uma FK distinta, o Drizzle as diferencia sozinho
 * pelos campos declarados em `fields`.
 */
export const itensRelations = relations(itens, ({ one, many }) => ({
  empresa: one(empresas, {
    fields: [itens.empresaId],
    references: [empresas.id],
  }),
  categoria: one(categorias, {
    fields: [itens.categoriaId],
    references: [categorias.id],
  }),
  pratoItens: many(pratoItens),
}))

// pratos N -----> 1 empresa  |  pratos N <----> N itens (via prato_itens)
export const pratosRelations = relations(pratos, ({ one, many }) => ({
  empresa: one(empresas, {
    fields: [pratos.empresaId],
    references: [empresas.id],
  }),
  pratoItens: many(pratoItens),
}))

/**
 * O lado "do meio" do N:N. O Drizzle (relational queries v1) nao esconde a
 * tabela de juncao: para ir de prato ate item, navega-se
 * `prato -> pratoItens -> item`, e cada perna e um `one(...)` daqui.
 */
export const pratoItensRelations = relations(pratoItens, ({ one }) => ({
  prato: one(pratos, {
    fields: [pratoItens.pratoId],
    references: [pratos.id],
  }),
  item: one(itens, {
    fields: [pratoItens.itemId],
    references: [itens.id],
  }),
}))
