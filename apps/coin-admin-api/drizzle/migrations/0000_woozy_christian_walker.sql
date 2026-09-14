CREATE TYPE "public"."cryptocurrency_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "chains" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chains_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chains_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "cryptocurrencies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cryptocurrencies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cmc_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text NOT NULL,
	"status" "cryptocurrency_status" DEFAULT 'active' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cryptocurrencies_cmc_id_unique" UNIQUE("cmc_id")
);
--> statement-breakpoint
CREATE TABLE "exchange_cryptocurrency" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exchange_cryptocurrency_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cryptocurrency_id" integer NOT NULL,
	"exchange_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"alternate_symbol" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_cryptocurrency_unique" UNIQUE("cryptocurrency_id","exchange_id")
);
--> statement-breakpoint
CREATE TABLE "exchange_cryptocurrency_chain" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exchange_cryptocurrency_chain_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"exchange_cryptocurrency_id" integer NOT NULL,
	"chain_id" integer NOT NULL,
	"exchange_chain_code" text NOT NULL,
	"exchange_chain_name" text,
	"withdraw_enabled" boolean DEFAULT true NOT NULL,
	"deposit_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_cryptocurrency_chain_unique" UNIQUE("exchange_cryptocurrency_id","chain_id")
);
--> statement-breakpoint
CREATE TABLE "exchanges" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exchanges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchanges_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "exchange_cryptocurrency" ADD CONSTRAINT "exchange_cryptocurrency_cryptocurrency_id_cryptocurrencies_id_fk" FOREIGN KEY ("cryptocurrency_id") REFERENCES "public"."cryptocurrencies"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exchange_cryptocurrency" ADD CONSTRAINT "exchange_cryptocurrency_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exchange_cryptocurrency_chain" ADD CONSTRAINT "exchange_cryptocurrency_chain_exchange_cryptocurrency_id_exchange_cryptocurrency_id_fk" FOREIGN KEY ("exchange_cryptocurrency_id") REFERENCES "public"."exchange_cryptocurrency"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exchange_cryptocurrency_chain" ADD CONSTRAINT "exchange_cryptocurrency_chain_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE cascade;