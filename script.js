// ---------------------------------------------------------------
// Configuration: change the backend address here only.
// ---------------------------------------------------------------
// const API_BASE_URL = "http://127.0.0.1:8000";
// const PREDICT_URL = `${API_BASE_URL}/predict`;

// Local machine par localhost use karega, live site par Render ka URL
const API_BASE_URL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8000"
    : "https://mindmetrics-mental-health-prediction.onrender.com";

const PREDICT_URL = `${API_BASE_URL}/predict`;


// Gauge display range (visual aid only; the model's real scale is unknown)
const GAUGE_MAX = 10;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 52;

// ---------------------------------------------------------------
// Field definitions: names match the backend StudentData model exactly.
// ---------------------------------------------------------------
const FIELDS = [
  { name: "age", label: "Age", type: "int", min: 10, max: 100 },
  { name: "gender", label: "Gender", type: "choice", options: ["Male", "Female"] },
  { name: "country", label: "Country", type: "text" },
  { name: "academic_level", label: "Academic level", type: "choice", options: ["Undergraduate", "Graduate", "High School"] },
  {
    name: "most_used_platform", label: "Most used platform", type: "choice",
    options: ["Facebook", "LinkedIn", "Instagram", "Snapchat", "Twitter", "YouTube", "TikTok", "LINE", "KakaoTalk", "VKontakte", "WhatsApp", "WeChat"],
  },
  { name: "purpose_of_use", label: "Purpose of use", type: "choice", options: ["Networking", "Education", "Entertainment", "News"] },
  { name: "avg_daily_usage_hours", label: "Average daily usage", type: "float", min: 0, max: 24 },
  { name: "daily_unlocks", label: "Daily unlocks", type: "int", min: 0 },
  { name: "study_hours", label: "Study hours", type: "float", min: 0, max: 24 },
  { name: "physical_activity_hours", label: "Physical activity hours", type: "float", min: 0, max: 24 },
  { name: "sleep_hours_per_night", label: "Sleep hours", type: "float", min: 0, max: 24 },
  { name: "stress_level", label: "Stress level", type: "choice", options: ["Medium", "Low", "Very High", "High"] },
];

// ---------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------
const form = document.getElementById("prediction-form");
const submitBtn = document.getElementById("submit-btn");
const submitLabel = document.getElementById("submit-label");
const resetBtn = document.getElementById("reset-btn");
const newPredictionBtn = document.getElementById("new-prediction-btn");
const errorBox = document.getElementById("error-box");
const errorTitle = document.getElementById("error-title");
const errorList = document.getElementById("error-list");
const loadingPanel = document.getElementById("loading-panel");
const resultPanel = document.getElementById("result-panel");
const placeholderPanel = document.getElementById("placeholder-panel");
const scoreValue = document.getElementById("score-value");
const gaugeFill = document.getElementById("gauge-fill");

let isLoading = false; // blocks duplicate requests

// ---------------------------------------------------------------
// Validation
// ---------------------------------------------------------------
function setFieldError(name, message) {
  const input = document.getElementById(name);
  const errorEl = document.getElementById(`${name}-error`);
  if (errorEl) errorEl.textContent = message || "";
  if (input) {
    input.classList.toggle("invalid", Boolean(message));
    input.setAttribute("aria-invalid", message ? "true" : "false");
  }
}

function clearAllFieldErrors() {
  FIELDS.forEach((f) => setFieldError(f.name, ""));
}

/** Validate one field; returns { value, error }. Numbers are returned as JS numbers. */
function validateField(field) {
  const raw = document.getElementById(field.name).value.trim();

  if (raw === "") return { error: `${field.label} is required.` };

  if (field.type === "text") return { value: raw };

  if (field.type === "choice") {
    if (!field.options.includes(raw)) return { error: `Please choose a valid ${field.label.toLowerCase()}.` };
    return { value: raw };
  }

  const num = Number(raw);
  if (!Number.isFinite(num)) return { error: `${field.label} must be a number.` };
  if (field.type === "int" && !Number.isInteger(num)) return { error: `${field.label} must be a whole number.` };
  if (field.min !== undefined && num < field.min) return { error: `${field.label} must be at least ${field.min}.` };
  if (field.max !== undefined && num > field.max) return { error: `${field.label} must be at most ${field.max}.` };
  return { value: num };
}

/** Validate every field; returns { payload, errors } */
function collectAndValidate() {
  const payload = {};
  const errors = [];
  FIELDS.forEach((field) => {
    const { value, error } = validateField(field);
    if (error) {
      errors.push({ name: field.name, message: error });
      setFieldError(field.name, error);
    } else {
      setFieldError(field.name, "");
      payload[field.name] = value;
    }
  });
  return { payload, errors };
}

