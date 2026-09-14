CREATE TABLE "exchange_snapshots" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exchange_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cryptocurrency_id" integer NOT NULL,
	"exchange_id" integer NOT NULL,
	"buy_price" numeric NOT NULL,
	"sell_price" numeric NOT NULL,
	"buy_amount" numeric NOT NULL,
	"sell_amount" numeric NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exchange_snapshots" ADD CONSTRAINT "exchange_snapshots_cryptocurrency_id_cryptocurrencies_id_fk" FOREIGN KEY ("cryptocurrency_id") REFERENCES "public"."cryptocurrencies"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exchange_snapshots" ADD CONSTRAINT "exchange_snapshots_exchange_id_exchanges_id_fk" FOREIGN KEY ("exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "exchange_snapshots_crypto_exchange_captured_idx" ON "exchange_snapshots" USING btree ("cryptocurrency_id","exchange_id","captured_at");