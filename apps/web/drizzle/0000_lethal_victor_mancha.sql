CREATE TYPE "public"."frequency" AS ENUM('tick', '1m', '5m', '1h', '4h', '1d', '1w', '1mo', 'irregular');--> statement-breakpoint
CREATE TYPE "public"."liquidation_side" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('fred', 'binance', 'bybit', 'coinmetrics', 'coingecko', 'stooq', 'coinglass', 'alternativeme', 'mempool', 'derived');--> statement-breakpoint
CREATE TYPE "public"."series_group" AS ENUM('crypto', 'equities', 'fx', 'rates', 'macro', 'onchain', 'derivatives', 'sentiment');--> statement-breakpoint
CREATE TYPE "public"."series_unit" AS ENUM('usd', 'pct', 'ratio', 'index', 'bps', 'usd_bn', 'hashrate', 'count');--> statement-breakpoint
CREATE TABLE "liquidations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"exchange" text NOT NULL,
	"symbol" text NOT NULL,
	"side" "liquidation_side" NOT NULL,
	"price" double precision NOT NULL,
	"qty" double precision NOT NULL,
	"quote_qty" double precision NOT NULL,
	"t" bigint NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"provider" "provider" NOT NULL,
	"endpoint" text NOT NULL,
	"http_status" integer,
	"duration_ms" integer NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"group" "series_group" NOT NULL,
	"unit" "series_unit" NOT NULL,
	"native_frequency" "frequency" NOT NULL,
	"provider" "provider" NOT NULL,
	"provider_params" jsonb NOT NULL,
	"earliest" text NOT NULL,
	"supports_log" boolean NOT NULL,
	"update_cadence" integer NOT NULL,
	"attribution" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_points" (
	"series_id" text NOT NULL,
	"t" bigint NOT NULL,
	"v" double precision NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "series_points_series_id_t_pk" PRIMARY KEY("series_id","t")
);
--> statement-breakpoint
CREATE TABLE "series_sync_state" (
	"series_id" text PRIMARY KEY NOT NULL,
	"last_point_t" bigint,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "series_points" ADD CONSTRAINT "series_points_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_sync_state" ADD CONSTRAINT "series_sync_state_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "liquidations_t_idx" ON "liquidations" USING btree ("t");--> statement-breakpoint
CREATE INDEX "liquidations_symbol_t_idx" ON "liquidations" USING btree ("symbol","t");--> statement-breakpoint
CREATE UNIQUE INDEX "liquidations_dedupe_idx" ON "liquidations" USING btree ("exchange","symbol","t","price","qty");--> statement-breakpoint
CREATE INDEX "provider_requests_provider_time_idx" ON "provider_requests" USING btree ("provider","requested_at");--> statement-breakpoint
CREATE INDEX "series_points_t_idx" ON "series_points" USING btree ("t");