const appShell = document.querySelector("#appShell");
const authView = document.querySelector("#authView");
const authFeedback = document.querySelector("#authFeedback");
const answerInput = document.querySelector("#answerInput");
const feedback = document.querySelector("#feedback");
const operationSymbols = {
  add: "+",
  subtract: "−",
  multiply: "×",
  divide: "÷",
};
const operationNames = {
  add: "addition",
  subtract: "subtraction",
  multiply: "multiplication",
  divide: "division",
};
const gradeLabels = {
  3: "Growing your skills",
  4: "Nice and steady",
  5: "Ready for a stretch",
};
let currentUser = null;
let student = null;
let themes = [];
let learners = [];

class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function api(url, options = {}) {
  const headers = { ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  let payload = {};
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    if (response.status === 401 && currentUser) showSignedOut();
    throw new ApiError(
      payload.error || "The request could not be completed.",
      response.status,
      payload,
    );
  }
  return payload;
}

function showAuthMode(mode) {
  const register = mode === "register";
  document.querySelector("#loginForm").classList.toggle("is-hidden", register);
  document
    .querySelector("#registerForm")
    .classList.toggle("is-hidden", !register);
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    const active = button.dataset.authMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  authFeedback.textContent = "";
}

function showSignedOut() {
  currentUser = null;
  student = null;
  appShell.classList.add("signed-out");
  authView.classList.remove("is-hidden");
  document.querySelector("#loginForm").reset();
  document.querySelector("#registerForm").reset();
  showAuthMode("login");
}

function setTheme(themeId) {
  appShell.dataset.theme = themeId;
}

function setView(view) {
  if (!currentUser) return;
  if (currentUser.role === "admin" && view !== "admin") return;
  if (currentUser.role !== "admin" && view === "admin") return;
  document
    .querySelector("#practiceView")
    .classList.toggle("is-hidden", view !== "practice");
  document
    .querySelector("#shopView")
    .classList.toggle("is-hidden", view !== "shop");
  document
    .querySelector("#adminView")
    .classList.toggle("is-hidden", view !== "admin");
  document.querySelectorAll(".nav-link").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
  if (view === "shop") renderShop();
  if (view === "admin") loadAdmin();
}

function renderQuestion() {
  if (!student?.question) return;
  const question = student.question;
  document.querySelector("#questionText").textContent =
    `${question.a} ${operationSymbols[question.operation]} ${question.b} = ?`;
  document.querySelector("#questionNumber").textContent = String(
    student.roundNumber,
  ).padStart(2, "0");
  document.querySelector("#roundLabel").innerHTML = student.easyRound
    ? '<span class="round-spark">✦</span> WARM-UP ROUND'
    : '<span class="round-spark">✦</span> YOUR NEXT CHALLENGE';
  answerInput.value = "";
}

function renderProgress() {
  if (!student) return;
  document.querySelector("#coinCount").textContent = student.coins;
  document.querySelector("#shopCoinCount").textContent = student.coins;
  document.querySelector("#streakCount").textContent = student.bestStreak;
  document.querySelector("#solvedCount").textContent = student.solved;
  document.querySelector("#nicknameDisplay").textContent =
    student.user.nickname;
  document.querySelector("#accountName").textContent = student.user.nickname;
  const progress = student.solved % 5;
  document.querySelector("#pathProgressText").textContent = `${progress} / 5`;
  document.querySelector("#pathProgress").style.width =
    `${(progress / 5) * 100}%`;
  document.querySelector("#pathCaption").textContent =
    progress === 0 && student.solved > 0
      ? "A new flower is ready to grow. Solve 5 more!"
      : `Solve ${5 - progress} more ${5 - progress === 1 ? "problem" : "problems"} to grow your next flower.`;
}

