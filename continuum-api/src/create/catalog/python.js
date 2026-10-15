// src/create/catalog/python.js
//
// Python projects: FastAPI, Django, Flask and plain Python, with uv or pip.

import { field } from "../fields.js";
import { djangoTemplate, fastapiTemplate, flaskTemplate, pythonPlainTemplate } from "../templates/python.js";

const PY_PACKAGE_MANAGER = {
  id: "packageManager",
  label: "Package manager",
  type: "choice",
  values: [
    { id: "uv", label: "uv", icon: "SiUv" },
    { id: "pip", label: "pip", icon: "SiPython" },
  ],
  default: "uv",
};

const DETAILS = [
  field("name", "Project name", "slug", { placeholder: "my-service", default: "my-service", help: "Also the folder's name" }),
  field("module", "Python package", "pythonModule", {
    required: false,
    placeholder: "my_service",
    help: "The importable package (follows the project name until you change it)",
    derive: { from: ["name"], transform: "snake" },
  }),
  field("description", "Description", "text", { required: false, placeholder: "What it does" }),
];

const GROUPS = [
  { id: "web", name: "Web" },
  { id: "databases", name: "Databases" },
  { id: "tasks", name: "Background tasks" },
  { id: "config", name: "Configuration" },
  { id: "http", name: "HTTP client" },
];

const pypi = (name, range, opts = {}) => ({ registry: "pypi", name, range, ...opts });
const NOT_DJANGO = ["fastapi", "flask", "plain"];
const ALL = ["fastapi", "django", "flask", "plain"];
const mod = (ctx) => ctx.details.module;

