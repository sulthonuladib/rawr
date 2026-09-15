import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { schema, type Db } from "./schema.js"

export const connectionString =
  process.env["DATABASE_URL"] ?? "postgres://rawr:rawr@localhost:5433/rawr"

export const pool = new pg.Pool({ connectionString })

export const db: Db = drizzle(pool, { schema })
