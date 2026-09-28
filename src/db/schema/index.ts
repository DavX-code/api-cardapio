/**
 * Barrel do schema.
 *
 * O `drizzle.config.ts` e o `db.ts` apontam para este arquivo, entao tudo que
 * for exportado aqui entra tanto nas migrations quanto na instancia tipada
 * do banco (incluindo `db.query.*`, que so existe para tabelas com relations).
 */
export * from './ufs.ts'
export * from './cidades.ts'
export * from './empresas.ts'
export * from './categorias.ts'
export * from './itens.ts'
export * from './pratos.ts'
export * from './prato-itens.ts'
export * from './relations.ts'
