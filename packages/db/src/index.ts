import { neon } from "@neondatabase/serverless";
import { env } from "@vbaas/env/server";
import { drizzle } from "drizzle-orm/neon-http";

import {
  account,
  accountRelations,
  session,
  sessionRelations,
  user,
  userRelations,
  verification,
} from "./schema/auth";

const schema = {
  account,
  accountRelations,
  session,
  sessionRelations,
  user,
  userRelations,
  verification,
} as const;

export function createDb() {
  const sql = neon(env.DATABASE_URL || "");
  return drizzle(sql, { schema });
}
