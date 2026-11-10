# Number Garden

Number Garden is a shared math-practice app for grades 3-5. Learner accounts, question history, coins, and backgrounds are stored centrally in SQLite so multiple learners can use the same running server at once.

## Run locally

Requires Node.js 20 or newer.

```powershell
npm.cmd install
npm.cmd start
```

Open `http://127.0.0.1:3000`. On first startup, the server creates an admin account with username `admin` and writes its randomly generated password to `.admin-credentials.txt`. Keep that file private and change the password from the Admin dashboard after signing in. The file is excluded from Git.

Learners use **New learner** to create their own username and password. Admins sign in from the same screen. The Admin dashboard lists learner progress, recent answers, and coin controls.

## Shared hosting

The default server address is local to this computer. To let other devices connect, deploy the app to a trusted server and set `HOST=0.0.0.0`. Put it behind HTTPS before sharing it over the internet; do not send passwords over an untrusted plain-HTTP connection. Set a long, random `SESSION_SECRET`, and use a persistent disk for the `data/` directory so accounts and progress survive restarts. `NODE_ENV=production` enables secure session cookies; set `TRUST_PROXY=1` when HTTPS is terminated by a trusted reverse proxy.

SQLite is suitable for a small class using one server. For a much larger public service, use a managed database such as PostgreSQL and a multi-instance session store.

## Data

The database is `data/number-garden.sqlite`. Back up that file and the admin credentials securely. Passwords are stored as bcrypt hashes. Learners can access only their own progress; admin endpoints require an authenticated admin account.
