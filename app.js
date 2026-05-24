const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";
const WEB3FORMS_ACCESS_KEY_PLACEHOLDER = "REPLACE_WITH_WEB3FORMS_ACCESS_KEY";
const MIN_FORM_AGE_MS = 3500;
const SUBMIT_COOLDOWN_MS = 15000;
const SUBMIT_TIMEOUT_MS = 12000;
const LAST_SUBMIT_STORAGE_KEY = "bmoFriendesbriefLastSubmit";
const formOpenedAt = Date.now();

const form = document.querySelector("#subscriptionForm");
const track = document.querySelector(".form-track");
const panels = [...document.querySelectorAll(".step-panel")];
const progressLines = [...document.querySelectorAll(".progress-line")];
const submitButton = document.querySelector("[data-submit-button]");
const submitStatus = document.querySelector("[data-submit-status]");
const commitmentField = form.elements.commitment;
const privacyConsentField = form.elements.privacyConsent;

let selectedRoute = "";
let currentStep = "start";
let stepStack = ["start"];
let isSubmitting = false;

const fieldGroups = {
  email: ["email"],
  post: ["street", "houseNumber", "zip", "city", "country"],
  person: ["salutation", "firstName", "lastName", "commitment", "privacyConsent"],
};

const messages = {
  email: "Bitte gib eine gültige E-Mail-Adresse ein.",
  street: "Bitte trage deine Straße ein.",
  houseNumber: "Bitte trage deine Hausnummer ein.",
  zip: "Bitte trage deine PLZ ein.",
  city: "Bitte trage deinen Wohnort ein.",
  country: "Bitte trage das Land ein.",
  salutation: "Bitte wähle eine Anrede aus.",
  firstName: "Bitte trage deinen Vornamen ein.",
  lastName: "Bitte trage deinen Nachnamen ein.",
  commitment: "Bitte bestätige das unverbindliche Abonnement.",
  privacyConsent: "Bitte bestätige, dass du die Datenschutzerklärung gelesen hast und der Verarbeitung zustimmst.",
};

const maxLengths = {
  email: 120,
  street: 100,
  houseNumber: 20,
  zip: 16,
  city: 80,
  country: 80,
  salutation: 10,
  firstName: 80,
  lastName: 80,
};

function stepIndex(stepName) {
  return panels.findIndex((panel) => panel.dataset.step === stepName);
}

function activePanel() {
  return panels.find((panel) => panel.dataset.step === currentStep);
}

function showStep(stepName, shouldStack = true) {
  const index = stepIndex(stepName);

  if (index < 0) {
    return;
  }

  currentStep = stepName;

  if (shouldStack) {
    stepStack.push(stepName);
  }

  panels.forEach((panel) => {
    const isActive = panel.dataset.step === stepName;
    panel.classList.toggle("is-active", isActive);
    panel.setAttribute("aria-hidden", String(!isActive));
    panel.inert = !isActive;
  });

  track.style.transform = `translateX(-${index * 100}%)`;
  updateProgress(stepName);
  clearError();

  const firstField = activePanel()?.querySelector("input, select, button.choice-card");
  window.setTimeout(() => firstField?.focus({ preventScroll: true }), 260);
}

function updateProgress(stepName) {
  const value = stepName === "start" ? 0 : stepName === "success" ? 2 : stepName === "person" ? 2 : 1;

  progressLines.forEach((line, index) => {
    line.classList.toggle("is-active", index <= value);
  });
}

function clearError() {
  const error = activePanel()?.querySelector("[data-error]");

  if (error) {
    error.textContent = "";
  }

  if (submitStatus) {
    submitStatus.textContent = "";
  }
}

function setError(message) {
  const error = activePanel()?.querySelector("[data-error]");

  if (error) {
    error.textContent = message;
  }
}

function setSubmitState(isBusy) {
  submitButton.disabled = isBusy || !commitmentField.checked || !privacyConsentField.checked;
  submitButton.textContent = isBusy ? "Wird gesendet..." : "Abonnieren";
}

function getField(name) {
  return form.elements[name];
}

function sanitizeValue(value, maxLength = 120) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeSessionValue(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function setSafeSessionValue(key, value) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Session storage can be unavailable in strict browser modes; validation still continues.
  }
}

function fieldValue(name) {
  return sanitizeValue(getField(name)?.value, maxLengths[name]);
}

