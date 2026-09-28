CREATE TABLE "ufs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sigla" varchar(2) NOT NULL,
	"nome" varchar(100) NOT NULL,
	CONSTRAINT "ufs_sigla_unique" UNIQUE("sigla")
);
--> statement-breakpoint
CREATE TABLE "cidades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uf_id" uuid NOT NULL,
	"nome" varchar(150) NOT NULL,
	CONSTRAINT "cidades_uf_id_nome_unique" UNIQUE("uf_id","nome")
);
--> statement-breakpoint
CREATE TABLE "empresas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cidade_id" uuid NOT NULL,
	"nome" varchar(150) NOT NULL,
	"cnpj" varchar(14),
	"ativo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "empresas_cnpj_unique" UNIQUE("cnpj")
);
--> statement-breakpoint
CREATE TABLE "categorias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" varchar(100) NOT NULL,
	CONSTRAINT "categorias_empresa_id_nome_unique" UNIQUE("empresa_id","nome")
);
--> statement-breakpoint
CREATE TABLE "itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"categoria_id" uuid NOT NULL,
	"nome" varchar(150) NOT NULL,
	"preco" numeric(10, 2) DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pratos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"empresa_id" uuid NOT NULL,
	"nome" varchar(150) NOT NULL,
	"descricao" text,
	"preco" numeric(10, 2) DEFAULT 0 NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prato_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prato_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	CONSTRAINT "prato_itens_prato_id_item_id_unique" UNIQUE("prato_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "cidades" ADD CONSTRAINT "cidades_uf_id_ufs_id_fk" FOREIGN KEY ("uf_id") REFERENCES "public"."ufs"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "empresas" ADD CONSTRAINT "empresas_cidade_id_cidades_id_fk" FOREIGN KEY ("cidade_id") REFERENCES "public"."cidades"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "itens" ADD CONSTRAINT "itens_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "itens" ADD CONSTRAINT "itens_categoria_id_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pratos" ADD CONSTRAINT "pratos_empresa_id_empresas_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresas"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "prato_itens" ADD CONSTRAINT "prato_itens_prato_id_pratos_id_fk" FOREIGN KEY ("prato_id") REFERENCES "public"."pratos"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "prato_itens" ADD CONSTRAINT "prato_itens_item_id_itens_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."itens"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "ufs_nome_idx" ON "ufs" USING btree ("nome");--> statement-breakpoint
CREATE INDEX "cidades_uf_id_idx" ON "cidades" USING btree ("uf_id");--> statement-breakpoint
CREATE INDEX "empresas_cidade_id_idx" ON "empresas" USING btree ("cidade_id");--> statement-breakpoint
CREATE INDEX "empresas_ativo_idx" ON "empresas" USING btree ("ativo");--> statement-breakpoint
CREATE INDEX "categorias_empresa_id_idx" ON "categorias" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "itens_empresa_id_idx" ON "itens" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "itens_categoria_id_idx" ON "itens" USING btree ("categoria_id");--> statement-breakpoint
CREATE INDEX "itens_ativo_idx" ON "itens" USING btree ("ativo");--> statement-breakpoint
CREATE INDEX "pratos_empresa_id_idx" ON "pratos" USING btree ("empresa_id");--> statement-breakpoint
CREATE INDEX "pratos_ativo_idx" ON "pratos" USING btree ("ativo");--> statement-breakpoint
CREATE INDEX "prato_itens_prato_id_idx" ON "prato_itens" USING btree ("prato_id");--> statement-breakpoint
CREATE INDEX "prato_itens_item_id_idx" ON "prato_itens" USING btree ("item_id");