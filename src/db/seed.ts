/**
 * Popula o banco com um cenario de exemplo, suficiente para exercitar
 * todos os relacionamentos do modelo:
 *
 *   ufs -> cidades -> empresas -> categorias -> itens
 *                            \-> pratos  <--(N:N)--/
 *
 * Rode com: npm run db:seed
 */
import { connection, db } from './client.ts'
import { categorias, cidades, empresas, itens, pratoItens, pratos, ufs } from './schema/index.ts'

async function seed() {
  console.log('Limpando as tabelas...')

  /**
   * A ordem importa: apaga-se dos "filhos" para os "pais", senao as foreign
   * keys com onDelete restrict bloqueiam a limpeza. A alternativa seria um
   * TRUNCATE ... CASCADE, mas apagar na ordem deixa a dependencia explicita.
   */
  await db.delete(pratoItens)
  await db.delete(pratos)
  await db.delete(itens)
  await db.delete(categorias)
  await db.delete(empresas)
  await db.delete(cidades)
  await db.delete(ufs)

  console.log('Inserindo UFs...')
  const [sp, rj, mg] = await db
    .insert(ufs)
    .values([
      { sigla: 'SP', nome: 'Sao Paulo' },
      { sigla: 'RJ', nome: 'Rio de Janeiro' },
      { sigla: 'MG', nome: 'Minas Gerais' },
    ])
    .returning()

  console.log('Inserindo cidades...')
  const [saoPaulo, campinas, rioDeJaneiro, beloHorizonte] = await db
    .insert(cidades)
    .values([
      { ufId: sp!.id, nome: 'Sao Paulo' },
      { ufId: sp!.id, nome: 'Campinas' },
      { ufId: rj!.id, nome: 'Rio de Janeiro' },
      { ufId: mg!.id, nome: 'Belo Horizonte' },
    ])
    .returning()

  console.log('Inserindo empresas...')
  const [cantina, hamburgueria, boteco] = await db
    .insert(empresas)
    .values([
      { cidadeId: saoPaulo!.id, nome: 'Cantina da Nonna', cnpj: '11222333000181', ativo: true },
      { cidadeId: campinas!.id, nome: 'Burger do Campus', cnpj: '44555666000199', ativo: true },
      { cidadeId: rioDeJaneiro!.id, nome: 'Boteco do Zeca', cnpj: null, ativo: false },
    ])
    .returning()

  console.log('Inserindo categorias...')
  const [massas, molhos, queijos, paes, carnes, acompanhamentos] = await db
    .insert(categorias)
    .values([
      { empresaId: cantina!.id, nome: 'Massas' },
      { empresaId: cantina!.id, nome: 'Molhos' },
      { empresaId: cantina!.id, nome: 'Queijos' },
      { empresaId: hamburgueria!.id, nome: 'Paes' },
      { empresaId: hamburgueria!.id, nome: 'Carnes' },
      { empresaId: hamburgueria!.id, nome: 'Acompanhamentos' },
    ])
    .returning()

  console.log('Inserindo itens...')
  const [espaguete, talharim, molhoTomate, molhoBranco, parmesao, mussarela] = await db
    .insert(itens)
    .values([
      { empresaId: cantina!.id, categoriaId: massas!.id, nome: 'Espaguete', preco: 8.5 },
      { empresaId: cantina!.id, categoriaId: massas!.id, nome: 'Talharim', preco: 9.0 },
      { empresaId: cantina!.id, categoriaId: molhos!.id, nome: 'Molho de tomate', preco: 6.0 },
      { empresaId: cantina!.id, categoriaId: molhos!.id, nome: 'Molho branco', preco: 7.25 },
      { empresaId: cantina!.id, categoriaId: queijos!.id, nome: 'Parmesao ralado', preco: 4.75 },
      {
        empresaId: cantina!.id,
        categoriaId: queijos!.id,
        nome: 'Mussarela de bufala',
        preco: 12.0,
        ativo: false,
      },
    ])
    .returning()

  const [brioche, burger180, cheddar, batata] = await db
    .insert(itens)
    .values([
      { empresaId: hamburgueria!.id, categoriaId: paes!.id, nome: 'Pao brioche', preco: 3.5 },
      { empresaId: hamburgueria!.id, categoriaId: carnes!.id, nome: 'Burger 180g', preco: 14.9 },
      {
        empresaId: hamburgueria!.id,
        categoriaId: acompanhamentos!.id,
        nome: 'Cheddar fatiado',
        preco: 2.8,
      },
      {
        empresaId: hamburgueria!.id,
        categoriaId: acompanhamentos!.id,
        nome: 'Batata rustica',
        preco: 9.9,
      },
    ])
    .returning()

  console.log('Inserindo pratos...')
  const [bolonhesa, alfredo, classico, combo] = await db
    .insert(pratos)
    .values([
      {
        empresaId: cantina!.id,
        nome: 'Espaguete a bolonhesa',
        descricao: 'Massa fresca com molho de tomate e parmesao ralado na hora.',
        preco: 39.9,
      },
      {
        empresaId: cantina!.id,
        nome: 'Talharim ao alfredo',
        descricao: 'Talharim com molho branco e parmesao.',
        preco: 44.5,
      },
      {
        empresaId: hamburgueria!.id,
        nome: 'Classico',
        descricao: 'Pao brioche, burger 180g e cheddar.',
        preco: 32.0,
      },
      {
        empresaId: hamburgueria!.id,
        nome: 'Combo Classico + batata',
        descricao: 'O Classico acompanhado de batata rustica.',
        preco: 41.0,
      },
    ])
    .returning()

  console.log('Montando a composicao dos pratos (N:N)...')
  /**
   * Repare que `batata` e `cheddar` aparecem em mais de um prato, e que um
   * mesmo prato tem varios itens: e exatamente esse duplo "muitos" que a
   * tabela prato_itens existe para representar.
   */
  await db.insert(pratoItens).values([
    { pratoId: bolonhesa!.id, itemId: espaguete!.id },
    { pratoId: bolonhesa!.id, itemId: molhoTomate!.id },
    { pratoId: bolonhesa!.id, itemId: parmesao!.id },

    { pratoId: alfredo!.id, itemId: talharim!.id },
    { pratoId: alfredo!.id, itemId: molhoBranco!.id },
    { pratoId: alfredo!.id, itemId: parmesao!.id },

    { pratoId: classico!.id, itemId: brioche!.id },
    { pratoId: classico!.id, itemId: burger180!.id },
    { pratoId: classico!.id, itemId: cheddar!.id },

    { pratoId: combo!.id, itemId: brioche!.id },
    { pratoId: combo!.id, itemId: burger180!.id },
    { pratoId: combo!.id, itemId: cheddar!.id },
    { pratoId: combo!.id, itemId: batata!.id },
  ])

  console.log('\nSeed concluido:')
  console.log(`  3 UFs, 4 cidades, 3 empresas`)
  console.log(`  6 categorias, 10 itens, 4 pratos, 13 vinculos prato_itens`)
  console.log(`\n  Experimente: GET /pratos/${bolonhesa!.id}`)
  console.log(`  Empresa inativa (para testar o filtro ativo=false): ${boteco!.nome}`)
  console.log(`  UF sem cidades cadastradas: nenhuma -- todas as 3 tem cidade\n`)

  if (mussarela) {
    console.log(`  Item inativo (filtro ativo=false em /itens): ${mussarela.nome}`)
  }
}

seed()
  .then(async () => {
    await connection.end()
    process.exit(0)
  })
  .catch(async (erro) => {
    console.error('\nFalha ao executar o seed:\n', erro)
    await connection.end()
    process.exit(1)
  })
