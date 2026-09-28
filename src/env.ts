import 'dotenv/config'
import { z } from 'zod'

/**
 * Traduz as mensagens padrao do Zod para portugues.
 *
 * Sem isso, erros que nao tem mensagem customizada saem em ingles
 * ("Invalid input: expected string, received undefined"), deixando a resposta
 * da API com dois idiomas misturados. Como este modulo e importado logo no
 * inicio da cadeia (env -> client -> app), a configuracao vale para todos
 * os schemas da aplicacao.
 */
z.config(z.locales.ptBR())

/**
 * Validacao das variaveis de ambiente.
 *
 * Fazer isso no boot (e nao espalhado pelo codigo) garante que a aplicacao
 * falhe imediatamente, com uma mensagem clara, se algo estiver faltando --
 * em vez de quebrar mais tarde no meio de uma requisicao.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().positive().default(3333),
  HOST: z.string().default('0.0.0.0'),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('\n[env] Variaveis de ambiente invalidas:\n')
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`)
  }
  console.error('\nCopie o arquivo .env.example para .env e preencha os valores.\n')
  process.exit(1)
}

export const env = parsed.data
