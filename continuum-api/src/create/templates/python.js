// src/create/templates/python.js
//
// Python projects: FastAPI, Django (as `django-admin startproject` makes it),
// Flask and plain Python. Every one has pyproject.toml (uv) and requirements
// files (pip), a first test and Ruff settings. Slots: pyImports and pyStartup
// (an import and the call after the imports, e.g. load_dotenv()), djangoApps, djangoMiddlewareTop,
// djangoSettings (lines appended to settings.py), pyproject (extra sections).

import { randomBytes } from "node:crypto";

const describe = (ctx, fallback) => ctx.details.description || fallback;
const py = (s) => JSON.stringify(String(s)); // a Python string literal ("..." with escapes)

export const PYTHON_GITIGNORE = `# Byte-compiled / optimized files
__pycache__/
*.py[cod]
*$py.class

# Virtual environments
.venv/
venv/
env/

# Distribution / packaging
build/
dist/
*.egg-info/

# Tests and tools
.pytest_cache/
.ruff_cache/
.mypy_cache/
.coverage
htmlcov/

# Environment (keep .env.example)
.env
.env.*
!.env.example

# Databases
*.sqlite3
*.db

# Editors and OS
.vscode/*
!.vscode/extensions.json
.idea/
.DS_Store
`;

/** README commands for uv or pip, then the run command */
function pythonSetup(ctx, run) {
  if ((ctx.options.packageManager ?? "uv") === "uv") {
    ctx.readme.setup.push("uv sync", `uv run ${run}`);
    ctx.readme.notes.push("- `uv run pytest` runs the tests; `uv run ruff check .` lints.");
  } else {
    ctx.readme.setup.push("python -m venv .venv", ". .venv/bin/activate   # Windows: .venv\\Scripts\\activate", "pip install -r requirements-dev.txt", run);
    ctx.readme.notes.push("- `pytest` runs the tests; `ruff check .` lints.");
  }
}

function prepareCommon(ctx) {
  Object.assign(ctx.meta, { python: "3.12", module: ctx.details.module });
  ctx.pkg("pypi", "pytest", ">=8.0.0", { dev: true });
  ctx.pkg("pypi", "ruff", ">=0.6.0", { dev: true });
  ctx.slot("pyproject", '[tool.ruff]\nline-length = 100\n\n[tool.ruff.lint]\nselect = ["E", "F", "I", "UP", "B"]');
}

/** Third-party imports (the template's and the dependencies'), sorted as Ruff's isort expects */
function imports(ctx, base) {
  const key = (l) => l.replace(/^(from|import) /, "").split(/[ .]/)[0];
  return [...base, ...(ctx.slots.pyImports ?? [])].sort((a, b) => key(a).localeCompare(key(b)) || a.localeCompare(b)).join("\n");
}

/** Start-up calls placed after the imports (e.g. load_dotenv()) */
const startup = (ctx) => (ctx.slots.pyStartup ?? []).map((l) => `\n${l}\n`).join("");

/* ----------------------------------------------------------------- FastAPI */

export const fastapiTemplate = {
  manifest: "python",
  prepare(ctx) {
    prepareCommon(ctx);
    ctx.pkg("pypi", "fastapi", ">=0.115.0", { extras: "standard" });
    ctx.slot("pyproject", '[tool.pytest.ini_options]\npythonpath = ["."]');
  },
  build(ctx) {
    const m = ctx.details.module;
    ctx.add(".gitignore", PYTHON_GITIGNORE);
    ctx.add(`${m}/__init__.py`, "");
    ctx.add(
      `${m}/main.py`,
      `${imports(ctx, ["from fastapi import FastAPI"])}
${startup(ctx)}
app = FastAPI(title=${py(ctx.details.name)}, description=${py(describe(ctx, "A FastAPI service."))})


@app.get("/")
def read_root() -> dict[str, str]:
    return {"name": ${py(ctx.details.name)}, "message": "Hello from FastAPI"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
`
    );
    ctx.add("tests/__init__.py", "");
    ctx.add(
      "tests/test_main.py",
      `from fastapi.testclient import TestClient

from ${m}.main import app

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
`
    );
    pythonSetup(ctx, `fastapi dev ${m}/main.py`);
    ctx.readme.notes.unshift("Open http://localhost:8000 (API docs at /docs).");
  },
};