function renderStudent(nextStudent) {
  student = nextStudent;
  setTheme(student.activeTheme);
  document.querySelectorAll("[data-grade]").forEach((button) => {
    const active = Number(button.dataset.grade) === student.grade;
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelector("#gradeNote").textContent = gradeLabels[student.grade];
  document.querySelectorAll("[data-operation]").forEach((button) => {
    const active = button.dataset.operation === student.operation;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  renderQuestion();
  renderProgress();
}

function makeThemeCard(theme) {
  const card = document.createElement("article");
  card.className = "theme-card";
  const owned = student.ownedThemes.includes(theme.id);
  const active = student.activeTheme === theme.id;
  const preview = document.createElement("div");
  preview.className = "theme-preview";
  preview.style.setProperty("--preview", theme.preview);
  preview.style.setProperty("--hill", theme.hill);
  preview.style.setProperty("--hill-second", theme.second);
  preview.innerHTML =
    '<span class="preview-sun"></span><span class="preview-hill"></span><span class="preview-flower">✿</span>';
  const info = document.createElement("div");
  info.className = "theme-info";
  const name = document.createElement("div");
  name.className = "theme-name";
  const title = document.createElement("strong");
  title.textContent = theme.name;
  const price = document.createElement("span");
  price.innerHTML = owned
    ? '<span aria-hidden="true">✓</span> In your collection'
    : `<span class="coin-icon" aria-hidden="true">✦</span> ${theme.cost} coins`;
  name.append(title, price);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "theme-action";
  button.textContent = active ? "Using now" : owned ? "Use theme" : "Buy theme";
  button.disabled = active;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await api(`/api/themes/${encodeURIComponent(theme.id)}`, {
        method: "POST",
      });
      renderStudent(result.state);
      document.querySelector("#shopFeedback").textContent = owned
        ? `${theme.name} is on.`
        : `${theme.name} unlocked and applied.`;
      renderShop();
    } catch (error) {
      document.querySelector("#shopFeedback").textContent = error.message;
      button.disabled = false;
    }
  });
  info.append(name, button);
  card.append(preview, info);
  return card;
}

function renderShop() {
  if (!student) return;
  const grid = document.querySelector("#themeGrid");
  grid.replaceChildren(...themes.map(makeThemeCard));
  document.querySelector("#themeCount").textContent =
    `${student.ownedThemes.length} / ${themes.length} collected`;
}

function makeActivityItem(entry) {
  const item = document.createElement("li");
  item.className = "learner-activity-item";
  const question = document.createElement("strong");
  question.textContent = entry.question;
  const response = document.createElement("span");
  response.textContent = `Answer: ${entry.answer}`;
  const result = document.createElement("span");
  result.className = entry.correct
    ? "activity-result is-right"
    : "activity-result is-incorrect";
  result.textContent = entry.correct
    ? "Correct"
    : `Answer was ${entry.expected}`;
  const time = document.createElement("time");
  time.dateTime = entry.time;
  time.textContent = new Date(entry.time).toLocaleString();
  item.append(question, response, result, time);
  return item;
}

function makeLearnerCard(learner) {
  const card = document.createElement("article");
  card.className = "learner-card";
  const heading = document.createElement("div");
  heading.className = "learner-card-heading";
  const identity = document.createElement("div");
  identity.className = "learner-identity";
  const nickname = document.createElement("strong");
  nickname.textContent = learner.nickname;
  const username = document.createElement("span");
  username.textContent = `@${learner.username}`;
  identity.append(nickname, username);
  const grade = document.createElement("span");
  grade.className = "admin-grade-badge";
  grade.textContent = `Grade ${learner.grade}`;
  const balance = document.createElement("span");
  balance.className = "learner-balance";
  balance.innerHTML = `<span aria-hidden="true">✦</span> ${learner.coins}`;
  heading.append(identity, grade, balance);

  const stats = document.createElement("div");
  stats.className = "learner-stats";
  [
    ["Correct", learner.solved],
    ["Attempts", learner.attempts],
    ["Accuracy", `${learner.accuracy}%`],
    ["Best streak", learner.bestStreak],
  ].forEach(([label, value]) => {
    const stat = document.createElement("div");
    const title = document.createElement("span");
    title.textContent = label;
    const number = document.createElement("strong");
    number.textContent = value;
    stat.append(title, number);
    stats.append(stat);
  });

  const details = document.createElement("details");
  details.className = "learner-history";
  const summary = document.createElement("summary");
  summary.textContent = "Recent answers";
  const history = document.createElement("ol");
  history.className = "learner-activity-list";
  const historyEntries = learner.recent.map(makeActivityItem);
  if (!historyEntries.length) {
    const empty = document.createElement("li");
    empty.className = "activity-empty";
    empty.textContent = "No answers yet.";
    historyEntries.push(empty);
  }
  history.replaceChildren(...historyEntries);
  details.append(summary, history);

  const form = document.createElement("form");
  form.className = "learner-coin-form";
  const amount = document.createElement("input");
  amount.type = "number";
  amount.min = "1";
  amount.max = "9999";
  amount.step = "1";
  amount.value = "1";
  amount.required = true;
  amount.setAttribute("aria-label", `Coin amount for ${learner.nickname}`);
  const give = document.createElement("button");
  give.type = "submit";
  give.dataset.action = "give";
  give.textContent = "Give coins";
  const take = document.createElement("button");
  take.type = "submit";
  take.dataset.action = "take";
  take.textContent = "Take coins";
  const all = document.createElement("button");
  all.type = "submit";
  all.dataset.action = "all";
  all.className = "take-all-button";
  all.textContent = "Take all";
  form.append(amount, give, take, all);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const action = event.submitter?.dataset.action;
    if (!action) return;
    if (
      action === "all" &&
      learner.coins > 0 &&
      !window.confirm(
        `Take all ${learner.coins} coins from ${learner.nickname}?`,
      )
    )
      return;
    const buttons = [...form.querySelectorAll("button")];
    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      await api(`/api/admin/learners/${learner.id}/coins`, {
        method: "POST",
        body: JSON.stringify({ action, amount: Number(amount.value) }),
      });
      await loadAdmin();
    } catch (error) {
      const message = document.createElement("p");
      message.className = "admin-inline-feedback";
      message.textContent = error.message;
      form.after(message);
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  });

  card.append(heading, stats, details, form);
  return card;
}

