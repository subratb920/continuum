# Continuum — Docker Reference Guide to run the entire continuum with a single docker command.

This document is the **single source of truth** for running Continuum
(UI + API + MongoDB) using Docker.

It is written to be:
- boring
- explicit
- repeatable
- safe after long breaks

No steps are implicit.

---

## 0. Prerequisites (Once)

Ensure the following are installed and running:

- Docker
- Docker Compose
- (macOS + Colima users) Colima is started

```bash
colima start

Verify Docker daemon: docker ps

---

## 1. Project Structure (Expected)

Continuum assumes this structure:

continuum/
├── docker/
│   └── docker-compose.yml
├── continuum-api/
│   ├── Dockerfile
│   ├── package.json
│   └── index.js
├── continuum-bridge-spine/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
└── continuum-dbvolume/   (external persistent volume)

⚠️ continuum-dbvolume must exist before starting Mongo.

---

2. MongoDB Volume Setup (Once)

Create the external DB volume folder:

mkdir continuum/continuum-dbvolume

This folder persists MongoDB data across restarts.

---

3. docker-compose.yml (Authoritative)

Location: continuum/docker/docker-compose.yml

This file orchestrates:

MongoDB
Continuum API
Continuum UI

(Do not modify casually.)

---

4. First-Time Build & Start (Clean)

From the docker/ directory:
cd docker
docker-compose up --build

This will:

build API image
build UI image
start MongoDB
start API
start UI

---

5. Background Start (Normal Use)

For daily work:
docker-compose up -d

---

6. Stop All Services
docker-compose down
This:
stops containers
does NOT delete data (Mongo volume remains)

---

7. Rebuild After Code Changes

If you change:
API dependencies
Dockerfiles
build config

docker-compose build
docker-compose up -d

If things get weird, use a clean rebuild:

docker-compose build --no-cache
docker-compose up -d


---

8. Verify Running Services

Check containers:
docker ps

Expected containers:

continuum-mongo
continuum-api
continuum-ui

---

9. Verify API Health

curl http://localhost:3101/projects

Expected response:
[]

This confirms:

API is running
MongoDB connection works
Docker networking is correct

---

10. Access the UI

Open in browser:

http://localhost:3100


---

11. MongoDB Shell (Optional Debug)

docker exec -it continuum-mongo mongosh

Inside Mongo:

use continuum
show collections
db.bridges.find()

---

12. Common Recovery Commands

docker-compose down
docker-compose up --build

If Docker gets confused:
docker system prune
(⚠️ removes unused images/containers)


---

13. Hard Reset (Last Resort)

⚠️ This deletes ALL Mongo data.

docker-compose down
rm -rf ../continuum-dbvolume/*
docker-compose up --build

Use only if you explicitly want a clean slate.

---

14. Canonical Rules (DO NOT VIOLATE)

Services talk via service names, not container names
Mongo persistence lives outside the app
UI never talks to Mongo directly
API is the only DB access layer
One command must start everything

---

15. Mental Checkpoint

If you are returning after a long break:
Start Docker
Run docker-compose up -d
Open UI
Resume from the last Bridge
That is all.


---



# Continuum — Docker Reference Guide to run all continuum artifacts seperately.

1. Start mongoDb container as an independant container.

(Only one time activity)...
docker run -d \ 
  --name continuum-mongo \
  -p 27000:27017 \
  -v $(pwd)/continuum-dbvolume:/data/db \
  mongo:7.0

 (Stop the container....)
 docker container continuum-mongo

 (For starting mongodb next time use this command)
 docker start continuum-mongo


2. Start continuum-api as a seperate server app.

nom start

3. Start continuum-bridge-spine as a seperate server app.

npm run dev


4. Open mongdb-sh in the terminal to query and view the database, collections, and documents.

docker exec -it continuum-mongo mongosh


## 🔒 Why This File Matters

This file:
- prevents future cognitive reload
- removes re-learning cost
- enforces infrastructure invariants
- aligns perfectly with Continuum’s philosophy

It is **not documentation fluff** — it is a **continuity artifact**.

---

If you want next, we can:
- add a similar `DEV_GUIDE.md`
- add a `RECOVERY_GUIDE.md` (for crashes / breaks)
- or go straight back to **UI ↔ API wiring**

Just tell me the next move.