const DEPENDENCIES = [
  {
    id: "sqlalchemy",
    name: "SQLAlchemy",
    description: "The Python SQL toolkit and ORM, with an engine and sessions from DATABASE_URL.",
    group: "databases",
    icon: "SiSqlalchemy",
    docs: "https://docs.sqlalchemy.org/",
    appliesTo: NOT_DJANGO,
    packages: [pypi("sqlalchemy", ">=2.0.0")],
    apply(ctx) {
      ctx.add(
        `${mod(ctx)}/db.py`,
        `import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

engine = create_engine(os.environ.get("DATABASE_URL", "sqlite:///./app.db"))
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    """Your models inherit from this."""
`
      );
      ctx.env.push(["DATABASE_URL", "sqlite:///./app.db", "Database connection string"]);
    },
  },
  {
    id: "alembic",
    name: "Alembic",
    description: "Database migrations for SQLAlchemy.",
    group: "databases",
    docs: "https://alembic.sqlalchemy.org/",
    appliesTo: NOT_DJANGO,
    requires: ["sqlalchemy"],
    packages: [pypi("alembic", ">=1.13.0")],
    apply(ctx) {
      ctx.readme.notes.push("Alembic: run `alembic init migrations` once, then point `sqlalchemy.url` (or env.py) at DATABASE_URL.");
    },
  },
  {
    id: "psycopg",
    name: "PostgreSQL (psycopg)",
    description: "The PostgreSQL driver.",
    group: "databases",
    icon: "SiPostgresql",
    docs: "https://www.psycopg.org/psycopg3/docs/",
    packages: [pypi("psycopg", ">=3.2.0", { extras: "binary" })],
    apply(ctx) {
      if (ctx.variant.id === "django") {
        ctx.slot(
          "djangoSettings",
          `# PostgreSQL when POSTGRES_DB is set (SQLite otherwise)
if os.environ.get('POSTGRES_DB'):
    DATABASES['default'] = {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ['POSTGRES_DB'],
        'USER': os.environ.get('POSTGRES_USER', 'postgres'),
        'PASSWORD': os.environ.get('POSTGRES_PASSWORD', ''),
        'HOST': os.environ.get('POSTGRES_HOST', 'localhost'),
        'PORT': os.environ.get('POSTGRES_PORT', '5432'),
    }`
        );
        ctx.env.push(["POSTGRES_DB", "", "Set to use PostgreSQL instead of SQLite"], ["POSTGRES_USER", "postgres"], ["POSTGRES_PASSWORD", ""], ["POSTGRES_HOST", "localhost"]);
      } else {
        ctx.env.push(["DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/postgres", "PostgreSQL connection string"]);
      }
    },
  },
  {
    id: "pymongo",
    name: "MongoDB (PyMongo)",
    description: "The official MongoDB driver, with a client from MONGO_URL.",
    group: "databases",
    icon: "SiMongodb",
    docs: "https://pymongo.readthedocs.io/",
    appliesTo: NOT_DJANGO,
    packages: [pypi("pymongo", ">=4.8.0")],
    apply(ctx) {
      ctx.add(
        `${mod(ctx)}/mongo.py`,
        `import os

from pymongo import MongoClient

client = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
db = client.get_default_database(default=${JSON.stringify(mod(ctx))})
`
      );
      ctx.env.push(["MONGO_URL", `mongodb://localhost:27017/${mod(ctx)}`, "MongoDB connection string"]);
    },
  },
  {
    id: "redis",
    name: "Redis",
    description: "The Redis client, connected from REDIS_URL.",
    group: "databases",
    icon: "SiRedis",
    docs: "https://redis.readthedocs.io/",
    packages: [pypi("redis", ">=5.0.0")],
    apply(ctx) {
      const dir = ctx.variant.id === "django" ? "core" : mod(ctx);
      ctx.add(`${dir}/cache.py`, 'import os\n\nimport redis\n\nr = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))\n');
      ctx.env.push(["REDIS_URL", "redis://localhost:6379/0", "Redis connection string"]);
    },
  },
  {
    id: "celery",
    name: "Celery",
    description: "Background tasks with Redis as the broker, and a first task.",
    group: "tasks",
    icon: "SiCelery",
    docs: "https://docs.celeryq.dev/",
    requires: ["redis"],
    packages: [pypi("celery", ">=5.4.0")],
    apply(ctx) {
      const dir = ctx.variant.id === "django" ? "core" : mod(ctx);
      ctx.add(
        `${dir}/tasks.py`,
        `import os

from celery import Celery

celery = Celery(__name__, broker=os.environ.get("REDIS_URL", "redis://localhost:6379/0"))


@celery.task
def add(x: int, y: int) -> int:
    return x + y
`
      );
      ctx.readme.notes.push(`Celery: start a worker with \`celery -A ${dir}.tasks worker\`.`);
    },
  },
  {
    id: "pydantic-settings",
    name: "Pydantic Settings",
    description: "Typed settings from environment variables and .env.",
    group: "config",
    icon: "SiPydantic",
    docs: "https://docs.pydantic.dev/latest/concepts/pydantic_settings/",
    appliesTo: NOT_DJANGO,
    packages: [pypi("pydantic-settings", ">=2.4.0")],
    apply(ctx) {
      ctx.add(
        `${mod(ctx)}/settings.py`,
        `from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    app_name: str = ${JSON.stringify(ctx.details.name)}
    debug: bool = False


settings = Settings()
`
      );
    },
  },
  {
    id: "dotenv",
    name: "python-dotenv",
    description: "Load settings from a .env file at start-up.",
    group: "config",
    icon: "SiDotenv",
    docs: "https://saurabh-kumar.com/python-dotenv/",
    packages: [pypi("python-dotenv", ">=1.0.0")],
    apply(ctx) {
      ctx.slot("pyImports", "from dotenv import load_dotenv");
      ctx.slot("pyStartup", "load_dotenv()");
    },
  },
  {
    id: "httpx",
    name: "HTTPX",
    description: "A modern HTTP client, sync and async.",
    group: "http",
    docs: "https://www.python-httpx.org/",
    packages: [pypi("httpx", ">=0.27.0")],
  },
  {
    id: "drf",
    name: "Django REST framework",
    description: "Build web APIs with serializers and viewsets.",
    group: "web",
    icon: "SiDjango",
    docs: "https://www.django-rest-framework.org/",
    appliesTo: ["django"],
    packages: [pypi("djangorestframework", ">=3.15.0")],
    apply: (ctx) => ctx.slot("djangoApps", "rest_framework"),
  },
  {
    id: "django-cors",
    name: "CORS headers",
    description: "Let browsers on other origins call the API (django-cors-headers).",
    group: "web",
    docs: "https://github.com/adamchainz/django-cors-headers",
    appliesTo: ["django"],
    packages: [pypi("django-cors-headers", ">=4.4.0")],
    apply(ctx) {
      ctx.slot("djangoApps", "corsheaders");
      ctx.slot("djangoMiddlewareTop", "corsheaders.middleware.CorsMiddleware");
      ctx.slot("djangoSettings", "CORS_ALLOWED_ORIGINS = [o for o in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',') if o]");
      ctx.env.push(["CORS_ALLOWED_ORIGINS", "http://localhost:5173", "Comma-separated origins allowed to call the API"]);
    },
  },
  {
    id: "flask-cors",
    name: "Flask-CORS",
    description: "Let browsers on other origins call the API.",
    group: "web",
    docs: "https://flask-cors.readthedocs.io/",
    appliesTo: ["flask"],
    packages: [pypi("flask-cors", ">=5.0.0")],
    apply: (ctx) => ctx.slot("flaskExtensions", { import: "from flask_cors import CORS", init: "CORS(app)" }),
  },
  {
    id: "gunicorn",
    name: "Gunicorn",
    description: "A production WSGI server.",
    group: "web",
    docs: "https://gunicorn.org/",
    appliesTo: ["django", "flask"],
    packages: [pypi("gunicorn", ">=23.0.0")],
    apply(ctx) {
      const target = ctx.variant.id === "django" ? `${mod(ctx)}.wsgi` : `"${mod(ctx)}:create_app()"`;
      ctx.readme.notes.push(`Production: \`gunicorn ${target}\`.`);
    },
  },
];

const variant = (id, name, icon, description, template) => ({
  id,
  name,
  icon,
  description,
  options: [PY_PACKAGE_MANAGER],
  details: DETAILS,
  template,
});

export default {
  id: "python",
  name: "Python",
  icon: "SiPython",
  description: "APIs, web apps and scripts in Python.",
  groups: GROUPS,
  variants: [
    variant("fastapi", "FastAPI", "SiFastapi", "Fast, typed APIs with automatic docs.", fastapiTemplate),
    variant("django", "Django", "SiDjango", "The batteries-included web framework: ORM, admin, auth.", djangoTemplate),
    variant("flask", "Flask", "SiFlask", "A lightweight web framework with an app factory.", flaskTemplate),
    variant("plain", "Plain Python", "SiPython", "A Python package with a command and a test.", pythonPlainTemplate),
  ],
  dependencies: DEPENDENCIES.map((d) => ({ ...d, appliesTo: d.appliesTo ?? ALL })),
};