function renderAdmin() {
  const search = document
    .querySelector("#learnerSearch")
    .value.trim()
    .toLowerCase();
  const filtered = learners.filter((learner) =>
    `${learner.nickname} ${learner.username}`.toLowerCase().includes(search),
  );
  document.querySelector("#learnerCount").textContent =
    `${learners.length} ${learners.length === 1 ? "learner" : "learners"}`;
  const list = document.querySelector("#learnerList");
  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "admin-empty";
    empty.textContent = learners.length
      ? "No learners match that search."
      : "No learner accounts yet. Learners can create their own accounts from the sign-in screen.";
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...filtered.map(makeLearnerCard));
}

async function loadAdmin() {
  if (currentUser?.role !== "admin") return;
  try {
    const result = await api("/api/admin/learners");
    learners = result.learners;
    renderAdmin();
  } catch (error) {
    document.querySelector("#learnerList").textContent = error.message;
  }
}

async function enterApp(user) {
  currentUser = user;
  appShell.classList.remove("signed-out");
  authView.classList.add("is-hidden");
  const isAdmin = currentUser.role === "admin";
  document.querySelector('[data-view="practice"]').hidden = isAdmin;
  document.querySelector('[data-view="shop"]').hidden = isAdmin;
  document.querySelector('[data-view="admin"]').hidden = !isAdmin;
  document.querySelector("#coinDisplay").classList.toggle("is-hidden", isAdmin);
  document.querySelector("#accountName").textContent = isAdmin
    ? currentUser.username
    : currentUser.nickname;
  if (isAdmin) {
    setView("admin");
    return;
  }
  try {
    const [stateResult, themeResult] = await Promise.all([
      api("/api/state"),
      api("/api/themes"),
    ]);
    themes = themeResult.themes;
    renderStudent(stateResult);
    setView("practice");
  } catch (error) {
    document.querySelector("#authFeedback").textContent = error.message;
  }
}

document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => showAuthMode(button.dataset.authMode));
});

document
  .querySelector("#loginForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    authFeedback.textContent = "Signing in…";
    try {
      const result = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: form.elements.username.value,
          password: form.elements.password.value,
        }),
      });
      await enterApp(result.user);
    } catch (error) {
      authFeedback.textContent = error.message;
    }
  });

