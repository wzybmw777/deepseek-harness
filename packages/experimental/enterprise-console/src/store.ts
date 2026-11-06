/** Durable SQLite catalog and append-only usage/audit ledger for the enterprise console. */

import { constants } from 'node:fs'
import { access, chmod, mkdir, open as openFile, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync, type SQLOutputValue, type StatementSync } from 'node:sqlite'
import type {
  AuditRecord,
  ChannelRecord,
  DesktopDeviceRecord,
  DesktopGatewayAttemptRecord,
  DesktopGatewayStatus,
  EnterpriseCatalog,
  EnterpriseData,
  ModelRecord,
  OrderRecord,
  PlanRecord,
  PluginRecord,
  RoleRecord,
  SettingsRecord,
  TeamRecord,
  UsageAggregate,
  UsageRecord,
  UserRecord,
} from './types.ts'
import {
  BUILTIN_PLUGIN_WRITE_PERMISSION,
  ENTERPRISE_PLUGIN_WRITE_PERMISSION,
  PERMISSIONS,
  RESOURCE_WRITE_PERMISSION,
} from './types.ts'
import {
  decodeKeyMaterial,
  generateKeyMaterial,
  generateTemporaryPassword,
  hashPassword,
  normalizeEmail,
  recordId,
} from './security.ts'

const DATABASE_FILE = 'enterprise.sqlite'
const SCHEMA_VERSION = 9
const SESSION_KEY_FILE = 'session.key'
const CREDENTIAL_KEY_FILE = 'credential.key'
const INITIAL_PASSWORD_FILE = 'initial-admin-password.txt'
const MAX_AUDIT_RECORDS = 20_000
const MAX_USAGE_RECORDS = 100_000

/** Open result for a fresh or existing enterprise database. */
export interface StoreOpenResult {
  readonly store: EnterpriseStore
  readonly seeded: boolean
  readonly initialPasswordFile: string
}

/** Filters accepted by {@link EnterpriseStore.usageReport}. */
export interface UsageQuery {
  readonly from?: number
  readonly to?: number
  readonly teamId?: string
  readonly userId?: string
  readonly modelId?: string
  readonly limit: number
}

/** Usage summary and the newest matching records. */
export interface UsageReport {
  readonly summary: {
    readonly requests: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly costCents: number
  }
  readonly records: UsageRecord[]
}

/** Filters accepted by {@link EnterpriseStore.auditRecords}. */
export interface AuditQuery {
  readonly from?: number
  readonly to?: number
  readonly action?: string
  readonly actor?: string
  readonly limit: number
}

/** Identity and route fixed when a Desktop model request starts. */
export interface DesktopGatewayAttemptStart {
  readonly id: string
  readonly requestId: string
  readonly teamId: string
  readonly userId: string
  readonly modelId: string
  readonly channelId: string
  readonly sessionId?: string
  readonly startedAt: string
}

/** Terminal attempt state and the optional usage/audit rows committed with it. */
export interface DesktopGatewayAttemptFinish {
  readonly attemptId: string
  readonly status: Exclude<DesktopGatewayStatus, 'started'>
  readonly inputTokens: number
  readonly outputTokens: number
  readonly finishedAt: string
  readonly usage?: UsageRecord
  readonly audit?: AuditRecord
}

interface DurableKeys {
  readonly session: Buffer
  readonly credentials: Buffer
}

type DatabaseRow = Record<string, SQLOutputValue>

function invalidField(field: string, expected: string): never {
  throw new Error(`enterprise database field ${field} must be ${expected}`)
}

function requiredRow(row: DatabaseRow | undefined, label: string): DatabaseRow {
  if (row === undefined) throw new Error(`enterprise database has no ${label}`)
  return row
}

function stringField(row: DatabaseRow, field: string): string {
  const value = row[field]
  if (typeof value !== 'string') invalidField(field, 'a string')
  return value
}

function nullableStringField(row: DatabaseRow, field: string): string | null {
  const value = row[field]
  if (value === null) return null
  if (typeof value !== 'string') invalidField(field, 'a string or null')
  return value
}

function numberField(row: DatabaseRow, field: string): number {
  const value = row[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) invalidField(field, 'a finite number')
  return value
}

function enumField<T extends string>(row: DatabaseRow, field: string, allowed: readonly T[]): T {
  const value = stringField(row, field)
  if (!allowed.includes(value as T)) invalidField(field, `one of ${allowed.join(', ')}`)
  return value as T
}

function booleanFieldFromNumber(row: DatabaseRow, field: string): boolean {
  const value = numberField(row, field)
  if (value !== 0 && value !== 1) invalidField(field, '0 or 1')
  return value === 1
}

const DESKTOP_GATEWAY_ATTEMPT_SCHEMA = `
CREATE TABLE IF NOT EXISTS desktop_gateway_attempts (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL,
  team_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  model_id     TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  session_id   TEXT,
  status       TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'usage_missing')),
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS desktop_gateway_attempts_request
  ON desktop_gateway_attempts(team_id, request_id);
CREATE INDEX IF NOT EXISTS desktop_gateway_attempts_started
  ON desktop_gateway_attempts(started_at);
`

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  phone           TEXT,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role_id         TEXT NOT NULL,
  team_id         TEXT,
  status          TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  session_version INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  last_login_at   TEXT
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(email);

CREATE TABLE IF NOT EXISTS teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  plan_id    TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('active', 'suspended')),
  seat_limit INTEGER NOT NULL,
  notes      TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS teams_slug ON teams(slug);

CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  permissions TEXT NOT NULL,
  system      INTEGER NOT NULL CHECK (system IN (0, 1)),
  created_at  TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS plans (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  code                     TEXT NOT NULL,
  monthly_price_cents      INTEGER NOT NULL,
  annual_price_cents       INTEGER NOT NULL,
  seat_limit               INTEGER NOT NULL,
  monthly_credits          INTEGER NOT NULL,
  features                 TEXT NOT NULL,
  status                   TEXT NOT NULL CHECK (status IN ('active', 'archived')),
  created_at               TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  number       TEXT NOT NULL,
  team_id      TEXT NOT NULL,
  plan_id      TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('monthly', 'annual')),
  status       TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'rejected')),
  reference    TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  reviewed_at  TEXT,
  reviewed_by  TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS orders_created_at ON orders(created_at);

