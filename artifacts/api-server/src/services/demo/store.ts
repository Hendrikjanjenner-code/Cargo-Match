import { pool } from "@workspace/db";
import type { DemoState, Sandbox } from "./types";
import { DemoError } from "./types";

export interface DemoStore {
  create(tokenHash: string, sandbox: Sandbox): Promise<void>;
  transact<T>(tokenHash: string, operation: (sandbox: Sandbox) => T | Promise<T>, remove?: boolean): Promise<T>;
}
/** Only demo_sandboxes is queried. Row locking serializes switches, reset,
 * consent, edits and messages without touching the production mutation lock. */
export const postgresDemoStore: DemoStore = {
  async create(tokenHash, sandbox) {
    await pool.query(`INSERT INTO demo_sandboxes (token_hash, csrf_token, persona_id, revision, state, expires_at)
      VALUES ($1, $2, $3, $4, $5::jsonb, now() + interval '14 days')`,
    [tokenHash, sandbox.csrfToken, sandbox.personaId, sandbox.revision, JSON.stringify(sandbox.state)]);
  },
  async transact(tokenHash, operation, remove = false) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(`SELECT csrf_token, persona_id, revision, state FROM demo_sandboxes
        WHERE token_hash = $1 AND expires_at > now() FOR UPDATE`, [tokenHash]);
      if (!rows.length) throw new DemoError(401, "NO_DEMO_SESSION", "Start eerst een aparte demo.");
      const row = rows[0];
      const sandbox: Sandbox = { csrfToken: row.csrf_token as string, personaId: row.persona_id as string, revision: row.revision as number, state: row.state as DemoState };
      const result = await operation(sandbox);
      if (remove) await client.query("DELETE FROM demo_sandboxes WHERE token_hash = $1", [tokenHash]);
      else await client.query(`UPDATE demo_sandboxes SET csrf_token=$2, persona_id=$3, revision=$4, state=$5::jsonb WHERE token_hash=$1`,
        [tokenHash, sandbox.csrfToken, sandbox.personaId, sandbox.revision, JSON.stringify(sandbox.state)]);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  },
};