// ---------------------------------------------------------------
// UI state helpers
// ---------------------------------------------------------------
function showError(title, messages) {
  errorTitle.textContent = title;
  errorList.replaceChildren(); // safe: use textContent, never innerHTML
  messages.forEach((msg) => {
    const li = document.createElement("li");
    li.textContent = msg;
    errorList.appendChild(li);
  });
  errorBox.hidden = false;
  errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() {
  errorBox.hidden = true;
  errorList.replaceChildren();
}

function setLoading(loading) {
  isLoading = loading;
  submitBtn.disabled = loading;
  submitBtn.classList.toggle("is-loading", loading);
  submitBtn.setAttribute("aria-busy", String(loading));
  submitLabel.textContent = loading ? "Analyzing..." : "Predict Mental Health Score";
  loadingPanel.hidden = !loading;
  if (loading) {
    resultPanel.hidden = true;
    placeholderPanel.hidden = true;
  }
}

function showResult(score) {
  scoreValue.textContent = score.toFixed(2);
  placeholderPanel.hidden = true;
  resultPanel.hidden = false;

  // Animate gauge (clamped to the display range)
  gaugeFill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
  const fraction = Math.min(Math.max(score / GAUGE_MAX, 0), 1);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      gaugeFill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE * (1 - fraction);
    });
  });
  resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideResult() {
  resultPanel.hidden = true;
  gaugeFill.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
  placeholderPanel.hidden = false;
}

// ---------------------------------------------------------------
// Backend error parsing (FastAPI 422 returns { detail: [{loc, msg}, ...] })
// ---------------------------------------------------------------
function parseValidationDetail(detail) {
  if (Array.isArray(detail)) {
    return detail.map((item) => {
      const loc = Array.isArray(item.loc) ? item.loc.filter((p) => p !== "body").join(" › ") : "";
      return loc ? `${loc}: ${item.msg}` : String(item.msg);
    });
  }
  if (typeof detail === "string") return [detail];
  return ["The server rejected the input."];
}

// ---------------------------------------------------------------
// API request
// ---------------------------------------------------------------
async function requestPrediction(payload) {
  let response;
  try {
    response = await fetch(PREDICT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (networkError) {
    // fetch rejects for network failure, server down, or CORS block
    const err = new Error("Could not reach the prediction server.");
    err.details = [
      `Make sure FastAPI is running at ${API_BASE_URL} (uvicorn main:app --port 8000 --reload).`,
      "If it is running, check the browser console for a CORS error.",
    ];
    throw err;
  }

  if (!response.ok) {
    let body = null;
    try { body = await response.json(); } catch (_) { /* non-JSON error body */ }

    const err = new Error(
      response.status === 422 ? "Some inputs were rejected by the server." : `The server returned an error (HTTP ${response.status}).`
    );
    err.details = body && body.detail !== undefined
      ? parseValidationDetail(body.detail)
      : ["No further details were provided by the server."];
    throw err;
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    const err = new Error("The server sent an invalid response.");
    err.details = ["The response could not be parsed as JSON."];
    throw err;
  }

  const score = data ? data.predicted_mental_health_score : undefined;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    const err = new Error("The response did not contain a valid prediction.");
    err.details = ['Expected a numeric "predicted_mental_health_score" field.'];
    throw err;
  }
  return score;
}

// ---------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------
async function handleSubmit(event) {
  event.preventDefault();
  if (isLoading) return; // prevent duplicate requests

  hideError();
  const { payload, errors } = collectAndValidate();

  if (errors.length > 0) {
    hideResult();
    showError("Please correct the highlighted fields.", errors.map((e) => e.message));
    document.getElementById(errors[0].name).focus({ preventScroll: true });
    return;
  }

  setLoading(true);
  try {
    const score = await requestPrediction(payload);
    setLoading(false);
    showResult(score);
  } catch (error) {
    setLoading(false);
    hideResult();
    showError(error.message || "Something went wrong.", error.details || []);
  }
}

function handleReset() {
  if (isLoading) return;
  form.reset();
  clearAllFieldErrors();
  hideError();
  hideResult();
  document.getElementById("age").focus();
}

form.addEventListener("submit", handleSubmit);
resetBtn.addEventListener("click", handleReset);
newPredictionBtn.addEventListener("click", handleReset);

// Clear a field's error as soon as the user edits it
FIELDS.forEach((field) => {
  const el = document.getElementById(field.name);
  const evt = field.type === "choice" ? "change" : "input";
  el.addEventListener(evt, () => setFieldError(field.name, ""));
});