function web3FormsAccessKey() {
  return sanitizeValue(form.elements.access_key?.value, 80);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function isAllowedSalutation(value) {
  return value === "Herr" || value === "Frau";
}

function validateField(name) {
  const field = getField(name);
  const value = field.type === "checkbox" ? field.checked : fieldValue(name);

  if (name === "email") {
    return isValidEmail(value.toLowerCase());
  }

  if (name === "salutation") {
    return isAllowedSalutation(value);
  }

  if (name === "zip") {
    return /^[A-Za-z0-9 -]{3,16}$/.test(value);
  }

  return Boolean(value);
}

function validateStep(stepName) {
  const names = fieldGroups[stepName] || [];

  for (const name of names) {
    const field = getField(name);

    if (!validateField(name)) {
      setError(messages[name]);
      field.focus();
      return false;
    }
  }

  clearError();
  return true;
}

function validateFullSubmission() {
  if (!selectedRoute) {
    showStep("start", false);
    setError("Bitte wähle zuerst aus, wie du den Freundesbrief erhalten möchtest.");
    return false;
  }

  const routeIsValid = validateStep(selectedRoute);

  if (!routeIsValid) {
    showStep(selectedRoute, false);
    return false;
  }

  return validateStep("person");
}

function validateSubmitTiming() {
  const age = Date.now() - formOpenedAt;

  if (age < MIN_FORM_AGE_MS) {
    setError("Bitte nimm dir einen kurzen Moment, bevor du das Formular absendest.");
    return false;
  }

  const lastSubmitAt = Number(safeSessionValue(LAST_SUBMIT_STORAGE_KEY) || 0);
  const cooldownRemaining = SUBMIT_COOLDOWN_MS - (Date.now() - lastSubmitAt);

  if (cooldownRemaining > 0) {
    setError("Bitte warte einen Moment, bevor du das Formular erneut absendest.");
    return false;
  }

  return true;
}

function buildWeb3FormsPayload() {
  const timestamp = new Date();
  const routeLabel = selectedRoute === "email" ? "Per E-Mail" : "Per Post";

  return {
    access_key: web3FormsAccessKey(),
    subject: "Neue Freundesbrief-Anmeldung",
    from_name: "BMO Freundesbrief Formular",
    botcheck: form.elements.botcheck.checked ? "true" : "",
    "Versandart": routeLabel,
    "Anrede": fieldValue("salutation"),
    "Vorname": fieldValue("firstName"),
    "Nachname": fieldValue("lastName"),
    "E-Mail-Adresse": selectedRoute === "email" ? fieldValue("email").toLowerCase() : "",
    email: selectedRoute === "email" ? fieldValue("email").toLowerCase() : "",
    "Straße": selectedRoute === "post" ? fieldValue("street") : "",
    "Hausnummer": selectedRoute === "post" ? fieldValue("houseNumber") : "",
    "PLZ": selectedRoute === "post" ? fieldValue("zip") : "",
    "Wohnort": selectedRoute === "post" ? fieldValue("city") : "",
    "Land": selectedRoute === "post" ? fieldValue("country") : "",
    "Zustimmung": commitmentField.checked ? "Unverbindlich abonnieren und 3× jährlich erhalten" : "",
    "Datenschutz-Einwilligung": privacyConsentField.checked
      ? "Datenschutzerklärung gelesen und Verarbeitung gemäß DSGVO zugestimmt"
      : "",
    "Zeitstempel": timestamp.toISOString(),
    "Zeitstempel lokal": timestamp.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }),
  };
}

async function submitToWeb3Forms() {
  if (web3FormsAccessKey() === WEB3FORMS_ACCESS_KEY_PLACEHOLDER) {
    throw new Error("missing_access_key");
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  const response = await fetch(WEB3FORMS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(buildWeb3FormsPayload()),
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timeoutId));

  const result = await response.json().catch(() => null);

  if (!response.ok || !result?.success) {
    throw new Error("submission_failed");
  }

  return result;
}

document.querySelectorAll("[data-route]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedRoute = button.dataset.route;
    document.querySelectorAll("[data-route]").forEach((option) => {
      option.setAttribute("aria-pressed", String(option === button));
    });
    showStep(selectedRoute);
  });
});

document.querySelectorAll("[data-next]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!validateStep(currentStep)) {
      return;
    }

    showStep(button.dataset.next);
  });
});

document.querySelectorAll("[data-back]").forEach((button) => {
  button.addEventListener("click", () => {
    stepStack.pop();
    const previousStep = stepStack.at(-1) || "start";
    showStep(previousStep, false);
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSubmitting) {
    return;
  }

  if (form.elements.botcheck.checked) {
    showStep("success");
    return;
  }

  if (!validateFullSubmission()) {
    return;
  }

  if (!validateSubmitTiming()) {
    return;
  }

  try {
    isSubmitting = true;
    setSafeSessionValue(LAST_SUBMIT_STORAGE_KEY, String(Date.now()));
    setSubmitState(true);
    submitStatus.textContent = "Deine Anmeldung wird sicher übermittelt.";
    await submitToWeb3Forms();
    showStep("success");
  } catch (error) {
    const message =
      error.message === "missing_access_key"
        ? "Die Web3Forms-Konfiguration ist noch nicht vollständig. Bitte den Access Key eintragen."
        : "Die Anmeldung konnte gerade nicht gesendet werden. Bitte prüfe deine Verbindung und versuche es erneut.";

    setError(message);
  } finally {
    isSubmitting = false;
    setSubmitState(false);
  }
});

commitmentField.addEventListener("change", () => {
  setSubmitState(false);
});

privacyConsentField.addEventListener("change", () => {
  setSubmitState(false);
});

document.querySelector("[data-reset]").addEventListener("click", () => {
  form.reset();
  selectedRoute = "";
  stepStack = ["start"];
  setSubmitState(false);
  document.querySelectorAll("[data-route]").forEach((option) => {
    option.setAttribute("aria-pressed", "false");
  });
  showStep("start", false);
});

showStep("start", false);
