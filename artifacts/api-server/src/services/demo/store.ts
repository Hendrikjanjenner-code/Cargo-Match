import { randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import type { DemoState, Sandbox, Persona } from "./types";
import { DemoError } from "./types";
import { PERSONAS, COMPANIES } from "./seed";

export interface DemoStore {
  create(tokenHash: string, sandbox: Sandbox): Promise<void>;
  transact<T>(tokenHash: string, operation: (sandbox: Sandbox) => T | Promise<T>, remove?: boolean): Promise<T>;
}
// A test worker may choose a disposable namespace, never a production name.
export const DEMO_ECOSYSTEM = process.env.NODE_ENV === "test" && /^test-[a-z0-9-]+$/.test(process.env.DEMO_TEST_ECOSYSTEM ?? "")
  ? process.env.DEMO_TEST_ECOSYSTEM! : "cargomatch-shared-v1";
/** One canonical demo world; independent principals. Always lock world before
 * sessions, including reset/logout, to serialize consent against eligibility. */
export const postgresDemoStore: DemoStore = {
  async create(tokenHash, sandbox) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(438210)");
      for (const company of COMPANIES) await client.query(
        "INSERT INTO demo_companies(id, profile) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING", [company.id, JSON.stringify(company)]);
      for (const persona of PERSONAS) {
        await client.query("INSERT INTO demo_users(id,profile) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING", [persona.id, JSON.stringify(persona)]);
        await client.query("INSERT INTO demo_memberships(user_id,company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [persona.id, persona.companyId]);
      }
      await client.query("INSERT INTO demo_ecosystems(id,state) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING", [DEMO_ECOSYSTEM, JSON.stringify(sandbox.state)]);
      const { rows } = await client.query("SELECT state FROM demo_ecosystems WHERE id=$1 FOR UPDATE", [DEMO_ECOSYSTEM]);
      sandbox.state = rows[0].state as DemoState;
      const identities = await client.query(`SELECT u.profile FROM demo_users u JOIN demo_memberships m ON m.user_id=u.id
        WHERE u.active AND m.active AND m.company_id=u.profile->>'companyId'`);
      sandbox.state.personas = identities.rows.map(r => r.profile as Persona);
      if (!sandbox.state.personas.some(p => p.id === sandbox.personaId)) throw new DemoError(403, "FORBIDDEN", "Geen actief demolidmaatschap.");
      await client.query(`INSERT INTO demo_sessions(token_hash,ecosystem_id,persona_id,csrf_token,revision,expires_at)
        VALUES($1,$2,$3,$4,$5,now()+interval '14 days')`,
      [tokenHash, DEMO_ECOSYSTEM, sandbox.personaId, sandbox.csrfToken, sandbox.revision]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  },
  async transact(tokenHash, operation, remove = false) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const world = await client.query("SELECT state FROM demo_ecosystems WHERE id=$1 FOR UPDATE", [DEMO_ECOSYSTEM]);
      const { rows } = await client.query(`SELECT csrf_token,persona_id,revision FROM demo_sessions
        WHERE token_hash=$1 AND ecosystem_id=$2 AND expires_at>now() FOR UPDATE`, [tokenHash, DEMO_ECOSYSTEM]);
      if (!rows.length || !world.rows.length) throw new DemoError(401, "NO_DEMO_SESSION", "Start eerst de gedeelde demo.");
      const row = rows[0], state = world.rows[0].state as DemoState;
      const identities = await client.query(`SELECT u.profile FROM demo_users u JOIN demo_memberships m ON m.user_id=u.id
        WHERE u.active AND m.active AND m.company_id=u.profile->>'companyId'`);
      state.personas = identities.rows.map(r => r.profile as Persona);
      if (!state.personas.some(p => p.id === row.persona_id)) throw new DemoError(403, "FORBIDDEN", "Geen actief demolidmaatschap.");
      const sandbox: Sandbox = { csrfToken: row.csrf_token, personaId: row.persona_id, revision: row.revision, state };
      const result = await operation(sandbox);
      if (!state.personas.some(p => p.id === sandbox.personaId)) throw new DemoError(403, "FORBIDDEN", "Geen actief demolidmaatschap.");
      if (sandbox.state !== state) {
        // A global reset invalidates every other session's write credentials.
        sandbox.state.personas = state.personas;
        await client.query("UPDATE demo_sessions SET revision=revision+1,csrf_token=$2 WHERE ecosystem_id=$1 AND token_hash<>$3",
          [DEMO_ECOSYSTEM, randomBytes(32).toString("hex"), tokenHash]);
        await client.query("UPDATE demo_ecosystems SET generation=generation+1 WHERE id=$1", [DEMO_ECOSYSTEM]);
      }
      await client.query("UPDATE demo_ecosystems SET state=$2::jsonb WHERE id=$1", [DEMO_ECOSYSTEM, JSON.stringify(sandbox.state)]);
      if (remove) await client.query("DELETE FROM demo_sessions WHERE token_hash=$1", [tokenHash]);
      else await client.query("UPDATE demo_sessions SET csrf_token=$2,persona_id=$3,revision=$4 WHERE token_hash=$1",
        [tokenHash, sandbox.csrfToken, sandbox.personaId, sandbox.revision]);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  },
};