# API Cardápio

API REST construída com **Fastify**, **TypeScript** e **Drizzle ORM** sobre **PostgreSQL**,
implementando o modelo de dados da Atividade 001.

O domínio modela um catálogo de cardápios: estabelecimentos (`empresas`) localizados em
`cidades` de uma `uf`, que organizam seus `itens` em `categorias` e os combinam em `pratos`.

---

## Sumário

- [Requisitos](#requisitos)
- [Como executar](#como-executar)
- [Modelo de dados](#modelo-de-dados)
- [Endpoints](#endpoints)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Decisões de implementação](#decisões-de-implementação)
- [Scripts disponíveis](#scripts-disponíveis)

---

## Requisitos

| Ferramenta | Versão |
| ---------- | ------ |
| Node.js    | 20 ou superior |
| PostgreSQL | 14 ou superior |

O projeto usa apenas a API nativa de TypeScript do `tsx`, então **não é necessário
compilar** antes de rodar.

---

## Como executar

### 1. Instalar as dependências

```bash
npm install
```

### 2. Subir o banco de dados

Com Docker (recomendado — já vem configurado):

```bash
docker compose up -d
```

Sem Docker, crie um banco chamado `cardapio` no seu PostgreSQL local e ajuste a
`DATABASE_URL` no arquivo `.env`.

### 3. Configurar as variáveis de ambiente

```bash
cp .env.example .env
```

O arquivo `.env.example` já aponta para o banco do `docker-compose.yml`, então na maioria
dos casos não é preciso alterar nada.

### 4. Criar as tabelas e popular com dados de exemplo

```bash
npm run db:setup
```

Esse comando roda as migrations (`db:migrate`) e o seed (`db:seed`) em sequência.

### 5. Subir a API

```bash
npm run dev
```

A API sobe em `http://localhost:3333` e a **documentação interativa (Swagger UI)** fica
disponível em **`http://localhost:3333/docs`**, onde é possível testar todos os endpoints
direto pelo navegador.

---

## Modelo de dados

```
                ┌─────────┐
                │   ufs   │
                └────┬────┘
                     │ 1:N
                ┌────▼────┐
                │ cidades │
                └────┬────┘
                     │ 1:N
                ┌────▼─────┐
         ┌──────┤ empresas ├──────┐
         │ 1:N  └────┬─────┘ 1:N  │
         │           │ 1:N        │
   ┌─────▼──────┐    │      ┌─────▼────┐
   │ categorias │    │      │  pratos  │
   └─────┬──────┘    │      └─────┬────┘
         │ 1:N       │            │
      ┌──▼───────────▼─┐          │
      │      itens     │          │
      └────────┬───────┘          │
               │       N:N        │
               └──► prato_itens ◄─┘
```

Todas as chaves primárias são `uuid` geradas pelo banco (`gen_random_uuid()`).

| Tabela | Colunas |
| ------ | ------- |
| `ufs` | `id`, `sigla` (varchar 2, único), `nome` (varchar 100) |
| `cidades` | `id`, `uf_id` → `ufs`, `nome` (varchar 150) |
| `empresas` | `id`, `cidade_id` → `cidades`, `nome` (varchar 150), `cnpj` (varchar 14, único, opcional), `ativo` |
| `categorias` | `id`, `empresa_id` → `empresas`, `nome` (varchar 100) |
| `itens` | `id`, `empresa_id` → `empresas`, `categoria_id` → `categorias`, `nome`, `preco` (numeric 10,2), `ativo` |
| `pratos` | `id`, `empresa_id` → `empresas`, `nome`, `descricao` (text), `preco` (numeric 10,2), `ativo` |
| `prato_itens` | `id`, `prato_id` → `pratos`, `item_id` → `itens` — único por par |

### Comportamento das foreign keys

| Relação | `ON DELETE` | Por quê |
| ------- | ----------- | ------- |
| `cidades` → `ufs` | `restrict` | Apagar uma UF com cidades seria perda de dado silenciosa. |
| `empresas` → `cidades` | `restrict` | Idem. |
| `categorias` → `empresas` | `cascade` | Uma categoria não existe fora da empresa que a criou. |
| `itens` → `empresas` | `cascade` | Idem. |
| `itens` → `categorias` | `restrict` | Apagar a categoria deixaria o item sem classificação. |
| `pratos` → `empresas` | `cascade` | Idem categorias. |
| `prato_itens` → `pratos` / `itens` | `cascade` | Vínculos não fazem sentido sem as duas pontas. |

---

## Endpoints

Todos os recursos expõem o CRUDL completo. Substituindo `{recurso}` por
`ufs`, `cidades`, `empresas`, `categorias`, `itens` ou `pratos`:

| Método | Rota | Descrição |
| ------ | ---- | --------- |
| `GET` | `/{recurso}` | **L**ista, paginada e filtrável |
| `GET` | `/{recurso}/:id` | **R**ead — traz as relações resolvidas |
| `POST` | `/{recurso}` | **C**reate |
| `PUT` | `/{recurso}/:id` | **U**pdate total |
| `PATCH` | `/{recurso}/:id` | Update parcial |
| `DELETE` | `/{recurso}/:id` | **D**elete |

### Rotas de navegação entre relacionamentos

| Método | Rota |
| ------ | ---- |
| `GET` | `/ufs/:id/cidades` |
| `GET` | `/cidades/:id/empresas` |
| `GET` | `/empresas/:id/categorias` |
| `GET` | `/empresas/:id/itens` |
| `GET` | `/empresas/:id/pratos` |
| `GET` | `/categorias/:id/itens` |

### Composição de pratos (relacionamento N:N)

| Método | Rota | Descrição |
| ------ | ---- | --------- |
| `GET` | `/pratos/:id/itens` | Lista os itens que compõem o prato |
| `POST` | `/pratos/:id/itens` | Adiciona um item (`{ "itemId": "uuid" }`) |
| `PUT` | `/pratos/:id/itens` | Substitui toda a composição (`{ "itensIds": [...] }`) |
| `DELETE` | `/pratos/:id/itens/:itemId` | Remove um item do prato |

### Parâmetros de listagem

| Parâmetro | Padrão | Descrição |
| --------- | ------ | --------- |
| `page` | `1` | Página atual |
| `limit` | `20` | Registros por página (máx. 100) |
| `q` | — | Busca textual por nome (case-insensitive) |

Filtros adicionais por recurso: `ufId` (cidades), `cidadeId`/`ativo` (empresas),
`empresaId` (categorias), `empresaId`/`categoriaId`/`ativo` (itens, pratos).

### Formato das respostas

Listagens vêm envelopadas com metadados de paginação:

```json
{
  "data": [ ... ],
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

Erros seguem sempre o mesmo formato:

```json
{
  "message": "Essa empresa já possui uma categoria com esse nome.",
  "code": "UNIQUE_VIOLATION"
}
```

| Status | Quando |
| ------ | ------ |
| `400` | Corpo, query ou parâmetro fora do schema |
| `404` | Recurso inexistente |
| `409` | Violação de unicidade, de foreign key ou de regra de negócio |
| `500` | Erro inesperado (detalhes só aparecem em `development`) |

---

## Estrutura do projeto

```
projeto/
├── docker-compose.yml       # PostgreSQL para desenvolvimento
├── drizzle.config.ts        # Configuração do drizzle-kit
├── drizzle/                 # Migrations SQL geradas
└── src/
    ├── server.ts            # Boot do processo e graceful shutdown
    ├── app.ts               # Fastify, plugins e error handler central
    ├── env.ts               # Validação das variáveis de ambiente
    ├── db/
    │   ├── client.ts        # Pool do Postgres + instância do Drizzle
    │   ├── seed.ts          # Dados de exemplo
    │   └── schema/          # Uma tabela por arquivo + relations.ts
    ├── lib/
    │   ├── errors.ts        # Erros de domínio e códigos SQLSTATE
    │   ├── constraints.ts   # Constraint do banco → mensagem de usuário
    │   └── validation.ts    # Schemas Zod compartilhados
    └── routes/              # Um plugin Fastify por recurso
```

---

## Decisões de implementação

**Schemas Zod como fonte única de verdade.** Os mesmos schemas validam a entrada,
serializam a saída e geram a documentação OpenAPI. Não existe um DTO separado que possa
divergir do que a rota realmente aceita.

**Tratamento de erro centralizado.** Nenhuma rota tem `try/catch`. O error handler em
`app.ts` traduz erros de validação, erros de domínio e códigos SQLSTATE do PostgreSQL para
o formato único de resposta.

**Constraints validadas pelo banco, não por `SELECT` prévio.** Em vez de consultar "já
existe?" antes de inserir — o que é mais lento e tem condição de corrida entre a consulta
e a escrita —, a aplicação tenta a operação e traduz a constraint violada em mensagem
legível (`src/lib/constraints.ts`).

**Relational Query API onde cabe, SQL explícito onde não cabe.** `db.query...with` resolve
as relações em uma ida ao banco, sem N+1. Nas listagens que precisam paginar *pela relação*
— como `/pratos/:id/itens` — o `INNER JOIN` é escrito à mão, porque a Relational Query API
pagina o registro raiz, não a relação.

**Coerência que a FK não garante.** `itens` tem duas foreign keys independentes
(`empresa_id` e `categoria_id`). Ambas podem ser válidas isoladamente e ainda assim
descrever um estado inconsistente: um item da empresa A usando categoria da empresa B.
Essa regra é verificada explicitamente na aplicação, e a mesma lógica vale para a
composição dos pratos.

**Operações compostas em transação.** Criar um prato com sua composição, ou substituir a
composição inteira, acontece dentro de `db.transaction()` — sem isso, uma falha no meio
deixaria o prato sem nenhum item.

---

## Verificação automatizada

O projeto inclui uma verificação end-to-end que exercita todos os endpoints:

```bash
npm run test:smoke
```

Ela usa `app.inject()` do Fastify — as requisições passam por todo o ciclo (roteamento,
validação, handler, serialização, error handler) sem abrir porta de rede. São **110
verificações**, cobrindo CRUDL de todos os recursos, os filtros e a paginação, o
relacionamento N:N, a atomicidade das transações, o comportamento de `cascade`/`restrict` e
a geração do OpenAPI.

> Requer o banco criado e populado (`npm run db:setup`). O script **altera os dados** — rode
> `npm run db:seed` depois para restaurar o estado inicial. Não use contra um banco com
> dados que você queira preservar.

---

## Scripts disponíveis

| Script | O que faz |
| ------ | --------- |
| `npm run dev` | Sobe a API em modo watch |
| `npm run test:smoke` | Roda a verificação end-to-end (110 checagens) |
| `npm start` | Sobe a API sem watch |
| `npm run build` | Checagem de tipos (`tsc --noEmit`) |
| `npm run db:generate` | Gera uma migration a partir do schema |
| `npm run db:migrate` | Aplica as migrations pendentes |
| `npm run db:push` | Sincroniza o schema sem gerar migration (só em dev) |
| `npm run db:seed` | Popula o banco com dados de exemplo |
| `npm run db:setup` | `db:migrate` + `db:seed` |
| `npm run db:studio` | Abre o Drizzle Studio para inspecionar os dados |