/* ------------------------------------------------------------------ Django */

export const djangoTemplate = {
  manifest: "python",
  prepare(ctx) {
    prepareCommon(ctx);
    ctx.pkg("pypi", "django", ">=6.0.0");
  },
  build(ctx) {
    const m = ctx.details.module;
    const apps = ctx.slots.djangoApps ?? [];
    const middlewareTop = ctx.slots.djangoMiddlewareTop ?? [];
    const extra = ctx.slots.djangoSettings ?? [];
    // A development-only key, made here like django-admin makes one; production reads DJANGO_SECRET_KEY
    const devKey = `django-insecure-${randomBytes(32).toString("base64url")}`;
    ctx.env.push(["DJANGO_SECRET_KEY", "", "A long random value for production (keep it secret)"]);
    ctx.env.push(["DJANGO_DEBUG", "true", "Turn off in production"]);
    ctx.env.push(["DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1", "Comma-separated host names"]);

    ctx.add(".gitignore", PYTHON_GITIGNORE);
    ctx.add(
      "manage.py",
      `#!/usr/bin/env python
"""Django's command-line utility for administrative tasks."""
import os
import sys


def main():
    """Run administrative tasks."""
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', '${m}.settings')
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError(
            "Couldn't import Django. Are you sure it's installed and "
            "available on your PYTHONPATH environment variable? Did you "
            "forget to activate a virtual environment?"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
`,
      true
    );
    ctx.add(`${m}/__init__.py`, "");
    ctx.add(
      `${m}/settings.py`,
      `"""
Django settings for ${m} project.

For more information on this file, see
https://docs.djangoproject.com/en/6.1/topics/settings/
"""

import os
from pathlib import Path
${ctx.slots.pyImports?.length ? `\n${imports(ctx, [])}\n` : ""}${startup(ctx)}
# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# SECURITY WARNING: keep the secret key used in production secret!
# Set DJANGO_SECRET_KEY in production; the fallback is for development only.
SECRET_KEY = os.environ.get(
    'DJANGO_SECRET_KEY',
    '${devKey}',
)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.environ.get('DJANGO_DEBUG', 'true').lower() == 'true'

ALLOWED_HOSTS = [h for h in os.environ.get('DJANGO_ALLOWED_HOSTS', '').split(',') if h]


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
${apps.map((a) => `    '${a}',\n`).join("")}    'core',
]

MIDDLEWARE = [
${middlewareTop.map((a) => `    '${a}',\n`).join("")}    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = '${m}.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = '${m}.wsgi.application'


# Database
# https://docs.djangoproject.com/en/6.1/ref/settings/#databases

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}


# Password validation
# https://docs.djangoproject.com/en/6.1/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/6.1/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.1/howto/static-files/

STATIC_URL = 'static/'


# Email
# https://docs.djangoproject.com/en/6.1/topics/email/#topic-email-configuration

MAILERS = {
    'default': {
        'BACKEND': 'django.core.mail.backends.console.EmailBackend',
    },
}
${extra.length ? `\n${extra.join("\n\n")}\n` : ""}`
    );
    ctx.add(
      `${m}/urls.py`,
      `"""
URL configuration for ${m} project.

https://docs.djangoproject.com/en/6.1/topics/http/urls/
"""
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', include('core.urls')),
]
`
    );
    for (const [file, kind, fn] of [
      ["asgi", "ASGI", "get_asgi_application"],
      ["wsgi", "WSGI", "get_wsgi_application"],
    ]) {
      ctx.add(
        `${m}/${file}.py`,
        `"""
${kind} config for ${m} project.

It exposes the ${kind} callable as a module-level variable named \`\`application\`\`.

For more information on this file, see
https://docs.djangoproject.com/en/6.1/howto/deployment/${file}/
"""

import os

from django.core.${file} import ${fn}

os.environ.setdefault('DJANGO_SETTINGS_MODULE', '${m}.settings')

application = ${fn}()
`
      );
    }
    ctx.add("core/__init__.py", "");
    ctx.add("core/migrations/__init__.py", "");
    ctx.add("core/apps.py", "from django.apps import AppConfig\n\n\nclass CoreConfig(AppConfig):\n    name = 'core'\n");
    ctx.add("core/admin.py", "from django.contrib import admin  # noqa: F401\n\n# Register your models here.\n");
    ctx.add("core/models.py", "from django.db import models  # noqa: F401\n\n# Create your models here.\n");
    ctx.add(
      "core/views.py",
      `from django.http import JsonResponse


def index(request):
    return JsonResponse({'name': ${py(ctx.details.name)}, 'message': 'Hello from Django'})


def health(request):
    return JsonResponse({'status': 'ok'})
`
    );
    ctx.add(
      "core/urls.py",
      "from django.urls import path\n\nfrom . import views\n\nurlpatterns = [\n    path('', views.index, name='index'),\n    path('health/', views.health, name='health'),\n]\n"
    );
    ctx.add(
      "core/tests.py",
      `from django.test import TestCase


class HealthTests(TestCase):
    def test_health(self):
        response = self.client.get('/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})
`
    );
    ctx.slot("pyproject", '[tool.ruff.lint.per-file-ignores]\n"*/migrations/*" = ["E501"]');
    pythonSetup(ctx, "python manage.py runserver");
    ctx.readme.notes.unshift("Open http://localhost:8000 (the admin is at /admin/; create a user with `python manage.py createsuperuser`).");
    ctx.readme.notes.push("- `python manage.py test` runs Django's tests; `python manage.py migrate` creates the database tables.");
  },
};

