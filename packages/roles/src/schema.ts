import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { starterBotMarkdown } from "./bot-markdown.js";

const resources = {
  categories: `id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, enabled INTEGER NOT NULL,
    position INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER,
    role_id TEXT NOT NULL REFERENCES roles(id), UNIQUE(role_id, id)`,
  fragments: `id TEXT PRIMARY KEY, category_id TEXT NOT NULL,
    title TEXT NOT NULL, description TEXT NOT NULL, body TEXT NOT NULL, enabled INTEGER NOT NULL,
    position INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER,
    role_id TEXT NOT NULL REFERENCES roles(id), FOREIGN KEY(role_id, category_id) REFERENCES categories(role_id, id)`,
  skills: `id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, description TEXT NOT NULL,
    body TEXT NOT NULL, files_json TEXT NOT NULL, enabled INTEGER NOT NULL, position INTEGER NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id), UNIQUE(role_id, name)`,
  role_mcp_servers: `id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE, description TEXT NOT NULL,
    definition_json TEXT NOT NULL, enabled INTEGER NOT NULL, position INTEGER NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id), UNIQUE(role_id, name)`,
  trusted_projects: `id TEXT PRIMARY KEY, path TEXT NOT NULL, description TEXT NOT NULL,
    enabled INTEGER NOT NULL, position INTEGER NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id), UNIQUE(role_id, path)`,
};