CREATE TABLE IF NOT EXISTS channels (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  provider          TEXT NOT NULL,
  base_url          TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  wire_protocol     TEXT NOT NULL CHECK (wire_protocol IN ('openai-chat', 'openai-responses', 'anthropic-messages')),
  priority          INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS models (
  id                               TEXT PRIMARY KEY,
  name                             TEXT NOT NULL,
  display_name                     TEXT NOT NULL,
  channel_id                       TEXT NOT NULL,
  input_price_per_million_cents    INTEGER NOT NULL,
  output_price_per_million_cents   INTEGER NOT NULL,
  context_window                   INTEGER NOT NULL,
  capabilities                     TEXT NOT NULL,
  status                           TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at                       TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS plugins (
  id           TEXT PRIMARY KEY,
  scope        TEXT NOT NULL CHECK (scope IN ('builtin', 'enterprise')),
  package_name TEXT NOT NULL,
  spec         TEXT NOT NULL,
  version      TEXT,
  description  TEXT NOT NULL,
  enabled      INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS plugins_scope_package ON plugins(scope, package_name);

CREATE TABLE IF NOT EXISTS desktop_devices (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  refresh_secret_hash  TEXT NOT NULL,
  user_session_version INTEGER NOT NULL,
  created_at           TEXT NOT NULL,
  last_used_at         TEXT NOT NULL,
  revoked_at           TEXT
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS desktop_devices_refresh ON desktop_devices(refresh_secret_hash);
CREATE INDEX IF NOT EXISTS desktop_devices_user ON desktop_devices(user_id);

${DESKTOP_GATEWAY_ATTEMPT_SCHEMA}

CREATE TABLE IF NOT EXISTS usage (
  id            TEXT PRIMARY KEY,
  external_id   TEXT,
  team_id       TEXT NOT NULL,
  user_id       TEXT,
  model_id      TEXT NOT NULL,
  channel_id    TEXT,
  requests      INTEGER NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_cents    INTEGER NOT NULL,
  recorded_at   TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS usage_recorded_at ON usage(recorded_at);
CREATE INDEX IF NOT EXISTS usage_team_recorded_at ON usage(team_id, recorded_at);
CREATE INDEX IF NOT EXISTS usage_model_id ON usage(model_id);

CREATE TABLE IF NOT EXISTS audit (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_email TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  summary     TEXT NOT NULL,
  ip          TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  metadata    TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS audit_created_at ON audit(created_at);
CREATE INDEX IF NOT EXISTS audit_action ON audit(action);

CREATE TABLE IF NOT EXISTS settings (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  registration_enabled  INTEGER NOT NULL CHECK (registration_enabled IN (0, 1)),
  default_role_id       TEXT NOT NULL,
  default_team_id       TEXT NOT NULL,
  default_plan_id       TEXT NOT NULL,
  session_max_age_days  INTEGER NOT NULL,
  support_email         TEXT NOT NULL,
  brand_name            TEXT NOT NULL
) STRICT;
`

const UPSERT_USER_SQL = `
INSERT INTO users (id, email, phone, name, password_hash, role_id, team_id, status, session_version, created_at, last_login_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  email = excluded.email,
  phone = excluded.phone,
  name = excluded.name,
  password_hash = excluded.password_hash,
  role_id = excluded.role_id,
  team_id = excluded.team_id,
  status = excluded.status,
  session_version = excluded.session_version,
  created_at = excluded.created_at,
  last_login_at = excluded.last_login_at
`

const UPSERT_TEAM_SQL = `
INSERT INTO teams (id, name, slug, plan_id, status, seat_limit, notes, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  slug = excluded.slug,
  plan_id = excluded.plan_id,
  status = excluded.status,
  seat_limit = excluded.seat_limit,
  notes = excluded.notes,
  created_at = excluded.created_at
`

const UPSERT_ROLE_SQL = `
INSERT INTO roles (id, name, description, permissions, system, created_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  permissions = excluded.permissions,
  system = excluded.system,
  created_at = excluded.created_at
`

const UPSERT_PLAN_SQL = `
INSERT INTO plans (id, name, code, monthly_price_cents, annual_price_cents, seat_limit, monthly_credits, features, status, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  code = excluded.code,
  monthly_price_cents = excluded.monthly_price_cents,
  annual_price_cents = excluded.annual_price_cents,
  seat_limit = excluded.seat_limit,
  monthly_credits = excluded.monthly_credits,
  features = excluded.features,
  status = excluded.status,
  created_at = excluded.created_at
`

const UPSERT_ORDER_SQL = `
INSERT INTO orders (id, number, team_id, plan_id, amount_cents, billing_cycle, status, reference, created_at, reviewed_at, reviewed_by)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  number = excluded.number,
  team_id = excluded.team_id,
  plan_id = excluded.plan_id,
  amount_cents = excluded.amount_cents,
  billing_cycle = excluded.billing_cycle,
  status = excluded.status,
  reference = excluded.reference,
  created_at = excluded.created_at,
  reviewed_at = excluded.reviewed_at,
  reviewed_by = excluded.reviewed_by
`

const UPSERT_CHANNEL_SQL = `
INSERT INTO channels (id, name, provider, base_url, encrypted_api_key, wire_protocol, priority, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  provider = excluded.provider,
  base_url = excluded.base_url,
  encrypted_api_key = excluded.encrypted_api_key,
  wire_protocol = excluded.wire_protocol,
  priority = excluded.priority,
  status = excluded.status,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at
`

const UPSERT_MODEL_SQL = `
INSERT INTO models (id, name, display_name, channel_id, input_price_per_million_cents, output_price_per_million_cents, context_window, capabilities, status, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  display_name = excluded.display_name,
  channel_id = excluded.channel_id,
  input_price_per_million_cents = excluded.input_price_per_million_cents,
  output_price_per_million_cents = excluded.output_price_per_million_cents,
  context_window = excluded.context_window,
  capabilities = excluded.capabilities,
  status = excluded.status,
  created_at = excluded.created_at
`

const UPSERT_PLUGIN_SQL = `
INSERT INTO plugins (id, scope, package_name, spec, version, description, enabled, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  scope = excluded.scope,
  package_name = excluded.package_name,
  spec = excluded.spec,
  version = excluded.version,
  description = excluded.description,
  enabled = excluded.enabled,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at
`

const UPSERT_SETTINGS_SQL = `
INSERT INTO settings (id, registration_enabled, default_role_id, default_team_id, default_plan_id, session_max_age_days, support_email, brand_name)
VALUES (1, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  registration_enabled = excluded.registration_enabled,
  default_role_id = excluded.default_role_id,
  default_team_id = excluded.default_team_id,
  default_plan_id = excluded.default_plan_id,
  session_max_age_days = excluded.session_max_age_days,
  support_email = excluded.support_email,
  brand_name = excluded.brand_name
`

const INSERT_USAGE_SQL = `
INSERT INTO usage (id, external_id, team_id, user_id, model_id, channel_id, requests, input_tokens, output_tokens, cost_cents, recorded_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const INSERT_METERED_USAGE_SQL = `
INSERT OR IGNORE INTO usage (id, external_id, team_id, user_id, model_id, channel_id, requests, input_tokens, output_tokens, cost_cents, recorded_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

const INSERT_AUDIT_SQL = `
INSERT INTO audit (id, actor_id, actor_email, action, target_type, target_id, summary, ip, created_at, metadata)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function ensurePrivateFile(path: string, contents: string): Promise<void> {
  try {
    await writeFile(path, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  await chmod(path, 0o600)
}

async function loadKeys(dataDir: string): Promise<DurableKeys> {
  const sessionPath = join(dataDir, SESSION_KEY_FILE)
  const credentialPath = join(dataDir, CREDENTIAL_KEY_FILE)
  await ensurePrivateFile(sessionPath, generateKeyMaterial())
  await ensurePrivateFile(credentialPath, generateKeyMaterial())
  return {
    session: decodeKeyMaterial(requiredText(await readOptional(sessionPath), SESSION_KEY_FILE)),
    credentials: decodeKeyMaterial(requiredText(await readOptional(credentialPath), CREDENTIAL_KEY_FILE)),
  }
}

function requiredText(value: string | undefined, field: string): string {
  if (value === undefined) throw new Error(`enterprise database is missing ${field}`)
  return value
}

async function ensureDatabaseFile(path: string): Promise<void> {
  try {
    const handle = await openFile(path, 'wx', 0o600)
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
}

function configureDatabase(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA synchronous = NORMAL')
  db.exec('PRAGMA busy_timeout = 5000')
  db.exec(SCHEMA_SQL)
}

function schemaVersion(db: DatabaseSync): number | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')
  if (row === undefined) return undefined
  const raw = stringField(row, 'value')
  const version = Number(raw)
  if (!Number.isSafeInteger(version)) throw new Error(`enterprise database has invalid schema version ${raw}`)
  return version
}

function hasColumn(db: DatabaseSync, table: 'users' | 'settings' | 'usage' | 'channels', column: string): boolean {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => stringField(row, 'name') === column)
}

function migrateSchema(db: DatabaseSync): number | undefined {
  let version = schemaVersion(db)
  if (version === undefined) return undefined
  while (version < SCHEMA_VERSION) {
    db.exec('BEGIN IMMEDIATE')
    try {
      if (version === 1) {
        if (!hasColumn(db, 'users', 'phone')) db.exec('ALTER TABLE users ADD COLUMN phone TEXT')
        version = 2
      } else if (version === 2) {
        if (!hasColumn(db, 'settings', 'default_team_id')) {
          db.exec("ALTER TABLE settings ADD COLUMN default_team_id TEXT NOT NULL DEFAULT 'team-default'")
        }
        version = 3
      } else if (version === 3) {
        db.prepare('UPDATE roles SET permissions = ? WHERE id = ?')
          .run(JSON.stringify([...PERMISSIONS]), 'role-owner')
        version = 4
      } else if (version === 4) {
        if (!hasColumn(db, 'usage', 'external_id')) db.exec('ALTER TABLE usage ADD COLUMN external_id TEXT')
        db.exec(`
          UPDATE roles
          SET permissions = json_insert(permissions, '$[#]', 'billing.purchase')
          WHERE id = 'role-owner'
            AND NOT EXISTS (
              SELECT 1 FROM json_each(roles.permissions) WHERE value = 'billing.purchase'
            )
        `)
        version = 5
      } else if (version === 5) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS plugins (
            id           TEXT PRIMARY KEY,
            scope        TEXT NOT NULL CHECK (scope IN ('builtin', 'enterprise')),
            package_name TEXT NOT NULL,
            spec         TEXT NOT NULL,
            version      TEXT,
            description  TEXT NOT NULL,
            enabled      INTEGER NOT NULL CHECK (enabled IN (0, 1)),
            created_at   TEXT NOT NULL,
            updated_at   TEXT NOT NULL
          ) STRICT;
          CREATE UNIQUE INDEX IF NOT EXISTS plugins_scope_package ON plugins(scope, package_name);
        `)
        for (const permission of [BUILTIN_PLUGIN_WRITE_PERMISSION, ENTERPRISE_PLUGIN_WRITE_PERMISSION]) {
          db.prepare(`
            UPDATE roles
            SET permissions = json_insert(permissions, '$[#]', ?)
            WHERE id = 'role-owner'
              AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = ?)
          `).run(permission, permission)
        }
        db.prepare(`
          UPDATE roles
          SET permissions = json_insert(permissions, '$[#]', ?)
          WHERE id = 'role-admin'
            AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = ?)
        `).run(ENTERPRISE_PLUGIN_WRITE_PERMISSION, ENTERPRISE_PLUGIN_WRITE_PERMISSION)
        version = 6
      } else if (version === 6) {
        db.exec(`
          CREATE TABLE IF NOT EXISTS desktop_devices (
            id                   TEXT PRIMARY KEY,
            user_id              TEXT NOT NULL,
            refresh_secret_hash  TEXT NOT NULL,
            user_session_version INTEGER NOT NULL,
            created_at           TEXT NOT NULL,
            last_used_at         TEXT NOT NULL,
            revoked_at           TEXT
          ) STRICT;
          CREATE UNIQUE INDEX IF NOT EXISTS desktop_devices_refresh ON desktop_devices(refresh_secret_hash);
          CREATE INDEX IF NOT EXISTS desktop_devices_user ON desktop_devices(user_id);
        `)
        version = 7
      } else if (version === 7) {
        if (!hasColumn(db, 'channels', 'wire_protocol')) {
          db.exec(`
            ALTER TABLE channels
            ADD COLUMN wire_protocol TEXT NOT NULL DEFAULT 'openai-chat'
              CHECK (wire_protocol IN ('openai-chat', 'openai-responses', 'anthropic-messages'))
          `)
        }
        version = 8
      } else if (version === 8) {
        db.exec(DESKTOP_GATEWAY_ATTEMPT_SCHEMA)
        version = 9
      } else {
        throw new Error(`enterprise database migration from schema version ${String(version)} is not implemented`)
      }
      writeMeta(db, 'schema_version', String(version))
      db.exec('COMMIT')
    } catch (error) {
      if (db.isTransaction) {
        try {
          db.exec('ROLLBACK')
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'enterprise schema migration and rollback failed', { cause: error })
        }
      }
      throw error
    }
  }
  return version
}

function ensureUserPhoneIndex(db: DatabaseSync): void {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_phone ON users(phone)')
}

function ensureUsageExternalIndex(db: DatabaseSync): void {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS usage_external_id ON usage(external_id) WHERE external_id IS NOT NULL')
}

function writeMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

function parseStringArray(text: string, field: string): string[] {
  const value: unknown = JSON.parse(text)
  if (!Array.isArray(value)) throw new Error(`enterprise database field ${field} must be a JSON string array`)
  const parsed: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`enterprise database field ${field} must be a JSON string array`)
    parsed.push(item)
  }
  return parsed
}

function parseMetadata(text: string, field: string): NonNullable<AuditRecord['metadata']> {
  const value: unknown = JSON.parse(text)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`enterprise database field ${field} must be a JSON object`)
  }
  return value as NonNullable<AuditRecord['metadata']>
}

function rowToUser(row: DatabaseRow): UserRecord {
  const teamId = nullableStringField(row, 'team_id')
  const phone = nullableStringField(row, 'phone')
  const lastLoginAt = nullableStringField(row, 'last_login_at')
  return {
    id: stringField(row, 'id'),
    email: stringField(row, 'email'),
    ...(phone === null ? {} : { phone }),
    name: stringField(row, 'name'),
    passwordHash: stringField(row, 'password_hash'),
    roleId: stringField(row, 'role_id'),
    ...(teamId === null ? {} : { teamId }),
    status: enumField(row, 'status', ['active', 'disabled'] as const),
    sessionVersion: numberField(row, 'session_version'),
    createdAt: stringField(row, 'created_at'),
    ...(lastLoginAt === null ? {} : { lastLoginAt }),
  }
}

function rowToTeam(row: DatabaseRow): TeamRecord {
  return {
    id: stringField(row, 'id'),
    name: stringField(row, 'name'),
    slug: stringField(row, 'slug'),
    planId: stringField(row, 'plan_id'),
    status: enumField(row, 'status', ['active', 'suspended'] as const),
    seatLimit: numberField(row, 'seat_limit'),
    notes: stringField(row, 'notes'),
    createdAt: stringField(row, 'created_at'),
  }
}

function rowToRole(row: DatabaseRow): RoleRecord {
  const id = stringField(row, 'id')
  return {
    id,
    name: stringField(row, 'name'),
    description: stringField(row, 'description'),
    permissions: parseStringArray(stringField(row, 'permissions'), `roles.${id}.permissions`),
    system: booleanFieldFromNumber(row, 'system'),
    createdAt: stringField(row, 'created_at'),
  }
}

function rowToPlan(row: DatabaseRow): PlanRecord {
  const id = stringField(row, 'id')
  return {
    id,
    name: stringField(row, 'name'),
    code: stringField(row, 'code'),
    monthlyPriceCents: numberField(row, 'monthly_price_cents'),
    annualPriceCents: numberField(row, 'annual_price_cents'),
    seatLimit: numberField(row, 'seat_limit'),
    monthlyCredits: numberField(row, 'monthly_credits'),
    features: parseStringArray(stringField(row, 'features'), `plans.${id}.features`),
    status: enumField(row, 'status', ['active', 'archived'] as const),
    createdAt: stringField(row, 'created_at'),
  }
}

function rowToOrder(row: DatabaseRow): OrderRecord {
  const reviewedAt = nullableStringField(row, 'reviewed_at')
  const reviewedBy = nullableStringField(row, 'reviewed_by')
  return {
    id: stringField(row, 'id'),
    number: stringField(row, 'number'),
    teamId: stringField(row, 'team_id'),
    planId: stringField(row, 'plan_id'),
    amountCents: numberField(row, 'amount_cents'),
    billingCycle: enumField(row, 'billing_cycle', ['monthly', 'annual'] as const),
    status: enumField(row, 'status', ['pending', 'paid', 'rejected'] as const),
    reference: stringField(row, 'reference'),
    createdAt: stringField(row, 'created_at'),
    ...(reviewedAt === null ? {} : { reviewedAt }),
    ...(reviewedBy === null ? {} : { reviewedBy }),
  }
}

function rowToChannel(row: DatabaseRow): ChannelRecord {
  return {
    id: stringField(row, 'id'),
    name: stringField(row, 'name'),
    provider: stringField(row, 'provider'),
    baseUrl: stringField(row, 'base_url'),
    encryptedApiKey: stringField(row, 'encrypted_api_key'),
    wireProtocol: enumField(row, 'wire_protocol', ['openai-chat', 'openai-responses', 'anthropic-messages'] as const),
    priority: numberField(row, 'priority'),
    status: enumField(row, 'status', ['active', 'disabled'] as const),
    createdAt: stringField(row, 'created_at'),
    updatedAt: stringField(row, 'updated_at'),
  }
}

function rowToModel(row: DatabaseRow): ModelRecord {
  const id = stringField(row, 'id')
  return {
    id,
    name: stringField(row, 'name'),
    displayName: stringField(row, 'display_name'),
    channelId: stringField(row, 'channel_id'),
    inputPricePerMillionCents: numberField(row, 'input_price_per_million_cents'),
    outputPricePerMillionCents: numberField(row, 'output_price_per_million_cents'),
    contextWindow: numberField(row, 'context_window'),
    capabilities: parseStringArray(stringField(row, 'capabilities'), `models.${id}.capabilities`),
    status: enumField(row, 'status', ['active', 'disabled'] as const),
    createdAt: stringField(row, 'created_at'),
  }
}

function rowToPlugin(row: DatabaseRow): PluginRecord {
  const version = nullableStringField(row, 'version')
  return {
    id: stringField(row, 'id'),
    scope: enumField(row, 'scope', ['builtin', 'enterprise'] as const),
    packageName: stringField(row, 'package_name'),
    spec: stringField(row, 'spec'),
    ...(version === null ? {} : { version }),
    description: stringField(row, 'description'),
    enabled: booleanFieldFromNumber(row, 'enabled'),
    createdAt: stringField(row, 'created_at'),
    updatedAt: stringField(row, 'updated_at'),
  }
}

function rowToDesktopDevice(row: DatabaseRow): DesktopDeviceRecord {
  const revokedAt = nullableStringField(row, 'revoked_at')
  return {
    id: stringField(row, 'id'),
    userId: stringField(row, 'user_id'),
    refreshSecretHash: stringField(row, 'refresh_secret_hash'),
    userSessionVersion: numberField(row, 'user_session_version'),
    createdAt: stringField(row, 'created_at'),
    lastUsedAt: stringField(row, 'last_used_at'),
    ...(revokedAt === null ? {} : { revokedAt }),
  }
}

function rowToDesktopGatewayAttempt(row: DatabaseRow): DesktopGatewayAttemptRecord {
  const sessionId = nullableStringField(row, 'session_id')
  const finishedAt = nullableStringField(row, 'finished_at')
  return {
    id: stringField(row, 'id'),
    requestId: stringField(row, 'request_id'),
    teamId: stringField(row, 'team_id'),
    userId: stringField(row, 'user_id'),
    modelId: stringField(row, 'model_id'),
    channelId: stringField(row, 'channel_id'),
    ...(sessionId === null ? {} : { sessionId }),
    status: enumField(row, 'status', ['started', 'completed', 'failed', 'usage_missing'] as const),
    inputTokens: numberField(row, 'input_tokens'),
    outputTokens: numberField(row, 'output_tokens'),
    startedAt: stringField(row, 'started_at'),
    ...(finishedAt === null ? {} : { finishedAt }),
  }
}

function rowToUsage(row: DatabaseRow): UsageRecord {
  const externalId = nullableStringField(row, 'external_id')
  const userId = nullableStringField(row, 'user_id')
  const channelId = nullableStringField(row, 'channel_id')
  return {
    id: stringField(row, 'id'),
    ...(externalId === null ? {} : { externalId }),
    teamId: stringField(row, 'team_id'),
    ...(userId === null ? {} : { userId }),
    modelId: stringField(row, 'model_id'),
    ...(channelId === null ? {} : { channelId }),
    requests: numberField(row, 'requests'),
    inputTokens: numberField(row, 'input_tokens'),
    outputTokens: numberField(row, 'output_tokens'),
    costCents: numberField(row, 'cost_cents'),
    recordedAt: stringField(row, 'recorded_at'),
  }
}

function rowToAudit(row: DatabaseRow): AuditRecord {
  const id = stringField(row, 'id')
  const actorId = nullableStringField(row, 'actor_id')
  const targetId = nullableStringField(row, 'target_id')
  const metadata = nullableStringField(row, 'metadata')
  return {
    id,
    ...(actorId === null ? {} : { actorId }),
    actorEmail: stringField(row, 'actor_email'),
    action: stringField(row, 'action'),
    targetType: stringField(row, 'target_type'),
    ...(targetId === null ? {} : { targetId }),
    summary: stringField(row, 'summary'),
    ip: stringField(row, 'ip'),
    createdAt: stringField(row, 'created_at'),
    ...(metadata === null ? {} : { metadata: parseMetadata(metadata, `audit.${id}.metadata`) }),
  }
}

function rowToSettings(row: DatabaseRow): SettingsRecord {
  return {
    registrationEnabled: booleanFieldFromNumber(row, 'registration_enabled'),
    defaultRoleId: stringField(row, 'default_role_id'),
    defaultTeamId: stringField(row, 'default_team_id'),
    defaultPlanId: stringField(row, 'default_plan_id'),
    sessionMaxAgeDays: numberField(row, 'session_max_age_days'),
    supportEmail: stringField(row, 'support_email'),
    brandName: stringField(row, 'brand_name'),
  }
}

function upsertUser(db: DatabaseSync, user: UserRecord): void {
  db.prepare(UPSERT_USER_SQL).run(
    user.id,
    user.email,
    user.phone ?? null,
    user.name,
    user.passwordHash,
    user.roleId,
    user.teamId ?? null,
    user.status,
    user.sessionVersion,
    user.createdAt,
    user.lastLoginAt ?? null,
  )
}

function upsertTeam(db: DatabaseSync, team: TeamRecord): void {
  db.prepare(UPSERT_TEAM_SQL).run(
    team.id,
    team.name,
    team.slug,
    team.planId,
    team.status,
    team.seatLimit,
    team.notes,
    team.createdAt,
  )
}

function upsertRole(db: DatabaseSync, role: RoleRecord): void {
  db.prepare(UPSERT_ROLE_SQL).run(
    role.id,
    role.name,
    role.description,
    JSON.stringify(role.permissions),
    role.system ? 1 : 0,
    role.createdAt,
  )
}

function upsertPlan(db: DatabaseSync, plan: PlanRecord): void {
  db.prepare(UPSERT_PLAN_SQL).run(
    plan.id,
    plan.name,
    plan.code,
    plan.monthlyPriceCents,
    plan.annualPriceCents,
    plan.seatLimit,
    plan.monthlyCredits,
    JSON.stringify(plan.features),
    plan.status,
    plan.createdAt,
  )
}

function upsertOrder(db: DatabaseSync, order: OrderRecord): void {
  db.prepare(UPSERT_ORDER_SQL).run(
    order.id,
    order.number,
    order.teamId,
    order.planId,
    order.amountCents,
    order.billingCycle,
    order.status,
    order.reference,
    order.createdAt,
    order.reviewedAt ?? null,
    order.reviewedBy ?? null,
  )
}

function upsertChannel(db: DatabaseSync, channel: ChannelRecord): void {
  db.prepare(UPSERT_CHANNEL_SQL).run(
    channel.id,
    channel.name,
    channel.provider,
    channel.baseUrl,
    channel.encryptedApiKey,
    channel.wireProtocol,
    channel.priority,
    channel.status,
    channel.createdAt,
    channel.updatedAt,
  )
}

function upsertModel(db: DatabaseSync, model: ModelRecord): void {
  db.prepare(UPSERT_MODEL_SQL).run(
    model.id,
    model.name,
    model.displayName,
    model.channelId,
    model.inputPricePerMillionCents,
    model.outputPricePerMillionCents,
    model.contextWindow,
    JSON.stringify(model.capabilities),
    model.status,
    model.createdAt,
  )
}

function upsertPlugin(db: DatabaseSync, plugin: PluginRecord): void {
  db.prepare(UPSERT_PLUGIN_SQL).run(
    plugin.id,
    plugin.scope,
    plugin.packageName,
    plugin.spec,
    plugin.version ?? null,
    plugin.description,
    plugin.enabled ? 1 : 0,
    plugin.createdAt,
    plugin.updatedAt,
  )
}

function upsertSettings(db: DatabaseSync, settings: SettingsRecord): void {
  db.prepare(UPSERT_SETTINGS_SQL).run(
    settings.registrationEnabled ? 1 : 0,
    settings.defaultRoleId,
    settings.defaultTeamId,
    settings.defaultPlanId,
    settings.sessionMaxAgeDays,
    settings.supportEmail,
    settings.brandName,
  )
}

function insertUsageRow(db: DatabaseSync, usage: UsageRecord): void {
  db.prepare(INSERT_USAGE_SQL).run(
    usage.id,
    usage.externalId ?? null,
    usage.teamId,
    usage.userId ?? null,
    usage.modelId,
    usage.channelId ?? null,
    usage.requests,
    usage.inputTokens,
    usage.outputTokens,
    usage.costCents,
    usage.recordedAt,
  )
}

function insertAuditRow(db: DatabaseSync, audit: AuditRecord): void {
  db.prepare(INSERT_AUDIT_SQL).run(
    audit.id,
    audit.actorId ?? null,
    audit.actorEmail,
    audit.action,
    audit.targetType,
    audit.targetId ?? null,
    audit.summary,
    audit.ip,
    audit.createdAt,
    audit.metadata === undefined ? null : JSON.stringify(audit.metadata),
  )
}

function insertCatalog(db: DatabaseSync, data: EnterpriseCatalog): void {
  for (const role of data.roles) upsertRole(db, role)
  for (const plan of data.plans) upsertPlan(db, plan)
  for (const team of data.teams) upsertTeam(db, team)
  for (const user of data.users) upsertUser(db, user)
  for (const order of data.orders) upsertOrder(db, order)
  for (const channel of data.channels) upsertChannel(db, channel)
  for (const model of data.models) upsertModel(db, model)
  for (const plugin of data.plugins) upsertPlugin(db, plugin)
  upsertSettings(db, data.settings)
}

function loadCatalog(db: DatabaseSync): EnterpriseCatalog {
  const users = db.prepare('SELECT * FROM users ORDER BY created_at, id').all().map(rowToUser)
  const teams = db.prepare('SELECT * FROM teams ORDER BY created_at, id').all().map(rowToTeam)
  const roles = db.prepare('SELECT * FROM roles ORDER BY created_at, id').all().map(rowToRole)
  const plans = db.prepare('SELECT * FROM plans ORDER BY created_at, id').all().map(rowToPlan)
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at, id').all().map(rowToOrder)
  const channels = db.prepare('SELECT * FROM channels ORDER BY created_at, id').all().map(rowToChannel)
  const models = db.prepare('SELECT * FROM models ORDER BY created_at, id').all().map(rowToModel)
  const plugins = db.prepare('SELECT * FROM plugins ORDER BY created_at, id').all().map(rowToPlugin)
  const settingsRow = requiredRow(db.prepare('SELECT * FROM settings WHERE id = 1').get(), 'settings row')
  return {
    version: 1,
    users,
    teams,
    roles,
    plans,
    orders,
    channels,
    models,
    plugins,
    settings: rowToSettings(settingsRow),
  }
}

function syncRows<T extends { id: string }>(
  db: DatabaseSync,
  table: string,
  previous: readonly T[],
  next: readonly T[],
  upsert: (db: DatabaseSync, row: T) => void,
): void {
  const previousById = new Map(previous.map(row => [row.id, row]))
  const nextIds = new Set(next.map(row => row.id))
  for (const row of next) {
    const before = previousById.get(row.id)
    if (before === undefined || JSON.stringify(before) !== JSON.stringify(row)) upsert(db, row)
  }
  if (previous.some(row => !nextIds.has(row.id))) {
    const remove = db.prepare(`DELETE FROM ${table} WHERE id = ?`)
    for (const row of previous) {
      if (!nextIds.has(row.id)) remove.run(row.id)
    }
  }
}

function syncCatalog(db: DatabaseSync, previous: EnterpriseCatalog, next: EnterpriseCatalog): void {
  syncRows(db, 'roles', previous.roles, next.roles, upsertRole)
  syncRows(db, 'plans', previous.plans, next.plans, upsertPlan)
  syncRows(db, 'teams', previous.teams, next.teams, upsertTeam)
  syncRows(db, 'users', previous.users, next.users, upsertUser)
  syncRows(db, 'orders', previous.orders, next.orders, upsertOrder)
  syncRows(db, 'channels', previous.channels, next.channels, upsertChannel)
  syncRows(db, 'models', previous.models, next.models, upsertModel)
  syncRows(db, 'plugins', previous.plugins, next.plugins, upsertPlugin)
  if (JSON.stringify(previous.settings) !== JSON.stringify(next.settings)) upsertSettings(db, next.settings)
}

function roleSeed(now: string): RoleRecord[] {
  return [
    {
      id: 'role-owner',
      name: '所有者',
      description: '拥有全部管理权限，包括套餐、渠道与系统设置。',
      permissions: [...PERMISSIONS],
      system: true,
      createdAt: now,
    },
    {
      id: 'role-admin',
      name: '管理员',
      description: '管理用户、团队、套餐订单、模型渠道和审计记录。',
      permissions: PERMISSIONS.filter(permission => permission !== 'settings.write'
        && permission !== RESOURCE_WRITE_PERMISSION && permission !== 'billing.purchase'
        && permission !== BUILTIN_PLUGIN_WRITE_PERMISSION),
      system: true,
      createdAt: now,
    },
    {
      id: 'role-member',
      name: '成员',
      description: '可进入 AI 工作台并查看团队共享资源。',
      permissions: ['workspace.use'],
      system: true,
      createdAt: now,
    },
  ]
}

function settingsSeed(brandName: string): SettingsRecord {
  return {
    registrationEnabled: false,
    defaultRoleId: 'role-member',
    defaultTeamId: 'team-default',
    defaultPlanId: 'plan-starter',
    sessionMaxAgeDays: 14,
    supportEmail: 'support@echoai.best',
    brandName,
  }
}

function seedDataWithPassword(
  brandName: string,
  now: string,
  password: string,
): { data: EnterpriseData; password: string } {
  return {
    password,
    data: {
      version: 1,
      users: [],
      teams: [{
        id: 'team-default', name: '默认团队', slug: 'default', planId: 'plan-starter',
        status: 'active', seatLimit: 10, notes: '首次启动自动创建的企业空间。', createdAt: now,
      }],
      roles: roleSeed(now),
      plans: [
        {
          id: 'plan-starter', name: '团队版', code: 'team', monthlyPriceCents: 29_900,
          annualPriceCents: 299_000, seatLimit: 10, monthlyCredits: 5_000_000,
          features: ['团队工作区', '模型渠道管理', '用量与审计', '标准支持'], status: 'active', createdAt: now,
        },
        {
          id: 'plan-business', name: '商业版', code: 'business', monthlyPriceCents: 99_900,
          annualPriceCents: 999_000, seatLimit: 50, monthlyCredits: 30_000_000,
          features: ['全部团队版能力', '更高并发额度', '套餐与订单管理', '优先支持'], status: 'active', createdAt: now,
        },
        {
          id: 'plan-enterprise', name: '企业版', code: 'enterprise', monthlyPriceCents: 299_900,
          annualPriceCents: 2_999_000, seatLimit: 200, monthlyCredits: 120_000_000,
          features: ['专属模型渠道', '完整审计导出', '企业级 SLA', '专属交付支持'], status: 'active', createdAt: now,
        },
      ],
      orders: [],
      channels: [{
        id: 'channel-deepseek', name: 'DeepSeek 主渠道', provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com', encryptedApiKey: '', wireProtocol: 'openai-chat',
        priority: 10, status: 'active',
        createdAt: now, updatedAt: now,
      }],
      models: [
        {
          id: 'model-deepseek-chat', name: 'deepseek-chat', displayName: 'DeepSeek Chat',
          channelId: 'channel-deepseek', inputPricePerMillionCents: 200, outputPricePerMillionCents: 800,
          contextWindow: 128_000, capabilities: ['文本', '工具调用'], status: 'active', createdAt: now,
        },
        {
          id: 'model-deepseek-reasoner', name: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner',
          channelId: 'channel-deepseek', inputPricePerMillionCents: 400, outputPricePerMillionCents: 1_600,
          contextWindow: 128_000, capabilities: ['深度推理', '文本', '工具调用'], status: 'active', createdAt: now,
        },
      ],
      plugins: [],
      usage: [],
      audit: [],
      settings: settingsSeed(brandName),
    },
  }
}

async function createInitialData(
  bootstrapAdminEmail: string,
  brandName: string,
): Promise<{ data: EnterpriseData; password: string }> {
  const now = new Date().toISOString()
  const password = generateTemporaryPassword()
  const seeded = seedDataWithPassword(brandName, now, password)
  const owner: UserRecord = {
    id: 'user-owner',
    email: normalizeEmail(bootstrapAdminEmail),
    name: '企业管理员',
    passwordHash: await hashPassword(password),
    roleId: 'role-owner',
    teamId: 'team-default',
    status: 'active',
    sessionVersion: 1,
    createdAt: now,
  }
  seeded.data.users.push(owner)
  seeded.data.audit.push({
    id: recordId(),
    actorEmail: 'system@enterprise.local',
    action: 'system.bootstrap',
    targetType: 'workspace',
    summary: `初始化企业工作台并创建首个所有者 ${owner.email}`,
    ip: 'local',
    createdAt: now,
  })
  return seeded
}

/** SQLite owner of the enterprise administration catalog and append-only history. */
export class EnterpriseStore {
  private catalog: EnterpriseCatalog
  private tail: Promise<void> = Promise.resolve()
  private closing: Promise<void> | undefined
  private closed = false
  private readonly insertUsage: StatementSync
  private readonly insertMeteredUsage: StatementSync
  private readonly insertAudit: StatementSync
  private readonly usageCount: StatementSync
  private readonly auditCount: StatementSync
  private readonly trimUsageRecords: StatementSync
  private readonly trimAuditRecords: StatementSync

  private constructor(
    private readonly db: DatabaseSync,
    private readonly dataDir: string,
    catalog: EnterpriseCatalog,
    private readonly keys: DurableKeys,
  ) {
    this.catalog = catalog
    this.insertUsage = db.prepare(INSERT_USAGE_SQL)
    this.insertMeteredUsage = db.prepare(INSERT_METERED_USAGE_SQL)
    this.insertAudit = db.prepare(INSERT_AUDIT_SQL)
    this.usageCount = db.prepare('SELECT COUNT(*) AS count FROM usage')
    this.auditCount = db.prepare('SELECT COUNT(*) AS count FROM audit')
    this.trimUsageRecords = db.prepare(
      'DELETE FROM usage WHERE id IN (SELECT id FROM usage ORDER BY recorded_at ASC, id ASC LIMIT ?)',
    )
    this.trimAuditRecords = db.prepare(
      'DELETE FROM audit WHERE id IN (SELECT id FROM audit ORDER BY created_at ASC, id ASC LIMIT ?)',
    )
  }

  /**
   * Open an existing SQLite database or seed a new installation.
   * @param dataDir - private directory holding the database and key files.
   * @param bootstrapAdminEmail - first owner email used only while seeding.
   * @param brandName - initial product name.
   * @returns the opened store and whether this call created its catalog.
   */
  static async open(dataDir: string, bootstrapAdminEmail: string, brandName: string): Promise<StoreOpenResult> {
    await mkdir(dataDir, { recursive: true, mode: 0o700 })
    await chmod(dataDir, 0o700)
    const keys = await loadKeys(dataDir)
    const databasePath = join(dataDir, DATABASE_FILE)
    await ensureDatabaseFile(databasePath)
    const db = new DatabaseSync(databasePath)
    try {
      configureDatabase(db)
      const initialPasswordFile = join(dataDir, INITIAL_PASSWORD_FILE)
      const version = migrateSchema(db)
      if (version !== undefined) {
        if (version !== SCHEMA_VERSION) {
          throw new Error(`enterprise database schema version ${String(version)} is not supported by this build (${String(SCHEMA_VERSION)})`)
        }
        ensureUserPhoneIndex(db)
        ensureUsageExternalIndex(db)
        const catalog = loadCatalog(db)
        return { store: new EnterpriseStore(db, dataDir, catalog, keys), seeded: false, initialPasswordFile }
      }
      ensureUserPhoneIndex(db)
      ensureUsageExternalIndex(db)
      const seeded = await createInitialData(bootstrapAdminEmail, brandName)
      await rm(initialPasswordFile, { force: true })
      await writeFile(initialPasswordFile, `email: ${normalizeEmail(bootstrapAdminEmail)}\npassword: ${seeded.password}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await chmod(initialPasswordFile, 0o600)
      db.exec('BEGIN IMMEDIATE')
      try {
        insertCatalog(db, seeded.data)
        for (const usage of seeded.data.usage) insertUsageRow(db, usage)
        for (const audit of seeded.data.audit) insertAuditRow(db, audit)
        writeMeta(db, 'schema_version', String(SCHEMA_VERSION))
        db.exec('COMMIT')
      } catch (error) {
        if (db.isTransaction) {
          try {
            db.exec('ROLLBACK')
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], 'enterprise store seed and rollback failed', { cause: error })
          }
        }
        throw error
      }
      const catalog = loadCatalog(db)
      return { store: new EnterpriseStore(db, dataDir, catalog, keys), seeded: true, initialPasswordFile }
    } catch (error) {
      db.close()
      throw error
    }
  }

  /** Read the current catalog snapshot. Usage and audit records are queried separately. */
  snapshot(): Readonly<EnterpriseCatalog> {
    return this.catalog
  }

  /** Look up one desktop device by the hash of its current refresh secret. */
  desktopDeviceByRefreshHash(refreshSecretHash: string): DesktopDeviceRecord | undefined {
    const row = this.db.prepare('SELECT * FROM desktop_devices WHERE refresh_secret_hash = ?').get(refreshSecretHash)
    return row === undefined ? undefined : rowToDesktopDevice(row)
  }

  /** Look up one desktop device by its opaque identifier. */
  desktopDeviceById(id: string): DesktopDeviceRecord | undefined {
    const row = this.db.prepare('SELECT * FROM desktop_devices WHERE id = ?').get(id)
    return row === undefined ? undefined : rowToDesktopDevice(row)
  }

  /** Read one model-gateway attempt by its team-scoped client identity. */
  desktopGatewayAttempt(teamId: string, requestId: string): DesktopGatewayAttemptRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM desktop_gateway_attempts WHERE team_id = ? AND request_id = ?
    `).get(teamId, requestId)
    return row === undefined ? undefined : rowToDesktopGatewayAttempt(row)
  }

  /**
   * Atomically claim a model-gateway request identity before upstream dispatch.
   * @param input - tenant, user, route, and client request identity.
   * @returns the new started attempt, or the existing attempt for a replay.
   */
  beginDesktopGatewayAttempt(input: DesktopGatewayAttemptStart): Promise<{
    readonly attempt: DesktopGatewayAttemptRecord
    readonly created: boolean
  }> {
    return this.enqueueWrite(() => {
      let attempt: DesktopGatewayAttemptRecord | undefined
      let created = false
      this.writeTransaction(() => {
        const existing = this.db.prepare(`
          SELECT * FROM desktop_gateway_attempts WHERE team_id = ? AND request_id = ?
        `).get(input.teamId, input.requestId)
        if (existing !== undefined) {
          attempt = rowToDesktopGatewayAttempt(existing)
          return
        }
        this.db.prepare(`
          INSERT INTO desktop_gateway_attempts
            (id, request_id, team_id, user_id, model_id, channel_id, session_id,
             status, input_tokens, output_tokens, started_at, finished_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'started', 0, 0, ?, NULL)
        `).run(
          input.id,
          input.requestId,
          input.teamId,
          input.userId,
          input.modelId,
          input.channelId,
          input.sessionId ?? null,
          input.startedAt,
        )
        attempt = {
          id: input.id,
          requestId: input.requestId,
          teamId: input.teamId,
          userId: input.userId,
          modelId: input.modelId,
          channelId: input.channelId,
          ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
          status: 'started',
          inputTokens: 0,
          outputTokens: 0,
          startedAt: input.startedAt,
        }
        created = true
      })
      if (attempt === undefined) throw new Error('Desktop gateway attempt insert did not produce a record')
      return { attempt, created }
    })
  }

  /**
   * Commit one terminal attempt state with its usage and audit rows.
   * @param input - terminal status, exact provider tokens, and optional history rows.
   * @returns whether this call moved the attempt out of `started`.
   */
  finishDesktopGatewayAttempt(input: DesktopGatewayAttemptFinish): Promise<boolean> {
    if (!Number.isSafeInteger(input.inputTokens) || input.inputTokens < 0
      || !Number.isSafeInteger(input.outputTokens) || input.outputTokens < 0) {
      return Promise.reject(new Error('Desktop gateway token counts must be non-negative safe integers'))
    }
    if ((input.status === 'completed') !== (input.usage !== undefined)) {
      return Promise.reject(new Error('Desktop gateway usage must be present exactly for completed attempts'))
    }
    return this.enqueueWrite(() => {
      let changed = false
      this.writeTransaction(() => {
        const result = this.db.prepare(`
          UPDATE desktop_gateway_attempts
          SET status = ?, input_tokens = ?, output_tokens = ?, finished_at = ?
          WHERE id = ? AND status = 'started'
        `).run(input.status, input.inputTokens, input.outputTokens, input.finishedAt, input.attemptId)
        changed = Number(result.changes) === 1
        if (!changed) return
        if (input.usage !== undefined) {
          this.insertUsage.run(
            input.usage.id,
            input.usage.externalId ?? null,
            input.usage.teamId,
            input.usage.userId ?? null,
            input.usage.modelId,
            input.usage.channelId ?? null,
            input.usage.requests,
            input.usage.inputTokens,
            input.usage.outputTokens,
            input.usage.costCents,
            input.usage.recordedAt,
          )
          this.trimUsage()
        }
        if (input.audit !== undefined) {
          this.insertAudit.run(
            input.audit.id,
            input.audit.actorId ?? null,
            input.audit.actorEmail,
            input.audit.action,
            input.audit.targetType,
            input.audit.targetId ?? null,
            input.audit.summary,
            input.audit.ip,
            input.audit.createdAt,
            input.audit.metadata === undefined ? null : JSON.stringify(input.audit.metadata),
          )
          this.trimAudit()
        }
      })
      return changed
    })
  }

  /** Persist a new desktop device and its audit event atomically. */
  insertDesktopDevice(record: DesktopDeviceRecord, audit?: AuditRecord): Promise<void> {
    return this.enqueueWrite(() => {
      this.writeTransaction(() => {
        this.db.prepare(`
          INSERT INTO desktop_devices
            (id, user_id, refresh_secret_hash, user_session_version, created_at, last_used_at, revoked_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.id,
          record.userId,
          record.refreshSecretHash,
          record.userSessionVersion,
          record.createdAt,
          record.lastUsedAt,
          record.revokedAt ?? null,
        )
        if (audit !== undefined) {
          insertAuditRow(this.db, audit)
          this.trimAudit()
        }
      })
    })
  }

  /** Rotate a device refresh secret only while the previous secret is still current. */
  rotateDesktopDevice(
    id: string,
    expectedRefreshSecretHash: string,
    input: {
      readonly refreshSecretHash: string
      readonly userSessionVersion: number
      readonly lastUsedAt: string
      readonly audit?: AuditRecord
    },
  ): Promise<boolean> {
    return this.enqueueWrite(() => {
      let changed = false
      this.writeTransaction(() => {
        const result = this.db.prepare(`
          UPDATE desktop_devices
          SET refresh_secret_hash = ?, user_session_version = ?, last_used_at = ?
          WHERE id = ? AND refresh_secret_hash = ? AND revoked_at IS NULL
        `).run(
          input.refreshSecretHash,
          input.userSessionVersion,
          input.lastUsedAt,
          id,
          expectedRefreshSecretHash,
        )
        changed = Number(result.changes) === 1
        if (changed && input.audit !== undefined) {
          insertAuditRow(this.db, input.audit)
          this.trimAudit()
        }
      })
      return changed
    })
  }

  /** Revoke one desktop device without affecting another device owned by the user. */
  revokeDesktopDevice(id: string, revokedAt: string, audit?: AuditRecord): Promise<boolean> {
    return this.enqueueWrite(() => {
      let changed = false
      this.writeTransaction(() => {
        const result = this.db.prepare(`
          UPDATE desktop_devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
        `).run(revokedAt, id)
        changed = Number(result.changes) === 1
        if (changed && audit !== undefined) {
          insertAuditRow(this.db, audit)
          this.trimAudit()
        }
      })
      return changed
    })
  }

  /** Session HMAC key. */
  get sessionKey(): Buffer {
    return this.keys.session
  }

  /** Channel credential encryption key. */
  get credentialKey(): Buffer {
    return this.keys.credentials
  }

  /** Data directory, exposed to the console for operator-facing status. */
  get directory(): string {
    return this.dataDir
  }

  /**
   * Apply a catalog mutation and append its usage/audit records in one transaction.
   * @param operation - receives an isolated catalog draft with empty history arrays.
   * @returns the operation result after the transaction commits.
   */
  mutate<T>(operation: (draft: EnterpriseData) => T | Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      if (this.closed) throw new Error('enterprise store is closed')
      const draft: EnterpriseData = {
        ...structuredClone(this.catalog),
        usage: [],
        audit: [],
      }
      const result = await operation(draft)
      const next: EnterpriseCatalog = {
        version: draft.version,
        users: draft.users,
        teams: draft.teams,
        roles: draft.roles,
        plans: draft.plans,
        orders: draft.orders,
        channels: draft.channels,
        models: draft.models,
        plugins: draft.plugins,
        settings: draft.settings,
      }
      this.writeTransaction(() => {
        syncCatalog(this.db, this.catalog, next)
        for (const usage of draft.usage) {
          this.insertUsage.run(
            usage.id,
            usage.externalId ?? null,
            usage.teamId,
            usage.userId ?? null,
            usage.modelId,
            usage.channelId ?? null,
            usage.requests,
            usage.inputTokens,
            usage.outputTokens,
            usage.costCents,
            usage.recordedAt,
          )
        }
        for (const audit of draft.audit) {
          this.insertAudit.run(
            audit.id,
            audit.actorId ?? null,
            audit.actorEmail,
            audit.action,
            audit.targetType,
            audit.targetId ?? null,
            audit.summary,
            audit.ip,
            audit.createdAt,
            audit.metadata === undefined ? null : JSON.stringify(audit.metadata),
          )
        }
        this.trimUsage()
        this.trimAudit()
      })
      this.catalog = next
      return result
    })
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  /**
   * Query usage records and the summary over every matching record.
   * @param query - time, team, model, and row-limit filters.
   * @returns the summary and newest matching records.
   */
  usageReport(query: UsageQuery): UsageReport {
    const clauses: string[] = []
    const args: Array<string | number> = []
    if (query.from !== undefined) {
      clauses.push('recorded_at >= ?')
      args.push(new Date(query.from).toISOString())
    }
    if (query.to !== undefined) {
      clauses.push('recorded_at <= ?')
      args.push(new Date(query.to).toISOString())
    }
    if (query.teamId !== undefined) {
      clauses.push('team_id = ?')
      args.push(query.teamId)
    }
    if (query.userId !== undefined) {
      clauses.push('user_id = ?')
      args.push(query.userId)
    }
    if (query.modelId !== undefined) {
      clauses.push('model_id = ?')
      args.push(query.modelId)
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    const summaryRow = requiredRow(this.db.prepare(`
      SELECT
        COALESCE(SUM(requests), 0) AS requests,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cost_cents), 0) AS cost_cents
      FROM usage${where}
    `).get(...args), 'usage summary')
    const rows = this.db.prepare(`
      SELECT * FROM usage${where} ORDER BY recorded_at DESC, id DESC LIMIT ?
    `).all(...args, Math.max(1, Math.min(query.limit, 1000))).map(rowToUsage)
    return {
      summary: {
        requests: numberField(summaryRow, 'requests'),
        inputTokens: numberField(summaryRow, 'input_tokens'),
        outputTokens: numberField(summaryRow, 'output_tokens'),
        costCents: numberField(summaryRow, 'cost_cents'),
      },
      records: rows,
    }
  }

  /**
   * Query audit records newest first.
   * @param query - time, action, actor, and row-limit filters.
   * @returns matching audit records.
   */
  auditRecords(query: AuditQuery): AuditRecord[] {
    const clauses: string[] = []
    const args: Array<string | number> = []
    if (query.from !== undefined) {
      clauses.push('created_at >= ?')
      args.push(new Date(query.from).toISOString())
    }
    if (query.to !== undefined) {
      clauses.push('created_at <= ?')
      args.push(new Date(query.to).toISOString())
    }
    if (query.action !== undefined) {
      clauses.push('action = ?')
      args.push(query.action)
    }
    if (query.actor !== undefined) {
      clauses.push("lower(actor_email) LIKE ? ESCAPE '\\'")
      const escaped = query.actor.toLowerCase().replace(/[\\%_]/gu, '\\$&')
      args.push(`%${escaped}%`)
    }
    const where = clauses.length === 0 ? '' : ` WHERE ${clauses.join(' AND ')}`
    return this.db.prepare(`
      SELECT * FROM audit${where} ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(...args, Math.max(1, Math.min(query.limit, 1000))).map(rowToAudit)
  }

  /**
   * Aggregate usage for the dashboard window.
   * @param days - number of trailing days to include.
   * @returns totals grouped by day, model, and team.
   */
  usageAggregate(days: number): UsageAggregate {
    const windowDays = Math.max(1, Math.floor(days))
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
    const totals = requiredRow(this.db.prepare(`
      SELECT
        COALESCE(SUM(requests), 0) AS requests,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cost_cents), 0) AS cost_cents
      FROM usage WHERE recorded_at >= ?
    `).get(cutoff), 'usage totals')
    const byDay = this.db.prepare(`
      SELECT
        substr(recorded_at, 1, 10) AS date,
        COALESCE(SUM(requests), 0) AS requests,
        COALESCE(SUM(input_tokens), 0) AS input_tokens,
        COALESCE(SUM(output_tokens), 0) AS output_tokens,
        COALESCE(SUM(cost_cents), 0) AS cost_cents
      FROM usage WHERE recorded_at >= ? GROUP BY date ORDER BY date ASC
    `).all(cutoff).map(row => ({
      date: stringField(row, 'date'),
      requests: numberField(row, 'requests'),
      inputTokens: numberField(row, 'input_tokens'),
      outputTokens: numberField(row, 'output_tokens'),
      costCents: numberField(row, 'cost_cents'),
    }))
    const byModel = this.db.prepare(`
      SELECT
        model_id,
        COALESCE(SUM(requests), 0) AS requests,
        COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
        COALESCE(SUM(cost_cents), 0) AS cost_cents
      FROM usage WHERE recorded_at >= ? GROUP BY model_id ORDER BY requests DESC, model_id ASC
    `).all(cutoff).map(row => ({
      modelId: stringField(row, 'model_id'),
      requests: numberField(row, 'requests'),
      tokens: numberField(row, 'tokens'),
      costCents: numberField(row, 'cost_cents'),
    }))
    const byTeam = this.db.prepare(`
      SELECT
        team_id,
        COALESCE(SUM(requests), 0) AS requests,
        COALESCE(SUM(cost_cents), 0) AS cost_cents
      FROM usage WHERE recorded_at >= ? GROUP BY team_id ORDER BY requests DESC, team_id ASC
    `).all(cutoff).map(row => ({
      teamId: stringField(row, 'team_id'),
      requests: numberField(row, 'requests'),
      costCents: numberField(row, 'cost_cents'),
    }))
    return {
      totals: {
        requests: numberField(totals, 'requests'),
        inputTokens: numberField(totals, 'input_tokens'),
        outputTokens: numberField(totals, 'output_tokens'),
        costCents: numberField(totals, 'cost_cents'),
      },
      byDay,
      byModel,
      byTeam,
    }
  }

  /** Whether any usage row references the model. */
  hasUsageForModel(modelId: string): boolean {
    const row = requiredRow(
      this.db.prepare('SELECT EXISTS(SELECT 1 FROM usage WHERE model_id = ?) AS present').get(modelId),
      'usage existence',
    )
    return numberField(row, 'present') === 1
  }

  /**
   * Append one metered usage row once per external attempt.
   * @param usage - provider-reported tokens with a stable external identity.
   * @returns whether this identity was new and the row was inserted.
   */
  recordMeteredUsage(usage: UsageRecord): Promise<boolean> {
    if (usage.externalId === undefined || usage.externalId === '') {
      return Promise.reject(new Error('metered usage requires an external id'))
    }
    const run = this.tail.then(() => {
      if (this.closed) throw new Error('enterprise store is closed')
      const result = this.insertMeteredUsage.run(
        usage.id,
        usage.externalId ?? null,
        usage.teamId,
        usage.userId ?? null,
        usage.modelId,
        usage.channelId ?? null,
        usage.requests,
        usage.inputTokens,
        usage.outputTokens,
        usage.costCents,
        usage.recordedAt,
      )
      if (Number(result.changes) === 0) return false
      this.trimUsage()
      return true
    })
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  /** Remove the one-time bootstrap password file after an owner changes credentials. */
  async removeInitialPasswordFile(): Promise<void> {
    await rm(join(this.dataDir, INITIAL_PASSWORD_FILE), { force: true })
  }

  /** Assert that the data directory remains readable and private. */
  async assertPrivateDirectory(): Promise<void> {
    await access(this.dataDir, constants.R_OK | constants.W_OK)
  }

  /**
   * Stop accepting writes and close the SQLite handle after queued work settles.
   * @returns completion after the database handle is released.
   */
  close(): Promise<void> {
    this.closing ??= this.finishClose()
    return this.closing
  }

  private async finishClose(): Promise<void> {
    this.closed = true
    await this.tail
    this.db.close()
  }

  private writeTransaction(operation: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      operation()
      this.db.exec('COMMIT')
    } catch (error) {
      if (this.db.isTransaction) {
        try {
          this.db.exec('ROLLBACK')
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'enterprise store write and rollback failed', { cause: error })
        }
      }
      throw error
    }
  }

  private enqueueWrite<T>(operation: () => T): Promise<T> {
    const run = this.tail.then(() => {
      if (this.closed) throw new Error('enterprise store is closed')
      return operation()
    })
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  private trimUsage(): void {
    const count = numberField(requiredRow(this.usageCount.get(), 'usage count'), 'count')
    if (count > MAX_USAGE_RECORDS) this.trimUsageRecords.run(count - MAX_USAGE_RECORDS)
  }

  private trimAudit(): void {
    const count = numberField(requiredRow(this.auditCount.get(), 'audit count'), 'count')
    if (count > MAX_AUDIT_RECORDS) this.trimAuditRecords.run(count - MAX_AUDIT_RECORDS)
  }
}