/* ------------------------------------------------------------------- Flask */

export const flaskTemplate = {
  manifest: "python",
  prepare(ctx) {
    prepareCommon(ctx);
    ctx.pkg("pypi", "flask", ">=3.0.0");
    ctx.slot("pyproject", '[tool.pytest.ini_options]\npythonpath = ["."]');
  },
  build(ctx) {
    const m = ctx.details.module;
    const ext = ctx.slots.flaskExtensions ?? [];
    ctx.add(".gitignore", PYTHON_GITIGNORE);
    ctx.add(
      `${m}/__init__.py`,
      `${imports(ctx, ["from flask import Flask", ...ext.map((e) => e.import)])}
${startup(ctx)}

def create_app(test_config: dict | None = None) -> Flask:
    """The application factory: \`flask --app ${m} run\` calls it."""
    app = Flask(__name__)
    if test_config:
        app.config.update(test_config)
${ext.map((e) => `    ${e.init}\n`).join("")}
    @app.get("/")
    def index():
        return {"name": ${py(ctx.details.name)}, "message": "Hello from Flask"}

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app
`
    );
    ctx.add("tests/__init__.py", "");
    ctx.add(
      "tests/test_app.py",
      `from ${m} import create_app


def test_health() -> None:
    client = create_app({"TESTING": True}).test_client()
    response = client.get("/health")
    assert response.status_code == 200
    assert response.get_json() == {"status": "ok"}
`
    );
    pythonSetup(ctx, `flask --app ${m} run --debug`);
    ctx.readme.notes.unshift("Open http://localhost:5000.");
  },
};

/* ------------------------------------------------------------ Plain Python */

export const pythonPlainTemplate = {
  manifest: "python",
  prepare(ctx) {
    prepareCommon(ctx);
    ctx.slot("pyproject", '[tool.pytest.ini_options]\npythonpath = ["."]');
  },
  build(ctx) {
    const m = ctx.details.module;
    ctx.add(".gitignore", PYTHON_GITIGNORE);
    ctx.add(`${m}/__init__.py`, "");
    ctx.add(
      `${m}/__main__.py`,
      `"""${describe(ctx, "A Python program.").replace(/"""/g, "'''")}"""
${ctx.slots.pyImports?.length ? `\n${imports(ctx, [])}\n` : ""}${startup(ctx)}


def greet(name: str) -> str:
    return f"Hello from {name}!"


def main() -> None:
    print(greet(${py(ctx.details.name)}))


if __name__ == "__main__":
    main()
`
    );
    ctx.add("tests/__init__.py", "");
    ctx.add(
      "tests/test_main.py",
      `from ${m}.__main__ import greet


def test_greet() -> None:
    assert greet("you") == "Hello from you!"
`
    );
    pythonSetup(ctx, `python -m ${m}`);
  },
};