/** Initialize the catalog and apply additive resource metadata upgrades. */
export function initializeRoles(db: DatabaseSync): void {
  const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(({ name }) => name));
  if (!tables.has("roles")) {
    if (["revision", "role_catalog", ...Object.keys(resources), "disabled_internal_mcp"].some((table) => tables.has(table)))
      throw new Error("older Roles database requires an offline replacement or conversion; no automatic migration is available");
  } else {
    const columns = new Set((db.prepare("PRAGMA table_info(role_catalog)").all() as Array<{ name: string }>).map(({ name }) => name));
    if (!columns.has("worker_default_role_id") || !tables.has("disabled_internal_mcp") || Object.keys(resources).some((table) => !tables.has(table)))
      throw new Error("older Roles database requires an offline replacement or conversion; no automatic migration is available");
    const catalog = db.prepare("SELECT default_role_id, worker_default_role_id FROM role_catalog WHERE singleton = 1").get() as {
      default_role_id: string | null; worker_default_role_id: string | null;
    } | undefined;
    if (!catalog?.default_role_id || !catalog.worker_default_role_id)
      throw new Error("Roles catalog has no Bot or Worker default; inspect the store before starting Stack");
  }
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
  try {
    if (!tables.has("roles")) {
      db.exec(`
        CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, description TEXT NOT NULL,
          revision INTEGER NOT NULL, created_at INTEGER, updated_at INTEGER);
        CREATE TABLE role_catalog (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), revision INTEGER NOT NULL,
          default_role_id TEXT REFERENCES roles(id), worker_default_role_id TEXT REFERENCES roles(id),
          worker_role_id TEXT NOT NULL REFERENCES roles(id),
          manager_role_id TEXT NOT NULL REFERENCES roles(id), admin_role_id TEXT NOT NULL REFERENCES roles(id));
      `);
      for (const [table, definition] of Object.entries(resources))
        db.exec(`CREATE TABLE ${table} (${definition}); CREATE INDEX ${table}_role ON ${table}(role_id)`);
      db.exec(`CREATE TABLE disabled_internal_mcp (
        role_id TEXT NOT NULL REFERENCES roles(id), name TEXT NOT NULL, PRIMARY KEY(role_id, name)
      )`);
      const managerId = randomUUID();
      const workerId = randomUUID();
      const adminId = randomUUID();
      const now = Date.now();
      db.prepare("INSERT INTO roles VALUES (?, 'Manager', '', 0, ?, ?)").run(managerId, now, now);
      db.prepare("INSERT INTO roles VALUES (?, 'Worker', '', 0, ?, ?)").run(workerId, now, now);
      db.prepare("INSERT INTO roles VALUES (?, 'Admin', '', 0, ?, ?)").run(adminId, now, now);
      db.prepare("INSERT INTO role_catalog VALUES (1, 1, ?, ?, ?, ?, ?)").run(managerId, workerId, workerId, managerId, adminId);
    } else {
      const columns = new Set((db.prepare("PRAGMA table_info(role_catalog)").all() as Array<{ name: string }>).map(({ name }) => name));
      if (!columns.has("worker_role_id")) {
        // Adopt the original named Worker once. An older catalog may have moved its
        // Worker default; that mutable pointer must not define the fixed identity.
        db.exec("ALTER TABLE role_catalog ADD COLUMN worker_role_id TEXT REFERENCES roles(id)");
        let worker = db.prepare("SELECT id FROM roles WHERE name = 'Worker'").get() as { id: string } | undefined;
        if (!worker) {
          worker = { id: randomUUID() };
          const now = Date.now();
          db.prepare("INSERT INTO roles VALUES (?, 'Worker', '', 0, ?, ?)").run(worker.id, now, now);
        }
        db.prepare("UPDATE role_catalog SET worker_role_id = ?, worker_default_role_id = ?, revision = revision + 1 WHERE singleton = 1")
          .run(worker.id, worker.id);
      }
      const fixed = db.prepare("SELECT worker_role_id FROM role_catalog WHERE singleton = 1").get() as { worker_role_id: string | null } | undefined;
      if (!fixed?.worker_role_id || !db.prepare("SELECT 1 FROM roles WHERE id = ?").get(fixed.worker_role_id))
        throw new Error("Roles catalog has no canonical Worker role; inspect the store before starting Stack");
      db.prepare("UPDATE role_catalog SET worker_default_role_id = worker_role_id WHERE singleton = 1 AND worker_default_role_id != worker_role_id").run();
      for (const [column, name] of [["manager_role_id", "Manager"], ["admin_role_id", "Admin"]] as const) {
        if (!columns.has(column)) db.exec(`ALTER TABLE role_catalog ADD COLUMN ${column} TEXT REFERENCES roles(id)`);
        let row = db.prepare(`SELECT ${column} AS id FROM role_catalog WHERE singleton = 1`).get() as { id: string | null } | undefined;
        if (!row?.id) {
          let role = db.prepare("SELECT id FROM roles WHERE name = ?").get(name) as { id: string } | undefined;
          if (name === "Admin" && role) {
            // A preexisting user Role named Admin is not evidence of an authorized
            // Admin launch. Keep its ID and content, but never grant it Admin tools.
            const legacyId = role.id;
            let legacyName = `Admin (legacy ${legacyId})`;
            for (let suffix = 2; db.prepare("SELECT 1 FROM roles WHERE name = ?").get(legacyName); suffix++)
              legacyName = `Admin (legacy ${legacyId}, ${suffix})`;
            db.prepare("UPDATE roles SET name = ?, revision = revision + 1, updated_at = ? WHERE id = ?")
              .run(legacyName, Date.now(), legacyId);
            role = undefined;
            // An old ordinary Bot default must not become the new privileged ID.
            db.prepare("UPDATE role_catalog SET default_role_id = manager_role_id WHERE singleton = 1 AND default_role_id = ?")
              .run(legacyId);
          }
          if (!role) {
            role = { id: randomUUID() };
            const now = Date.now();
            db.prepare("INSERT INTO roles VALUES (?, ?, '', 0, ?, ?)").run(role.id, name, now, now);
          }
          db.prepare(`UPDATE role_catalog SET ${column} = ?, revision = revision + 1 WHERE singleton = 1`).run(role.id);
          row = role;
        }
        if (!db.prepare("SELECT 1 FROM roles WHERE id = ?").get(row.id))
          throw new Error(`Roles catalog has no canonical ${name} role; inspect the store before starting Stack`);
      }
    }
    const fragmentColumns = db.prepare("PRAGMA table_info(fragments)").all() as Array<{ name: string }>;
    if (!fragmentColumns.some(({ name }) => name === "conditions_json"))
      db.exec("ALTER TABLE fragments ADD COLUMN conditions_json TEXT NOT NULL DEFAULT '{}'");
    for (const table of ["skills", "role_mcp_servers"]) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!columns.some(({ name }) => name === "harnesses_json")) db.exec(`ALTER TABLE ${table} ADD COLUMN harnesses_json TEXT`);
    }
    db.exec(`CREATE TABLE IF NOT EXISTS internal_mcp_harnesses (
      role_id TEXT NOT NULL REFERENCES roles(id), name TEXT NOT NULL, harnesses_json TEXT NOT NULL, PRIMARY KEY(role_id, name)
    )`);
    // Renaming a default-on connection must never re-enable a Role's explicit exclusion.
    db.exec(`INSERT OR IGNORE INTO disabled_internal_mcp SELECT role_id, 'codex-computer-use' FROM disabled_internal_mcp WHERE name='computer-use';
      DELETE FROM disabled_internal_mcp WHERE name='computer-use'`);
    db.exec("CREATE TABLE IF NOT EXISTS role_bot_markdown (role_id TEXT PRIMARY KEY REFERENCES roles(id), body TEXT NOT NULL)");
    // Existing Roles retain their instructions; never seed over an edited personality.
    db.exec("INSERT OR IGNORE INTO role_bot_markdown SELECT id, '' FROM roles");
    if (!tables.has("roles")) db.prepare("UPDATE role_bot_markdown SET body=? WHERE role_id=(SELECT default_role_id FROM role_catalog)").run(starterBotMarkdown);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
