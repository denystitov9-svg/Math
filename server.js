import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import express from "express";
import rateLimit from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(root, "data");
const credentialsPath = path.join(root, ".admin-credentials.txt");
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new Database(path.join(dataDirectory, "number-garden.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nickname TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('student', 'admin')),
    grade INTEGER NOT NULL DEFAULT 4,
    operation TEXT NOT NULL DEFAULT 'mixed',
    coins INTEGER NOT NULL DEFAULT 0,
    solved INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    owned_themes TEXT NOT NULL DEFAULT '["sunny"]',
    active_theme TEXT NOT NULL DEFAULT 'sunny',
    current_question TEXT,
    easy_round INTEGER NOT NULL DEFAULT 0,
    round_number INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS used_questions (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question_key TEXT NOT NULL,
    used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (user_id, question_key)
  );
  CREATE TABLE IF NOT EXISTS answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer INTEGER NOT NULL,
    expected INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS answers_user_recent ON answers(user_id, id DESC);
  CREATE TABLE IF NOT EXISTS coin_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL REFERENCES users(id),
    learner_id INTEGER NOT NULL REFERENCES users(id),
    delta INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
`);

const themes = [
  {
    id: "sunny",
    name: "Sunny Garden",
    cost: 0,
    preview: "#fff1c8",
    hill: "#b4d2a6",
    second: "#8fba8c",
  },
  {
    id: "seaside",
    name: "Sea Glass",
    cost: 8,
    preview: "#cce8df",
    hill: "#86c7b9",
    second: "#69aaa3",
  },
  {
    id: "berry",
    name: "Berry Patch",
    cost: 12,
    preview: "#f6d8c8",
    hill: "#e8a58d",
    second: "#d67d72",
  },
  {
    id: "meadow",
    name: "Wild Meadow",
    cost: 16,
    preview: "#e5eebc",
    hill: "#abc778",
    second: "#86a85f",
  },
  {
    id: "starlight",
    name: "Moon Garden",
    cost: 20,
    preview: "#d9def4",
    hill: "#a4aed5",
    second: "#828fbd",
  },
  {
    id: "poppy",
    name: "Poppy Field",
    cost: 24,
    preview: "#f6d8d0",
    hill: "#e89b79",
    second: "#83b4a0",
  },
];
const themeById = new Map(themes.map((theme) => [theme.id, theme]));
const gradeDetails = {
  3: { add: 100, multiply: 10 },
  4: { add: 1000, multiply: 12 },
  5: { add: 10000, multiply: 20 },
};
const operations = ["add", "subtract", "multiply", "divide"];
const operationSymbols = {
  add: "+",
  subtract: "−",
  multiply: "×",
  divide: "÷",
};
const blockedNicknameWords = [
  "ass",
  "asshole",
  "bastard",
  "bitch",
  "cock",
  "crap",
  "cunt",
  "damn",
  "dick",
  "fuck",
  "hell",
  "motherfucker",
  "piss",
  "shit",
  "slut",
  "whore",
];

function nicknameHasBadWord(value) {
  const normalized = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(
      /[013457@$]/g,
      (character) =>
        ({
          0: "o",
          1: "i",
          3: "e",
          4: "a",
          5: "s",
          7: "t",
          "@": "a",
          $: "s",
        })[character],
    );
  const patterns = blockedNicknameWords
    .map((word) => word.split("").join("[^a-z0-9]*"))
    .join("|");
  return new RegExp(`(^|[^a-z0-9])(?:${patterns})(?=$|[^a-z0-9])`, "i").test(
    normalized,
  );
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    role: user.role,
  };
}

function createAdmin() {
  if (db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get())
    return;
  const username = (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
  const configuredPassword = process.env.ADMIN_PASSWORD;
  const password =
    configuredPassword || crypto.randomBytes(24).toString("base64url");
  if (!/^[a-z0-9][a-z0-9._-]{2,19}$/.test(username)) {
    throw new Error(
      "ADMIN_USERNAME must be 3 to 20 letters, numbers, dots, dashes, or underscores.",
    );
  }
  if (Buffer.byteLength(password, "utf8") < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 bytes.");
  }
  const passwordHash = bcrypt.hashSync(password, 12);
  db.prepare(
    "INSERT INTO users (username, nickname, password_hash, role) VALUES (?, ?, ?, 'admin')",
  ).run(username, "Garden admin", passwordHash);
  if (!configuredPassword) {
    fs.writeFileSync(
      credentialsPath,
      `Username: ${username}\nPassword: ${password}\n`,
      { mode: 0o600 },
    );
    console.log(
      "Created the first admin account. Credentials are in .admin-credentials.txt",
    );
  }
}

createAdmin();

class SQLiteSessionStore extends session.Store {
  constructor(database) {
    super();
    this.database = database;
    this.getSession = database.prepare(
      "SELECT sess FROM sessions WHERE sid = ? AND expires_at > ?",
    );
    this.saveSession = database.prepare(`
      INSERT INTO sessions (sid, sess, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires_at = excluded.expires_at
    `);
    this.deleteSession = database.prepare("DELETE FROM sessions WHERE sid = ?");
    this.database
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(Date.now());
  }

  get(sid, callback) {
    try {
      const row = this.getSession.get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (error) {
      callback(error);
    }
  }

  set(sid, value, callback = () => {}) {
    try {
      const expiry = value.cookie?.expires
        ? new Date(value.cookie.expires).getTime()
        : Date.now() + 24 * 60 * 60 * 1000;
      this.saveSession.run(sid, JSON.stringify(value), expiry);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, value, callback = () => {}) {
    this.set(sid, value, callback);
  }

  destroy(sid, callback = () => {}) {
    try {
      this.deleteSession.run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

function findUser(id) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id);
}

function requireUser(req, res, next) {
  const user = req.session.userId && findUser(req.session.userId);
  if (!user)
    return res.status(401).json({ error: "Please sign in to continue." });
  req.user = user;
  next();
}

function requireStudent(req, res, next) {
  if (req.user.role !== "student")
    return res.status(403).json({ error: "A learner account is required." });
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Admin access is required." });
  next();
}

function makeCandidate(user, easy, operation) {
  const limits = gradeDetails[user.grade];
  if (operation === "add") {
    const max = easy ? 20 : limits.add;
    return { operation, a: randomInt(1, max), b: randomInt(1, max) };
  }
  if (operation === "subtract") {
    const max = easy ? 20 : limits.add;
    const first = randomInt(1, max);
    const second = randomInt(1, max - 1);
    return {
      operation,
      a: Math.max(first, second),
      b: Math.min(first, second),
    };
  }
  if (operation === "multiply") {
    const min = easy ? 0 : 2;
    const max = easy ? 10 : limits.multiply;
    return { operation, a: randomInt(min, max), b: randomInt(min, max) };
  }
  const min = easy ? 1 : 2;
  const max = easy ? 10 : limits.multiply;
  const divisor = randomInt(min, max);
  const quotient = randomInt(min, max);
  return { operation, a: divisor * quotient, b: divisor };
}

function questionKey(question) {
  const ordered =
    question.operation === "add" || question.operation === "multiply"
      ? [Math.min(question.a, question.b), Math.max(question.a, question.b)]
      : [question.a, question.b];
  return `${question.operation}:${ordered[0]}:${ordered[1]}`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateQuestion(user, easy) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const operation =
      user.operation === "mixed"
        ? operations[randomInt(0, operations.length - 1)]
        : user.operation;
    const candidate = makeCandidate(user, easy, operation);
    const inserted = db
      .prepare(
        "INSERT OR IGNORE INTO used_questions (user_id, question_key) VALUES (?, ?)",
      )
      .run(user.id, questionKey(candidate));
    if (inserted.changes) return { id: crypto.randomUUID(), ...candidate };
  }
  throw Object.assign(new Error("No unused questions remain in this set."), {
    status: 503,
  });
}

function answerFor(question) {
  if (question.operation === "add") return question.a + question.b;
  if (question.operation === "subtract") return question.a - question.b;
  if (question.operation === "multiply") return question.a * question.b;
  return question.a / question.b;
}

function assignQuestion(user, easy, incrementRound = true) {
  const question = generateQuestion(user, easy);
  const roundNumber = user.round_number + (incrementRound ? 1 : 0);
  db.prepare(
    "UPDATE users SET current_question = ?, easy_round = ?, round_number = ? WHERE id = ?",
  ).run(JSON.stringify(question), Number(easy), roundNumber, user.id);
  return { question, roundNumber };
}

function recentAnswers(userId, limit = 20) {
  return db
    .prepare(
      `
    SELECT question, answer, expected, correct, created_at AS time
    FROM answers WHERE user_id = ? ORDER BY id DESC LIMIT ?
  `,
    )
    .all(userId, limit)
    .map((entry) => ({ ...entry, correct: Boolean(entry.correct) }));
}

function studentState(userId) {
  let user = findUser(userId);
  if (!user || user.role !== "student")
    throw Object.assign(new Error("Learner account not found."), {
      status: 404,
    });
  if (!user.current_question) {
    db.transaction(() => {
      user = findUser(userId);
      if (!user.current_question) assignQuestion(user, false, false);
    })();
    user = findUser(userId);
  }
  return {
    user: publicUser(user),
    grade: user.grade,
    operation: user.operation,
    coins: user.coins,
    solved: user.solved,
    attempts: user.attempts,
    streak: user.streak,
    bestStreak: user.best_streak,
    ownedThemes: JSON.parse(user.owned_themes),
    activeTheme: user.active_theme,
    easyRound: Boolean(user.easy_round),
    roundNumber: user.round_number,
    question: JSON.parse(user.current_question),
    activity: recentAnswers(userId),
  };
}

function regenerateSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.userId = userId;
      req.session.save((saveError) =>
        saveError ? reject(saveError) : resolve(),
      );
    });
  });
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }),
);
app.use(express.json({ limit: "32kb" }));
app.use(
  session({
    name: "number-garden.sid",
    secret:
      process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex"),
    resave: false,
    saveUninitialized: false,
    store: new SQLiteSessionStore(db),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);
app.get("/", (_req, res) => res.sendFile(path.join(root, "index.html")));
app.get("/styles.css", (_req, res) =>
  res.sendFile(path.join(root, "styles.css")),
);
app.get("/client.js", (_req, res) =>
  res.sendFile(path.join(root, "client.js")),
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

app.get("/api/auth/me", (req, res) => {
  const user = req.session.userId && findUser(req.session.userId);
  res.json({ user: user ? publicUser(user) : null });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const username =
    typeof req.body.username === "string"
      ? req.body.username.trim().toLowerCase()
      : "";
  const password =
    typeof req.body.password === "string" ? req.body.password : "";
  const nickname =
    typeof req.body.nickname === "string" ? req.body.nickname.trim() : "";
  if (!/^[a-z0-9][a-z0-9._-]{2,19}$/.test(username)) {
    return res.status(400).json({
      error:
        "Username must be 3 to 20 letters, numbers, dots, dashes, or underscores.",
    });
  }
  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return res.status(400).json({
      error:
        "Password must be at least 8 characters and no more than 72 bytes.",
    });
  }
  if (!nickname || nickname.length > 18 || nicknameHasBadWord(nickname)) {
    return res.status(400).json({
      error: "Choose a nickname with 1 to 18 characters and no bad words.",
    });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  let result;
  try {
    result = db
      .prepare(
        "INSERT INTO users (username, nickname, password_hash, role) VALUES (?, ?, ?, 'student')",
      )
      .run(username, nickname, passwordHash);
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res
        .status(409)
        .json({ error: "That username is already in use." });
    }
    throw error;
  }
  await regenerateSession(req, Number(result.lastInsertRowid));
  res
    .status(201)
    .json({ user: publicUser(findUser(Number(result.lastInsertRowid))) });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password =
    typeof req.body.password === "string" ? req.body.password : "";
  const user = db
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res
      .status(401)
      .json({ error: "Username or password is not correct." });
  }
  await regenerateSession(req, user.id);
  res.json({ user: publicUser(user) });
});

app.post("/api/auth/logout", requireUser, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("number-garden.sid", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    res.status(204).end();
  });
});

app.post("/api/auth/change-password", requireUser, async (req, res) => {
  const currentPassword =
    typeof req.body.currentPassword === "string"
      ? req.body.currentPassword
      : "";
  const newPassword =
    typeof req.body.newPassword === "string" ? req.body.newPassword : "";
  if (!(await bcrypt.compare(currentPassword, req.user.password_hash))) {
    return res.status(400).json({ error: "Current password is not correct." });
  }
  if (newPassword.length < 8 || Buffer.byteLength(newPassword, "utf8") > 72) {
    return res.status(400).json({
      error:
        "New password must be at least 8 characters and no more than 72 bytes.",
    });
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    passwordHash,
    req.user.id,
  );
  res.json({ message: "Password changed." });
});

app.get("/api/state", requireUser, requireStudent, (req, res) => {
  res.json(studentState(req.user.id));
});

app.put("/api/preferences", requireUser, requireStudent, (req, res) => {
  const grade = Number(req.body.grade);
  const operation = req.body.operation;
  if (
    ![3, 4, 5].includes(grade) ||
    !["mixed", ...operations].includes(operation)
  ) {
    return res
      .status(400)
      .json({ error: "Choose a valid grade and practice type." });
  }
  const result = db.transaction(() => {
    db.prepare("UPDATE users SET grade = ?, operation = ? WHERE id = ?").run(
      grade,
      operation,
      req.user.id,
    );
    const user = findUser(req.user.id);
    assignQuestion(user, false);
  })();
  res.json(studentState(req.user.id));
});

app.put("/api/profile/nickname", requireUser, requireStudent, (req, res) => {
  const nickname =
    typeof req.body.nickname === "string" ? req.body.nickname.trim() : "";
  if (!nickname || nickname.length > 18 || nicknameHasBadWord(nickname)) {
    return res.status(400).json({
      error: "Choose a nickname with 1 to 18 characters and no bad words.",
    });
  }
  db.prepare("UPDATE users SET nickname = ? WHERE id = ?").run(
    nickname,
    req.user.id,
  );
  res.json(studentState(req.user.id));
});

app.post("/api/answer", requireUser, requireStudent, (req, res) => {
  const answer = Number(req.body.answer);
  const questionId =
    typeof req.body.questionId === "string" ? req.body.questionId : "";
  if (!Number.isSafeInteger(answer) || !questionId) {
    return res.status(400).json({ error: "Enter a whole-number answer." });
  }
  const outcome = db.transaction(() => {
    const user = findUser(req.user.id);
    const question = user.current_question
      ? JSON.parse(user.current_question)
      : null;
    if (!question || question.id !== questionId) return { conflict: true };
    const expected = answerFor(question);
    const correct = answer === expected;
    const nextEasy = !correct;
    const nextStreak = correct ? user.streak + 1 : 0;
    db.prepare(
      `
      INSERT INTO answers (user_id, question, answer, expected, correct)
      VALUES (?, ?, ?, ?, ?)
    `,
    ).run(
      user.id,
      `${question.a} ${operationSymbols[question.operation]} ${question.b} = ?`,
      answer,
      expected,
      Number(correct),
    );
    db.prepare(
      `
      UPDATE users SET
        attempts = attempts + 1,
        solved = solved + ?,
        coins = coins + ?,
        streak = ?,
        best_streak = MAX(best_streak, ?)
      WHERE id = ?
    `,
    ).run(Number(correct), Number(correct), nextStreak, nextStreak, user.id);
    const updatedUser = findUser(user.id);
    const next = assignQuestion(updatedUser, nextEasy);
    return {
      correct,
      expected,
      easyRound: nextEasy,
      question: next.question,
      roundNumber: next.roundNumber,
    };
  })();
  if (outcome.conflict) {
    return res.status(409).json({
      error:
        "This question changed in another tab. Your latest question is ready.",
      state: studentState(req.user.id),
    });
  }
  res.json({ ...outcome, state: studentState(req.user.id) });
});

app.get("/api/themes", (_req, res) => res.json({ themes }));

app.post("/api/themes/:themeId", requireUser, requireStudent, (req, res) => {
  const theme = themeById.get(req.params.themeId);
  if (!theme) return res.status(404).json({ error: "Theme not found." });
  const outcome = db.transaction(() => {
    const user = findUser(req.user.id);
    const owned = JSON.parse(user.owned_themes);
    if (owned.includes(theme.id)) {
      db.prepare("UPDATE users SET active_theme = ? WHERE id = ?").run(
        theme.id,
        user.id,
      );
      return { changed: true };
    }
    if (user.coins < theme.cost) return { changed: false };
    owned.push(theme.id);
    db.prepare(
      "UPDATE users SET coins = coins - ?, owned_themes = ?, active_theme = ? WHERE id = ?",
    ).run(theme.cost, JSON.stringify(owned), theme.id, user.id);
    return { changed: true };
  })();
  if (!outcome.changed)
    return res
      .status(400)
      .json({ error: "You need more coins for this background." });
  res.json({ state: studentState(req.user.id) });
});

app.get("/api/admin/learners", requireUser, requireAdmin, (_req, res) => {
  const learners = db
    .prepare(
      `
    SELECT id, username, nickname, grade, coins, solved, attempts, streak,
      best_streak AS bestStreak, created_at AS createdAt
    FROM users WHERE role = 'student' ORDER BY username COLLATE NOCASE LIMIT 500
  `,
    )
    .all()
    .map((learner) => ({
      ...learner,
      accuracy: learner.attempts
        ? Math.round((learner.solved / learner.attempts) * 100)
        : 0,
      recent: recentAnswers(learner.id, 5),
    }));
  res.json({ learners });
});

app.post(
  "/api/admin/learners/:id/coins",
  requireUser,
  requireAdmin,
  (req, res) => {
    const learnerId = Number(req.params.id);
    const action = req.body.action;
    const amount = Number(req.body.amount);
    const learner = db
      .prepare("SELECT id, coins FROM users WHERE id = ? AND role = 'student'")
      .get(learnerId);
    if (!learner) return res.status(404).json({ error: "Learner not found." });
    if (!["give", "take", "all"].includes(action))
      return res.status(400).json({ error: "Choose give, take, or all." });
    if (
      action !== "all" &&
      (!Number.isInteger(amount) || amount < 1 || amount > 9999)
    ) {
      return res
        .status(400)
        .json({ error: "Amount must be between 1 and 9,999 coins." });
    }
    const updated = db.transaction(() => {
      const current = db
        .prepare("SELECT coins FROM users WHERE id = ?")
        .get(learnerId).coins;
      const delta =
        action === "give"
          ? amount
          : -(action === "all" ? current : Math.min(amount, current));
      const balance = current + delta;
      db.prepare("UPDATE users SET coins = ? WHERE id = ?").run(
        balance,
        learnerId,
      );
      if (delta !== 0) {
        db.prepare(
          "INSERT INTO coin_adjustments (admin_id, learner_id, delta) VALUES (?, ?, ?)",
        ).run(req.user.id, learnerId, delta);
      }
      return { balance, delta };
    })();
    res.json(updated);
  },
);

app.use("/api", (_req, res) =>
  res.status(404).json({ error: "API route not found." }),
);
app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: error.status
      ? error.message
      : "Something went wrong. Please try again.",
  });
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`Number Garden is running at http://${host}:${port}`);
});
