CREATE TABLE "exchange_opportunities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exchange_opportunities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cryptocurrency_id" integer NOT NULL,
	"buy_exchange_id" integer NOT NULL,
	"sell_exchange_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"buy_price" numeric NOT NULL,
	"sell_price" numeric NOT NULL,
	"buy_amount" numeric NOT NULL,
	"sell_amount" numeric NOT NULL,
	"profit_percentage" numeric NOT NULL,
	"expired_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exchange_opportunities" ADD CONSTRAINT "exchange_opportunities_cryptocurrency_id_cryptocurrencies_id_fk" FOREIGN KEY ("cryptocurrency_id") REFERENCES "public"."cryptocurrencies"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exchange_opportunities" ADD CONSTRAINT "exchange_opportunities_buy_exchange_id_exchanges_id_fk" FOREIGN KEY ("buy_exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "exchange_opportunities" ADD CONSTRAINT "exchange_opportunities_sell_exchange_id_exchanges_id_fk" FOREIGN KEY ("sell_exchange_id") REFERENCES "public"."exchanges"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "exchange_opportunities_expired_profit_idx" ON "exchange_opportunities" USING btree ("expired_at","profit_percentage");