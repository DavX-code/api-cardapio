/**
 * Verificacao end-to-end da API.
 *
 * Usa `app.inject()` do Fastify -- as requisicoes passam por todo o ciclo
 * (roteamento, validacao, handler, serializacao, error handler) sem abrir
 * uma porta de rede.
 *
 * Pre-requisitos: banco criado, migrations aplicadas e seed executado.
 *   npm run db:setup && npx tsx scripts/smoke.ts
 */
import { buildApp } from '../src/app.ts'
import { connection } from '../src/db/client.ts'

let passou = 0
let falhou = 0
const falhas: string[] = []

function check(nome: string, condicao: boolean, detalhe?: unknown) {
  if (condicao) {
    passou++
    console.log(`  ok   ${nome}`)
  } else {
    falhou++
    falhas.push(nome)
    console.log(`  FALHOU  ${nome}`)
    if (detalhe !== undefined) {
      console.log(`         ${JSON.stringify(detalhe).slice(0, 400)}`)
    }
  }
}

function secao(titulo: string) {
  console.log(`\n--- ${titulo} ---`)
}

const app = await buildApp()
await app.ready()

type Resposta = { status: number; body: any }

async function req(
  method: string,
  url: string,
  payload?: unknown,
): Promise<Resposta> {
  const res = await app.inject({ method: method as any, url, payload: payload as any })
  let body: any = null
  if (res.body) {
    try {
      body = res.json()
    } catch {
      body = res.body
    }
  }
  return { status: res.statusCode, body }
}

