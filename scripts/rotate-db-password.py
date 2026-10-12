#!/usr/bin/env python3
"""
Rotate the dashboard_ro password without the plaintext ever leaving this machine.

1. Generates a random password (never printed).
2. Writes DATABASE_URL (pooler, port 6543) into .env.local, chmod 600.
3. Prints ONLY a SCRAM-SHA-256 verifier as an `alter role` statement. Postgres
   accepts a pre-hashed verifier in ALTER ROLE ... PASSWORD. The verifier can't
   be reversed or used to log in, so it is safe to run through the Supabase
   SQL editor or MCP.

Usage: scripts/rotate-db-password.py   then run the printed SQL on the project.
"""
import base64
import hashlib
import hmac
import os
import secrets
import urllib.parse
from pathlib import Path

REF = "<project-ref>"
HOST = "<pooler-host>"  # transaction pooler, IPv4
ROLE = "dashboard_ro"
ITERATIONS = 4096

root = Path(__file__).resolve().parent.parent
env = root / ".env.local"

password = secrets.token_hex(24)  # hex: no SASLprep or URL-escaping issues

salt = secrets.token_bytes(16)
salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
stored_key = hashlib.sha256(client_key).digest()
server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
b64 = lambda b: base64.b64encode(b).decode()
verifier = f"SCRAM-SHA-256${ITERATIONS}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"

url = f"postgres://{ROLE}.{REF}:{urllib.parse.quote(password, safe='')}@{HOST}:6543/postgres"
lines = [l for l in (env.read_text().splitlines() if env.exists() else []) if not l.startswith("DATABASE_URL=")]
lines.append(f"DATABASE_URL={url}")
tmp = env.with_suffix(".tmp")
tmp.write_text("\n".join(lines) + "\n")
os.chmod(tmp, 0o600)
tmp.replace(env)

print(f"alter role {ROLE} password '{verifier}';")
