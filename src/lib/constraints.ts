/**
 * Traducao de constraints do banco para mensagens de usuario.
 *
 * Quando o Postgres rejeita um INSERT por violar uma UNIQUE ou uma FOREIGN KEY,
 * ele devolve o nome da constraint. Mapear esse nome aqui permite responder
 * "Ja existe uma UF com essa sigla." em vez de vazar o erro cru do banco --
 * e sem precisar de um SELECT extra antes de cada escrita para "checar se ja existe"
 * (que, alem de mais lento, teria uma condicao de corrida entre o SELECT e o INSERT).
 */
export const CONSTRAINT_MESSAGES: Record<string, string> = {
  // UNIQUE
  ufs_sigla_unique: 'Ja existe uma UF cadastrada com essa sigla.',
  cidades_uf_id_nome_unique: 'Essa UF ja possui uma cidade com esse nome.',
  empresas_cnpj_unique: 'Ja existe uma empresa cadastrada com esse CNPJ.',
  categorias_empresa_id_nome_unique: 'Essa empresa ja possui uma categoria com esse nome.',
  prato_itens_prato_id_item_id_unique: 'Esse item ja faz parte do prato.',

  // FOREIGN KEY
  cidades_uf_id_ufs_id_fk: 'A UF informada nao existe.',
  empresas_cidade_id_cidades_id_fk: 'A cidade informada nao existe.',
  categorias_empresa_id_empresas_id_fk: 'A empresa informada nao existe.',
  itens_empresa_id_empresas_id_fk: 'A empresa informada nao existe.',
  itens_categoria_id_categorias_id_fk: 'A categoria informada nao existe.',
  pratos_empresa_id_empresas_id_fk: 'A empresa informada nao existe.',
  prato_itens_prato_id_pratos_id_fk: 'O prato informado nao existe.',
  prato_itens_item_id_itens_id_fk: 'O item informado nao existe.',
}

/**
 * Mensagens para quando a FK e violada no sentido inverso: alguem tenta
 * apagar um registro que ainda e referenciado (onDelete: 'restrict').
 */
export const RESTRICT_MESSAGES: Record<string, string> = {
  cidades_uf_id_ufs_id_fk: 'Nao e possivel excluir: existem cidades vinculadas a esta UF.',
  empresas_cidade_id_cidades_id_fk:
    'Nao e possivel excluir: existem empresas vinculadas a esta cidade.',
  itens_categoria_id_categorias_id_fk:
    'Nao e possivel excluir: existem itens vinculados a esta categoria.',
}