document
  .querySelector("#registerForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    authFeedback.textContent = "Creating account…";
    try {
      const result = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          nickname: form.elements.nickname.value,
          username: form.elements.username.value,
          password: form.elements.password.value,
        }),
      });
      await enterApp(result.user);
    } catch (error) {
      authFeedback.textContent = error.message;
    }
  });

document.querySelector("#signOutButton").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {
    // The local view still signs out if the server session has expired.
  }
  showSignedOut();
});

document.querySelectorAll(".nav-link").forEach((button) => {
  button.addEventListener("click", () => setView(button.dataset.view));
});

document.querySelectorAll("[data-grade]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      const result = await api("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({
          grade: Number(button.dataset.grade),
          operation: student.operation,
        }),
      });
      renderStudent(result);
      feedback.textContent = "New grade, new challenge. You’ve got this!";
      feedback.className = "feedback";
    } catch (error) {
      feedback.textContent = error.message;
    }
  });
});

document.querySelectorAll("[data-operation]").forEach((button) => {
  button.addEventListener("click", async () => {
    try {
      const result = await api("/api/preferences", {
        method: "PUT",
        body: JSON.stringify({
          grade: student.grade,
          operation: button.dataset.operation,
        }),
      });
      renderStudent(result);
      feedback.textContent = "A fresh question, just for you.";
      feedback.className = "feedback";
    } catch (error) {
      feedback.textContent = error.message;
    }
  });
});

document
  .querySelector("#answerForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!student || answerInput.value.trim() === "") return;
    const previous = student;
    const submitButton = event.currentTarget.querySelector(
      "button[type=submit]",
    );
    submitButton.disabled = true;
    try {
      const result = await api("/api/answer", {
        method: "POST",
        body: JSON.stringify({
          questionId: previous.question.id,
          answer: Number(answerInput.value),
        }),
      });
      renderStudent(result.state);
      if (result.correct) {
        feedback.textContent = `That’s right! +1 coin. ${previous.easyRound ? "Back to your regular challenge!" : "Here comes another one!"}`;
        feedback.className = "feedback is-correct";
      } else {
        feedback.textContent = `Not quite. Here’s an easier ${operationNames[previous.question.operation]} question to try.`;
        feedback.className = "feedback is-wrong";
      }
    } catch (error) {
      if (error.payload?.state) renderStudent(error.payload.state);
      feedback.textContent = error.message;
      feedback.className = "feedback is-wrong";
    } finally {
      submitButton.disabled = false;
    }
  });

const nicknameForm = document.querySelector("#nicknameForm");
const nicknameInput = document.querySelector("#nicknameInput");
const nicknameFeedback = document.querySelector("#nicknameFeedback");
document
  .querySelector("#editNicknameButton")
  .addEventListener("click", (event) => {
    const opening = nicknameForm.classList.contains("is-hidden");
    nicknameForm.classList.toggle("is-hidden", !opening);
    event.currentTarget.setAttribute("aria-expanded", String(opening));
    nicknameFeedback.textContent = "";
    if (opening) {
      nicknameInput.value = student.user.nickname;
      nicknameInput.focus();
    }
  });
nicknameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  nicknameFeedback.textContent = "Saving…";
  try {
    renderStudent(
      await api("/api/profile/nickname", {
        method: "PUT",
        body: JSON.stringify({ nickname: nicknameInput.value }),
      }),
    );
    nicknameFeedback.textContent = "Nickname saved.";
  } catch (error) {
    nicknameFeedback.textContent = error.message;
  }
});

document.querySelector("#learnerSearch").addEventListener("input", renderAdmin);
document
  .querySelector("#changePasswordForm")
  .addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = document.querySelector("#passwordFeedback");
    message.textContent = "Updating password…";
    try {
      const result = await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: form.elements.currentPassword.value,
          newPassword: form.elements.newPassword.value,
        }),
      });
      message.textContent = result.message;
      form.reset();
    } catch (error) {
      message.textContent = error.message;
    }
  });

async function initialize() {
  try {
    const [auth, themeResult] = await Promise.all([
      api("/api/auth/me"),
      api("/api/themes"),
    ]);
    themes = themeResult.themes;
    if (auth.user) await enterApp(auth.user);
  } catch (error) {
    authFeedback.textContent = error.message;
  }
}

initialize();