try {
  /* ====================================================================== */
  secao('Sistema')
  /* ====================================================================== */
  {
    const r = await req('GET', '/health')
    check('GET /health responde 200', r.status === 200, r.body)
    check('health informa status ok', r.body?.status === 'ok', r.body)

    const r404 = await req('GET', '/rota-que-nao-existe')
    check('rota inexistente -> 404', r404.status === 404, r404.body)
    check('404 traz code ROUTE_NOT_FOUND', r404.body?.code === 'ROUTE_NOT_FOUND', r404.body)

    const rInvalido = await req('GET', '/ufs/nao-e-uuid')
    check('id fora do formato UUID -> 400', rInvalido.status === 400, rInvalido.body)
    check(
      '400 de validacao traz code VALIDATION_ERROR',
      rInvalido.body?.code === 'VALIDATION_ERROR',
      rInvalido.body,
    )
  }

  /* ====================================================================== */
  secao('UFs - CRUDL')
  /* ====================================================================== */
  let ufCriadaId = ''
  let spId = ''
  {
    const lista = await req('GET', '/ufs')
    check('GET /ufs -> 200', lista.status === 200, lista.body)
    check('seed inseriu 3 UFs', lista.body?.meta?.total === 3, lista.body?.meta)
    check('envelope traz data + meta', Array.isArray(lista.body?.data), lista.body)
    check(
      'ordenado por sigla (MG primeiro)',
      lista.body?.data?.[0]?.sigla === 'MG',
      lista.body?.data,
    )

    spId = lista.body.data.find((u: any) => u.sigla === 'SP').id

    const busca = await req('GET', '/ufs?q=paulo')
    check('busca q=paulo encontra Sao Paulo', busca.body?.meta?.total === 1, busca.body?.meta)

    const pagina = await req('GET', '/ufs?page=1&limit=2')
    check('limit=2 devolve 2 registros', pagina.body?.data?.length === 2, pagina.body?.meta)
    check('totalPages calculado (3/2 = 2)', pagina.body?.meta?.totalPages === 2, pagina.body?.meta)

    const limiteInvalido = await req('GET', '/ufs?limit=500')
    check('limit acima do maximo -> 400', limiteInvalido.status === 400, limiteInvalido.body)

    const detalhe = await req('GET', `/ufs/${spId}`)
    check('GET /ufs/:id -> 200', detalhe.status === 200, detalhe.body)
    check('detalhe inclui as cidades (1:N)', detalhe.body?.cidades?.length === 2, detalhe.body)

    const inexistente = await req('GET', '/ufs/00000000-0000-4000-8000-000000000000')
    check('UF inexistente -> 404', inexistente.status === 404, inexistente.body)

    // CREATE: a sigla deve ser normalizada para maiuscula
    const criada = await req('POST', '/ufs', { sigla: 'pr', nome: 'Parana' })
    check('POST /ufs -> 201', criada.status === 201, criada.body)
    check('sigla normalizada para maiuscula', criada.body?.sigla === 'PR', criada.body)
    ufCriadaId = criada.body.id

    const duplicada = await req('POST', '/ufs', { sigla: 'PR', nome: 'Outro Parana' })
    check('sigla duplicada -> 409', duplicada.status === 409, duplicada.body)
    check(
      '409 traz mensagem traduzida da constraint',
      duplicada.body?.message?.includes('Ja existe uma UF'),
      duplicada.body,
    )

    const siglaRuim = await req('POST', '/ufs', { sigla: 'ABC', nome: 'Invalida' })
    check('sigla com 3 letras -> 400', siglaRuim.status === 400, siglaRuim.body)

    const semNome = await req('POST', '/ufs', { sigla: 'XX' })
    check('corpo sem campo obrigatorio -> 400', semNome.status === 400, semNome.body)

    const patch = await req('PATCH', `/ufs/${ufCriadaId}`, { nome: 'Parana Atualizado' })
    check('PATCH parcial -> 200', patch.status === 200, patch.body)
    check('PATCH alterou o nome', patch.body?.nome === 'Parana Atualizado', patch.body)
    check('PATCH preservou a sigla', patch.body?.sigla === 'PR', patch.body)

    const patchVazio = await req('PATCH', `/ufs/${ufCriadaId}`, {})
    check('PATCH com corpo vazio -> 400', patchVazio.status === 400, patchVazio.body)

    const put = await req('PUT', `/ufs/${ufCriadaId}`, { sigla: 'PR', nome: 'Parana' })
    check('PUT total -> 200', put.status === 200, put.body)

    const deleteComFilhos = await req('DELETE', `/ufs/${spId}`)
    check('DELETE de UF com cidades -> 409 (restrict)', deleteComFilhos.status === 409, deleteComFilhos.body)
    check(
      '409 explica o vinculo',
      deleteComFilhos.body?.message?.includes('cidades vinculadas'),
      deleteComFilhos.body,
    )

    const del = await req('DELETE', `/ufs/${ufCriadaId}`)
    check('DELETE de UF sem filhos -> 204', del.status === 204, del.body)

    const aposDelete = await req('GET', `/ufs/${ufCriadaId}`)
    check('registro removido -> 404', aposDelete.status === 404, aposDelete.body)
  }

  /* ====================================================================== */
  secao('Cidades e rotas aninhadas')
  /* ====================================================================== */
  let cidadeSpId = ''
  {
    const lista = await req('GET', '/cidades')
    check('GET /cidades -> 200', lista.status === 200, lista.body)
    check('seed inseriu 4 cidades', lista.body?.meta?.total === 4, lista.body?.meta)
    check('cidade traz a UF embutida', !!lista.body?.data?.[0]?.uf?.sigla, lista.body?.data?.[0])

    const filtrada = await req('GET', `/cidades?ufId=${spId}`)
    check('filtro ufId funciona', filtrada.body?.meta?.total === 2, filtrada.body?.meta)

    cidadeSpId = lista.body.data.find((c: any) => c.nome === 'Sao Paulo').id

    const detalhe = await req('GET', `/cidades/${cidadeSpId}`)
    check('detalhe traz uf (N:1)', detalhe.body?.uf?.sigla === 'SP', detalhe.body)
    check('detalhe traz empresas (1:N)', detalhe.body?.empresas?.length === 1, detalhe.body)

    const aninhada = await req('GET', `/ufs/${spId}/cidades`)
    check('GET /ufs/:id/cidades -> 200', aninhada.status === 200, aninhada.body)
    check('rota aninhada pagina', aninhada.body?.meta?.total === 2, aninhada.body?.meta)

    const paiInexistente = await req('GET', '/ufs/00000000-0000-4000-8000-000000000000/cidades')
    check('rota aninhada com pai inexistente -> 404', paiInexistente.status === 404, paiInexistente.body)

    const ufFalsa = await req('POST', '/cidades', {
      ufId: '00000000-0000-4000-8000-000000000000',
      nome: 'Cidade Fantasma',
    })
    check('FK inexistente -> 409', ufFalsa.status === 409, ufFalsa.body)
    check(
      '409 de FK traz mensagem traduzida',
      ufFalsa.body?.message?.includes('UF informada nao existe'),
      ufFalsa.body,
    )

    const duplicada = await req('POST', '/cidades', { ufId: spId, nome: 'Campinas' })
    check('cidade duplicada na mesma UF -> 409', duplicada.status === 409, duplicada.body)
  }

  /* ====================================================================== */
  secao('Empresas - CNPJ e filtros')
  /* ====================================================================== */
  let cantinaId = ''
  let burgerId = ''
  {
    const lista = await req('GET', '/empresas')
    check('GET /empresas -> 200', lista.status === 200, lista.body)
    check('seed inseriu 3 empresas', lista.body?.meta?.total === 3, lista.body?.meta)
    check(
      'relacao em 2 niveis: empresa -> cidade -> uf',
      !!lista.body?.data?.[0]?.cidade?.uf?.sigla,
      lista.body?.data?.[0],
    )

    cantinaId = lista.body.data.find((e: any) => e.nome === 'Cantina da Nonna').id
    burgerId = lista.body.data.find((e: any) => e.nome === 'Burger do Campus').id

    const ativas = await req('GET', '/empresas?ativo=true')
    check('filtro ativo=true -> 2 empresas', ativas.body?.meta?.total === 2, ativas.body?.meta)

    const inativas = await req('GET', '/empresas?ativo=false')
    check('filtro ativo=false -> 1 empresa', inativas.body?.meta?.total === 1, inativas.body?.meta)

    // CNPJ formatado deve ser normalizado para 14 digitos
    const criada = await req('POST', '/empresas', {
      cidadeId: cidadeSpId,
      nome: 'Pizzaria Teste',
      cnpj: '99.888.777/0001-66',
    })
    check('POST /empresas -> 201', criada.status === 201, criada.body)
    check('CNPJ normalizado para 14 digitos', criada.body?.cnpj === '99888777000166', criada.body)

    const cnpjDuplicado = await req('POST', '/empresas', {
      cidadeId: cidadeSpId,
      nome: 'Outra',
      cnpj: '99888777000166',
    })
    check('CNPJ duplicado -> 409', cnpjDuplicado.status === 409, cnpjDuplicado.body)

    const cnpjCurto = await req('POST', '/empresas', {
      cidadeId: cidadeSpId,
      nome: 'Curta',
      cnpj: '123',
    })
    check('CNPJ com menos de 14 digitos -> 400', cnpjCurto.status === 400, cnpjCurto.body)

    const semCnpj = await req('POST', '/empresas', { cidadeId: cidadeSpId, nome: 'Sem CNPJ' })
    check('CNPJ e opcional (nullable)', semCnpj.status === 201, semCnpj.body)
    check('CNPJ ausente vira null', semCnpj.body?.cnpj === null, semCnpj.body)

    const desativa = await req('PATCH', `/empresas/${semCnpj.body.id}`, { ativo: false })
    check('PATCH desativa a empresa', desativa.body?.ativo === false, desativa.body)

    // Limpeza das empresas criadas neste bloco
    await req('DELETE', `/empresas/${criada.body.id}`)
    await req('DELETE', `/empresas/${semCnpj.body.id}`)
  }

  /* ====================================================================== */
  secao('Categorias e Itens - coerencia entre FKs')
  /* ====================================================================== */
  let categoriaMassasId = ''
  let categoriaPaesId = ''
  {
    const cats = await req('GET', `/empresas/${cantinaId}/categorias`)
    check('GET /empresas/:id/categorias -> 200', cats.status === 200, cats.body)
    check('cantina tem 3 categorias', cats.body?.meta?.total === 3, cats.body?.meta)

    categoriaMassasId = cats.body.data.find((c: any) => c.nome === 'Massas').id

    const catsBurger = await req('GET', `/empresas/${burgerId}/categorias`)
    categoriaPaesId = catsBurger.body.data.find((c: any) => c.nome === 'Paes').id

    const detalhe = await req('GET', `/categorias/${categoriaMassasId}`)
    check('categoria traz empresa e itens', detalhe.body?.itens?.length === 2, detalhe.body)

    const duplicada = await req('POST', '/categorias', { empresaId: cantinaId, nome: 'Massas' })
    check('categoria duplicada na mesma empresa -> 409', duplicada.status === 409, duplicada.body)

    const mesmoNomeOutraEmpresa = await req('POST', '/categorias', {
      empresaId: burgerId,
      nome: 'Massas',
    })
    check(
      'mesmo nome em empresa diferente e permitido',
      mesmoNomeOutraEmpresa.status === 201,
      mesmoNomeOutraEmpresa.body,
    )
    await req('DELETE', `/categorias/${mesmoNomeOutraEmpresa.body.id}`)

    const deleteComItens = await req('DELETE', `/categorias/${categoriaMassasId}`)
    check(
      'DELETE de categoria com itens -> 409 (restrict)',
      deleteComItens.status === 409,
      deleteComItens.body,
    )

    // A regra de negocio: categoria tem que ser da mesma empresa do item
    const cruzado = await req('POST', '/itens', {
      empresaId: cantinaId,
      categoriaId: categoriaPaesId,
      nome: 'Item invalido',
      preco: 10,
    })
    check('item com categoria de outra empresa -> 409', cruzado.status === 409, cruzado.body)
    check(
      '409 explica a regra',
      cruzado.body?.message?.includes('categorias da propria empresa'),
      cruzado.body,
    )

    const valido = await req('POST', '/itens', {
      empresaId: cantinaId,
      categoriaId: categoriaMassasId,
      nome: 'Nhoque',
      preco: 11.75,
    })
    check('POST /itens valido -> 201', valido.status === 201, valido.body)
    check('preco volta como number, nao string', typeof valido.body?.preco === 'number', valido.body)
    check('preco preserva as 2 casas', valido.body?.preco === 11.75, valido.body)

    const precoQuebrado = await req('POST', '/itens', {
      empresaId: cantinaId,
      categoriaId: categoriaMassasId,
      nome: 'Preco ruim',
      preco: 10.999,
    })
    check('preco com 3 casas decimais -> 400', precoQuebrado.status === 400, precoQuebrado.body)

    const precoNegativo = await req('POST', '/itens', {
      empresaId: cantinaId,
      categoriaId: categoriaMassasId,
      nome: 'Negativo',
      preco: -5,
    })
    check('preco negativo -> 400', precoNegativo.status === 400, precoNegativo.body)

    const itemDefault = await req('POST', '/itens', {
      empresaId: cantinaId,
      categoriaId: categoriaMassasId,
      nome: 'Sem preco',
    })
    check('preco tem default 0', itemDefault.body?.preco === 0, itemDefault.body)
    check('ativo tem default true', itemDefault.body?.ativo === true, itemDefault.body)

    await req('DELETE', `/itens/${valido.body.id}`)
    await req('DELETE', `/itens/${itemDefault.body.id}`)

    const inativos = await req('GET', '/itens?ativo=false')
    check('filtro ativo=false em itens', inativos.body?.meta?.total === 1, inativos.body?.meta)

    const porCategoria = await req('GET', `/categorias/${categoriaMassasId}/itens`)
    check('GET /categorias/:id/itens -> 2 itens', porCategoria.body?.meta?.total === 2, porCategoria.body?.meta)
  }

  /* ====================================================================== */
  secao('Pratos - relacionamento N:N')
  /* ====================================================================== */
  {
    const pratos = await req('GET', '/pratos')
    check('GET /pratos -> 200', pratos.status === 200, pratos.body)
    check('seed inseriu 4 pratos', pratos.body?.meta?.total === 4, pratos.body?.meta)

    const bolonhesaId = pratos.body.data.find((p: any) => p.nome === 'Espaguete a bolonhesa').id
    const comboId = pratos.body.data.find((p: any) => p.nome.startsWith('Combo')).id

    const detalhe = await req('GET', `/pratos/${bolonhesaId}`)
    check('GET /pratos/:id -> 200', detalhe.status === 200, detalhe.body)
    check('prato traz 3 itens (N:N achatado)', detalhe.body?.itens?.length === 3, detalhe.body)
    check(
      'item do prato traz sua categoria (3 niveis)',
      !!detalhe.body?.itens?.[0]?.categoria?.nome,
      detalhe.body?.itens?.[0],
    )
    // 8.50 (espaguete) + 6.00 (molho) + 4.75 (parmesao) = 19.25
    check('custoItens somado corretamente', detalhe.body?.custoItens === 19.25, detalhe.body?.custoItens)

    const combo = await req('GET', `/pratos/${comboId}`)
    check('combo tem 4 itens', combo.body?.itens?.length === 4, combo.body?.itens?.length)

    const itensDoPrato = await req('GET', `/pratos/${bolonhesaId}/itens`)
    check('GET /pratos/:id/itens -> 200', itensDoPrato.status === 200, itensDoPrato.body)
    check('join paginado conta 3', itensDoPrato.body?.meta?.total === 3, itensDoPrato.body?.meta)

    // Item ja presente no prato -> viola o UNIQUE de prato_itens
    const itemExistente = detalhe.body.itens[0].id
    const duplicado = await req('POST', `/pratos/${bolonhesaId}/itens`, { itemId: itemExistente })
    check('vincular item repetido -> 409', duplicado.status === 409, duplicado.body)
    check(
      '409 explica que o item ja esta no prato',
      duplicado.body?.message?.includes('ja faz parte do prato'),
      duplicado.body,
    )

    // Item de outra empresa
    const itensBurger = await req('GET', `/empresas/${burgerId}/itens`)
    const itemDeOutraEmpresa = itensBurger.body.data[0].id
    const cruzado = await req('POST', `/pratos/${bolonhesaId}/itens`, { itemId: itemDeOutraEmpresa })
    check('vincular item de outra empresa -> 409', cruzado.status === 409, cruzado.body)

    // Vincular um item valido ainda nao usado
    const itensCantina = await req('GET', `/empresas/${cantinaId}/itens`)
    const jaNoPrato = new Set(detalhe.body.itens.map((i: any) => i.id))
    const novoItem = itensCantina.body.data.find((i: any) => !jaNoPrato.has(i.id))

    const vinculo = await req('POST', `/pratos/${bolonhesaId}/itens`, { itemId: novoItem.id })
    check('vincular item valido -> 201', vinculo.status === 201, vinculo.body)

    const agora4 = await req('GET', `/pratos/${bolonhesaId}`)
    check('prato passou a ter 4 itens', agora4.body?.itens?.length === 4, agora4.body?.itens?.length)

    // Desvincular
    const desvinculo = await req('DELETE', `/pratos/${bolonhesaId}/itens/${novoItem.id}`)
    check('desvincular item -> 204', desvinculo.status === 204, desvinculo.body)

    const desvinculoRepetido = await req('DELETE', `/pratos/${bolonhesaId}/itens/${novoItem.id}`)
    check('desvincular de novo -> 404', desvinculoRepetido.status === 404, desvinculoRepetido.body)

    const voltou3 = await req('GET', `/pratos/${bolonhesaId}`)
    check('prato voltou a 3 itens', voltou3.body?.itens?.length === 3, voltou3.body?.itens?.length)

    // Substituir a composicao inteira (transacao)
    const doisItens = itensCantina.body.data.slice(0, 2).map((i: any) => i.id)
    const substituir = await req('PUT', `/pratos/${bolonhesaId}/itens`, { itensIds: doisItens })
    check('PUT composicao -> 200', substituir.status === 200, substituir.body)

    const aposSubstituir = await req('GET', `/pratos/${bolonhesaId}`)
    check('composicao agora tem 2 itens', aposSubstituir.body?.itens?.length === 2, aposSubstituir.body?.itens?.length)

    // Ids repetidos na lista devem ser deduplicados, nao estourar o UNIQUE
    const comRepetidos = await req('PUT', `/pratos/${bolonhesaId}/itens`, {
      itensIds: [doisItens[0], doisItens[0], doisItens[1]],
    })
    check('ids repetidos sao deduplicados -> 200', comRepetidos.status === 200, comRepetidos.body)
    check('deduplicacao resultou em 2 ids', comRepetidos.body?.itensIds?.length === 2, comRepetidos.body)

    // Transacao: se um item e invalido, NADA deve mudar
    const antesDaFalha = await req('GET', `/pratos/${bolonhesaId}`)
    const falha = await req('PUT', `/pratos/${bolonhesaId}/itens`, {
      itensIds: [doisItens[0], '00000000-0000-4000-8000-000000000000'],
    })
    check('composicao com item inexistente -> 404', falha.status === 404, falha.body)

    const depoisDaFalha = await req('GET', `/pratos/${bolonhesaId}`)
    check(
      'composicao nao foi alterada pela falha (atomicidade)',
      depoisDaFalha.body?.itens?.length === antesDaFalha.body?.itens?.length,
      { antes: antesDaFalha.body?.itens?.length, depois: depoisDaFalha.body?.itens?.length },
    )

    // Esvaziar a composicao
    const esvaziar = await req('PUT', `/pratos/${bolonhesaId}/itens`, { itensIds: [] })
    check('esvaziar composicao -> 200', esvaziar.status === 200, esvaziar.body)
    const vazio = await req('GET', `/pratos/${bolonhesaId}`)
    check('prato ficou sem itens', vazio.body?.itens?.length === 0, vazio.body?.itens?.length)
    check('custoItens de prato vazio e 0', vazio.body?.custoItens === 0, vazio.body?.custoItens)

    // Criar prato ja com composicao, numa transacao
    const comComposicao = await req('POST', '/pratos', {
      empresaId: cantinaId,
      nome: 'Prato montado no cadastro',
      preco: 50,
      itensIds: doisItens,
    })
    check('POST /pratos com itensIds -> 201', comComposicao.status === 201, comComposicao.body)
    const conferindo = await req('GET', `/pratos/${comComposicao.body.id}`)
    check('composicao foi gravada junto', conferindo.body?.itens?.length === 2, conferindo.body?.itens?.length)

    await req('DELETE', `/pratos/${comComposicao.body.id}`)

    // Ver o N:N pelo lado do item
    const itemUsado = await req('GET', `/itens/${doisItens[0]}`)
    check('item lista os pratos que o usam', Array.isArray(itemUsado.body?.pratos), itemUsado.body)
  }

  /* ====================================================================== */
  secao('Cascade ao remover empresa')
  /* ====================================================================== */
  {
    // Cria uma empresa isolada com categoria, item e prato, e apaga tudo de uma vez
    const empresa = await req('POST', '/empresas', {
      cidadeId: cidadeSpId,
      nome: 'Empresa Descartavel',
    })
    const categoria = await req('POST', '/categorias', {
      empresaId: empresa.body.id,
      nome: 'Categoria Descartavel',
    })
    const item = await req('POST', '/itens', {
      empresaId: empresa.body.id,
      categoriaId: categoria.body.id,
      nome: 'Item Descartavel',
      preco: 1,
    })
    const prato = await req('POST', '/pratos', {
      empresaId: empresa.body.id,
      nome: 'Prato Descartavel',
      preco: 2,
      itensIds: [item.body.id],
    })

    check('cenario montado', prato.status === 201, prato.body)

    const del = await req('DELETE', `/empresas/${empresa.body.id}`)
    check('DELETE empresa -> 204', del.status === 204, del.body)

    const cat = await req('GET', `/categorias/${categoria.body.id}`)
    check('categoria removida em cascata', cat.status === 404, cat.body)

    const it = await req('GET', `/itens/${item.body.id}`)
    check('item removido em cascata', it.status === 404, it.body)

    const pr = await req('GET', `/pratos/${prato.body.id}`)
    check('prato removido em cascata', pr.status === 404, pr.body)
  }

  /* ====================================================================== */
  secao('Documentacao OpenAPI')
  /* ====================================================================== */
  {
    const doc = app.swagger() as any
    const rotas = Object.keys(doc.paths ?? {})
    check('OpenAPI gerado', rotas.length > 0, rotas.length)
    check('todas as rotas documentadas (>= 40)', rotas.length >= 15, rotas.length)
    check(
      'schema de prato documentado',
      JSON.stringify(doc).includes('custoItens'),
      null,
    )

    let totalOperacoes = 0
    for (const rota of rotas) totalOperacoes += Object.keys(doc.paths[rota]).length
    console.log(`         (${rotas.length} caminhos, ${totalOperacoes} operacoes)`)
  }
} finally {
  await app.close()
  await connection.end()
}

console.log(`\n${'='.repeat(52)}`)
console.log(`  RESULTADO: ${passou} passaram, ${falhou} falharam`)
console.log('='.repeat(52))

if (falhou > 0) {
  console.log('\nFalhas:')
  for (const f of falhas) console.log(`  - ${f}`)
  process.exit(1)
}

process.exit(0)
