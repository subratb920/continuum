-- continuum-directory: users of every kind, roles, mappings, sign-ins and
-- app use, organizations and departments.

-- Every identity in Continuum. kind: human | agent | app | org | department
-- (only these for now). A human's id is their Continuum account's; an org's and
-- a department's id is also their row in orgs / departments.
CREATE TABLE users (
  id                text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{24}$'),
  kind              text NOT NULL CHECK (kind IN ('human', 'agent', 'app', 'org', 'department')),
  display_name      text,
  email             text,
  owner_id          text REFERENCES users(id) ON DELETE SET NULL, -- the user an agent or app belongs to
  role_id           text,                                         -- Continuum's role (humans); none: the member role
  disabled          boolean NOT NULL DEFAULT false,
  token_version     integer NOT NULL DEFAULT 0,                   -- sign-in tokens carry it; signing out everywhere raises it
  last_login_at     timestamptz,
  last_login_method text,
  last_seen_at      timestamptz,
  last_device       jsonb,
  last_space_id     text,                                         -- the space last worked in ("u:…" / "o:…")
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email ON users (lower(email)) WHERE email IS NOT NULL AND kind = 'human';
CREATE INDEX users_kind ON users (kind, created_at DESC);
CREATE INDEX users_role ON users (role_id);
CREATE INDEX users_seen ON users (last_seen_at DESC NULLS LAST);

-- Continuum's roles: a set of features switched on (admin: always all)
CREATE TABLE roles (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  features    text[] NOT NULL DEFAULT '{}',
  feature_set integer NOT NULL DEFAULT 0,
  built_in    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX roles_name ON roles (lower(name));

-- The directory's own settings (the default role, the first admin's setup code, the import from Mongo)
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Mappings: a user (of any kind) as other systems know it.
--   continuum   → the Continuum account (Mongo users._id)
--   github      → the GitHub user id (details: login, name, avatarUrl)
--   deploy      → Continuum Deploy's tenant ("u:<id>" / "o:<id>")
--   brain       → continuum-brain's key or agent id
CREATE TABLE links (
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  system      text NOT NULL,
  external_id text NOT NULL,
  details     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (system, external_id)
);
CREATE INDEX links_user ON links (user_id, system);

-- Sign-ins (failed ones too), kept the history days
CREATE TABLE login_events (
  id         bigserial PRIMARY KEY,
  user_id    text,
  email      text,
  method     text NOT NULL,
  ok         boolean NOT NULL,
  reason     text,
  signup     boolean NOT NULL DEFAULT false,
  at         timestamptz NOT NULL,
  ip         text,
  user_agent text,
  browser    text,
  os         text,
  device     text,
  region     text,
  city       text,
  network    jsonb,
  client     jsonb,
  expire_at  timestamptz NOT NULL
);
CREATE INDEX login_events_user_at ON login_events (user_id, at DESC);
CREATE INDEX login_events_at ON login_events (at DESC);
CREATE INDEX login_events_expire ON login_events (expire_at);

-- App use per user, app and day
CREATE TABLE app_usage (
  user_id   text NOT NULL,
  app       text NOT NULL,
  day       date NOT NULL,
  count     integer NOT NULL DEFAULT 0,
  first_at  timestamptz,
  last_at   timestamptz,
  expire_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, app, day)
);
CREATE INDEX app_usage_app_day ON app_usage (app, day DESC);
CREATE INDEX app_usage_expire ON app_usage (expire_at);

-- What Continuum's admins changed
CREATE TABLE admin_audit (
  id         bigserial PRIMARY KEY,
  type       text NOT NULL,
  by_id      text,
  by_email   text,
  at         timestamptz NOT NULL DEFAULT now(),
  request_id text,
  ip         text,
  metadata   jsonb
);
CREATE INDEX admin_audit_at ON admin_audit (at DESC);

-- Organizations (each also a user of kind org)
CREATE TABLE orgs (
  id         text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Departments (each also a user of kind department)
CREATE TABLE departments (
  id         text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id     text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX departments_name ON departments (org_id, lower(name));

-- Who is in an organization, with the organization's own role (never Continuum's)
CREATE TABLE org_members (
  org_id     text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_role   text NOT NULL CHECK (org_role IN ('owner', 'admin', 'member', 'viewer')),
  added_by   text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX org_members_user ON org_members (user_id);

CREATE TABLE member_departments (
  org_id        text NOT NULL,
  user_id       text NOT NULL,
  department_id text NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (org_id, user_id, department_id),
  FOREIGN KEY (org_id, user_id) REFERENCES org_members(org_id, user_id) ON DELETE CASCADE
);

-- Invites by email; whoever signs in with that email can join
CREATE TABLE org_invites (
  id             text PRIMARY KEY,
  org_id         text NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  email          text NOT NULL,
  org_role       text NOT NULL CHECK (org_role IN ('owner', 'admin', 'member', 'viewer')),
  department_ids text[] NOT NULL DEFAULT '{}',
  invited_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);
CREATE UNIQUE INDEX org_invites_org_email ON org_invites (org_id, lower(email));
CREATE INDEX org_invites_email ON org_invites (lower(email));

-- What changed in organizations
CREATE TABLE directory_audit (
  id         bigserial PRIMARY KEY,
  type       text NOT NULL,
  user_id    text,
  org_id     text,
  at         timestamptz NOT NULL DEFAULT now(),
  request_id text,
  ip         text,
  user_agent text,
  metadata   jsonb
);
CREATE INDEX directory_audit_org_at ON directory_audit (org_id, at DESC);
