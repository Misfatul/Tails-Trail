function getApiBaseUrl() {
  const configuredUrl = window.TAILS_TRAIL_API_BASE_URL;
  if (configuredUrl) return configuredUrl.replace(/\/$/, "");
  const { hostname, origin, port, protocol } = window.location;
  const staticLocal = protocol === "file:" || origin === "null" || ((hostname === "localhost" || hostname === "127.0.0.1") && port && port !== "8080");
  return staticLocal ? "http://localhost:8080/api" : `${origin}/api`;
}

const API_BASE_URL = getApiBaseUrl();
const TOKEN_KEY = "tailtrails-token";
const REMEMBER_KEY = "tailtrails-remember";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "",
  remember: localStorage.getItem(REMEMBER_KEY) === "true",
  owner: null,
  pets: [],
  records: [],
  owners: [],
  selectedPetId: "",
  loading: false
};

const $ = (id) => document.getElementById(id);
const authView = $("authView");
const appView = $("appView");
const petGrid = $("petGrid");
const toast = $("toast");
const petDetailsModal = $("petDetailsModal");
const petDetailsContent = $("petDetailsContent");

$("rememberMe").checked = state.remember;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeoutId);
  showToast.timeoutId = setTimeout(() => toast.classList.remove("show"), 3200);
}

function setToken(token, remember) {
  state.token = token;
  state.remember = remember;
  localStorage.setItem(REMEMBER_KEY, String(remember));
  if (remember) {
    localStorage.setItem(TOKEN_KEY, token);
    sessionStorage.removeItem(TOKEN_KEY);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
  }
}

function clearToken() {
  state.token = "";
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch (_error) {
    throw new Error(`Cannot reach backend at ${API_BASE_URL}. Start start-app.cmd and open http://localhost:8080.`);
  }

  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401) {
      clearToken();
      showAuth("Please log in to continue.");
    }
    throw new Error(data?.message || "Request failed.");
  }
  return data;
}

function showAuth(message = "") {
  appView.classList.add("hidden");
  authView.classList.remove("hidden");
  $("loginMessage").textContent = message;
}

function showApp() {
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
}

function switchSection(sectionId) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.section === sectionId));
  document.querySelectorAll(".content-section").forEach((section) => section.classList.toggle("active", section.id === sectionId));
}

function setLoginLoading(loading) {
  $("loginBtn").disabled = loading;
  $("loginBtn").querySelector(".btn-label").textContent = loading ? "Signing in..." : "Log in";
  $("loginBtn").querySelector(".spinner").classList.toggle("hidden", !loading);
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : "Not set";
}

function toDateInput(value) {
  return value ? String(value).slice(0, 10) : "";
}

function getAge(birthDate) {
  if (!birthDate) return "Age unknown";
  const born = new Date(birthDate);
  const now = new Date();
  let years = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) years -= 1;
  if (years <= 0) return `${Math.max(1, monthDelta + 12 * (now.getFullYear() - born.getFullYear()))} months`;
  return `${years} year${years === 1 ? "" : "s"}`;
}

function dueStatus(days) {
  if (days === null || days === undefined) return { text: "No due date", cls: "" };
  if (days < 0) return { text: `${Math.abs(days)} days overdue`, cls: "danger" };
  if (days <= 30) return { text: `Due in ${days} days`, cls: "warning" };
  return { text: `Due in ${days} days`, cls: "" };
}

function avatar(pet) {
  const initials = encodeURIComponent((pet.pet_name || "P").slice(0, 2).toUpperCase());
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600'%3E%3Crect width='100%25' height='100%25' fill='%23dcebe8'/%3E%3Ccircle cx='400' cy='260' r='120' fill='%2324786f' opacity='.9'/%3E%3Ctext x='50%25' y='49%25' text-anchor='middle' dominant-baseline='middle' font-family='Arial' font-size='78' fill='white'%3E${initials}%3C/text%3E%3C/svg%3E`;
}

function recordForPet(petId) {
  return state.records.find((record) => String(record.pet.pet_id) === String(petId));
}

function visiblePets() {
  const q = $("petSearch").value.trim().toLowerCase();
  if (!q) return state.pets;
  return state.pets.filter((pet) => [pet.pet_name, pet.gender, pet.special_description].some((v) => String(v || "").toLowerCase().includes(q)));
}

function renderOwner() {
  $("ownerName").textContent = state.owner?.owner_name || "Owner";
  $("ownerEmail").textContent = state.owner?.email || "";
  $("profileName").value = state.owner?.owner_name || "";
  $("profileEmail").value = state.owner?.email || "";
  $("profilePhone").value = state.owner?.phone || "";
  $("profileAddress").value = state.owner?.address || "";
}

function renderStats() {
  let upcoming = 0;
  let overdue = 0;
  state.records.forEach((record) => {
    [record.summary.next_vaccine_due_in, record.summary.next_deworming_due_in].forEach((days) => {
      if (days === null || days === undefined) return;
      if (days < 0) overdue += 1;
      else if (days <= 30) upcoming += 1;
    });
  });
  $("totalPets").textContent = state.pets.length;
  $("upcomingCount").textContent = upcoming;
  $("overdueCount").textContent = overdue;
}

function renderOptions() {
  const petOptions = state.pets.map((pet) => `<option value="${pet.pet_id}">${escapeHtml(pet.pet_name)}</option>`).join("");
  ["recordPetId", "transferPetId"].forEach((id) => {
    $(id).innerHTML = petOptions || '<option value="">No pets</option>';
    if (state.selectedPetId) $(id).value = state.selectedPetId;
  });

  $("transferOwnerId").innerHTML = state.owners.map((owner) => `<option value="${owner.owner_id}">${escapeHtml(owner.owner_name)} (${escapeHtml(owner.email)})</option>`).join("") || '<option value="">No other owners</option>';
}

function renderPets() {
  $("loadingState").classList.toggle("hidden", !state.loading);
  $("emptyState").classList.toggle("hidden", state.loading || state.pets.length > 0);
  petGrid.classList.toggle("hidden", state.loading || state.pets.length === 0);
  const pets = visiblePets();
  petGrid.innerHTML = pets.map((pet) => {
    const record = recordForPet(pet.pet_id);
    const summary = record?.summary || {};
    const vaccine = summary.last_vaccination;
    const weight = summary.latest_weight;
    const vaccineStatus = dueStatus(summary.next_vaccine_due_in);
    return `
      <article class="pet-card" data-pet-id="${pet.pet_id}" tabindex="0">
        <img src="${avatar(pet)}" alt="${escapeHtml(pet.pet_name)} avatar">
        <div class="pet-card-body">
          <div>
            <h3>${escapeHtml(pet.pet_name)}</h3>
            <p class="muted">${escapeHtml(pet.special_description || "No description saved.")}</p>
          </div>
          <div class="pet-meta">
            <span>${escapeHtml(pet.gender)}</span>
            <span>${escapeHtml(getAge(pet.birth_date))}</span>
            <span>${pet.is_spayed_neutered ? "Neutered/spayed" : "Not neutered/spayed"}</span>
            <span class="status-chip ${vaccineStatus.cls}">${escapeHtml(summary.health_status || "No active issues")}</span>
          </div>
          <p class="muted">Last vaccine: ${vaccine ? `${escapeHtml(vaccine.vaccine_name)} (${formatDate(vaccine.vaccination_date)})` : "None"}</p>
          <p class="muted">Latest weight: ${weight ? `${escapeHtml(weight.weight_kg)} kg on ${formatDate(weight.record_date)}` : "None"}</p>
          <div class="card-actions">
            <button class="secondary-btn" type="button" data-action="edit-pet" data-id="${pet.pet_id}">Edit</button>
            <button class="secondary-btn" type="button" data-action="delete-pet" data-id="${pet.pet_id}">Delete</button>
            <button class="primary-btn" type="button" data-action="details" data-id="${pet.pet_id}">Details</button>
          </div>
        </div>
      </article>`;
  }).join("") || (state.pets.length ? '<div class="empty-state"><h3>No matching pets</h3></div>' : "");
}

function renderAll() {
  renderOwner();
  renderStats();
  renderOptions();
  renderPets();
}

async function loadDashboard() {
  state.loading = true;
  renderPets();
  try {
    const data = await apiFetch("/dashboard");
    state.owner = data.owner;
    state.pets = data.pets || [];
    state.records = data.records || [];
    state.owners = data.allOwners || [];
    state.selectedPetId = state.selectedPetId || String(state.pets[0]?.pet_id || "");
    showApp();
    renderAll();
  } finally {
    state.loading = false;
    renderPets();
  }
}

function clearPetForm() {
  $("petForm").reset();
  $("petId").value = "";
  $("petFormTitle").textContent = "Add pet";
}

function fillPetForm(pet) {
  $("petId").value = pet.pet_id;
  $("petName").value = pet.pet_name || "";
  $("petBirthDate").value = toDateInput(pet.birth_date);
  $("petGender").value = pet.gender || "";
  $("petNeutered").checked = Boolean(pet.is_spayed_neutered);
  $("petDescription").value = pet.special_description || "";
  $("petFormTitle").textContent = `Edit ${pet.pet_name}`;
  switchSection("petFormSection");
}

function petPayload() {
  return {
    pet_name: $("petName").value.trim(),
    birth_date: $("petBirthDate").value || null,
    gender: $("petGender").value,
    is_spayed_neutered: $("petNeutered").checked,
    special_description: $("petDescription").value.trim()
  };
}

function listRecords(items, type) {
  if (!items.length) return "<p class='muted'>No records yet.</p>";
  return `<div class="record-list">${items.map((item) => `
    <article class="timeline-box">
      <div>${recordSummary(item, type)}</div>
      <div class="card-actions">
        <button class="secondary-btn" type="button" data-edit-record="${type}" data-record-id="${recordId(item, type)}">Edit</button>
        <button class="secondary-btn" type="button" data-delete-record="${type}" data-record-id="${recordId(item, type)}">Delete</button>
      </div>
    </article>
  `).join("")}</div>`;
}

function recordId(item, type) {
  return {
    medical: item.record_id,
    vaccinations: item.vaccination_id,
    deworming: item.deworming_id,
    care: item.care_id,
    weights: item.weight_id
  }[type];
}

function recordSummary(item, type) {
  if (type === "medical") {
    return `<h4>${formatDate(item.visit_date)}: ${escapeHtml(item.diagnosis || "Medical visit")}</h4><p>${escapeHtml(item.meds_used || "No medicine")} | ${escapeHtml(item.cure || "No treatment note")}</p><p>Allergy: ${escapeHtml(item.allergy_trigger || "None")}</p>${item.prescription_image_path ? `<a href="${escapeHtml(item.prescription_image_path)}" target="_blank">View prescription</a>` : ""}`;
  }
  if (type === "vaccinations") {
    const status = dueStatus(item.next_due_date ? Math.ceil((new Date(item.next_due_date) - new Date()) / 86400000) : null);
    return `<h4>${escapeHtml(item.vaccine_name)}</h4><p>${formatDate(item.vaccination_date)} | Next: ${formatDate(item.next_due_date)} | <span class="status-chip ${status.cls}">${escapeHtml(status.text)}</span></p>`;
  }
  if (type === "deworming") {
    const status = dueStatus(item.next_due_date ? Math.ceil((new Date(item.next_due_date) - new Date()) / 86400000) : null);
    return `<h4>${escapeHtml(item.medicine_name || "Deworming")}</h4><p>${formatDate(item.deworming_date)} | Next: ${formatDate(item.next_due_date)} | <span class="status-chip ${status.cls}">${escapeHtml(status.text)}</span></p>`;
  }
  if (type === "care") return `<h4>${escapeHtml(item.care_type)}</h4><p>${formatDate(item.care_date)} | ${escapeHtml(item.notes || "No notes")}</p>`;
  return `<h4>${escapeHtml(item.weight_kg)} kg</h4><p>${formatDate(item.record_date)}</p>`;
}

function weightChart(weights) {
  if (!weights.length) return "<p class='muted'>No weight entries yet.</p>";
  const chronological = [...weights].reverse();
  const max = Math.max(...chronological.map((item) => Number(item.weight_kg)), 1);
  return `<div class="weight-chart">${chronological.map((item) => `<span title="${formatDate(item.record_date)}: ${item.weight_kg} kg" style="height:${Math.max(12, Number(item.weight_kg) / max * 120)}px"></span>`).join("")}</div>`;
}

async function openDetails(petId) {
  const record = await apiFetch(`/pets/${petId}/full-record`);
  state.selectedPetId = String(petId);
  const pet = record.pet;
  petDetailsContent.innerHTML = `
    <section class="details-hero">
      <img src="${avatar(pet)}" alt="${escapeHtml(pet.pet_name)} avatar">
      <div class="details-content">
        <div>
          <p class="eyebrow">Pet profile</p>
          <h2>${escapeHtml(pet.pet_name)}</h2>
          <p class="muted">${escapeHtml(pet.gender)} | ${escapeHtml(getAge(pet.birth_date))} | ${pet.is_spayed_neutered ? "Spayed/neutered" : "Not spayed/neutered"}</p>
          <p>${escapeHtml(pet.special_description || "No special description saved.")}</p>
        </div>
        <div class="detail-grid">
          <article class="detail-box"><h4>Health summary</h4><p>${escapeHtml(record.summary.health_status)}</p></article>
          <article class="detail-box"><h4>Last vaccination</h4><p>${record.summary.last_vaccination ? `${escapeHtml(record.summary.last_vaccination.vaccine_name)} on ${formatDate(record.summary.last_vaccination.vaccination_date)}` : "None"}</p></article>
          <article class="detail-box"><h4>Latest weight</h4><p>${record.summary.latest_weight ? `${escapeHtml(record.summary.latest_weight.weight_kg)} kg` : "None"}</p></article>
          <article class="detail-box"><h4>Adoption owner</h4><p>${escapeHtml(pet.owner_name)}</p></article>
        </div>
      </div>
    </section>
    <section class="details-content" style="padding:0 28px 28px;">
      <div class="timeline-grid">
        <article class="timeline-box"><h4>Weight progress</h4>${weightChart(record.weight_records)}</article>
        <article class="timeline-box"><h4>Ownership timeline</h4>${listTransfers(record.transfer_records)}</article>
      </div>
      <h3>Medical history</h3>${listRecords(record.medical_records, "medical")}
      <h3>Vaccination timeline</h3>${listRecords(record.vaccination_records, "vaccinations")}
      <h3>Deworming timeline</h3>${listRecords(record.deworming_records, "deworming")}
      <h3>Care activity</h3>${listRecords(record.care_records, "care")}
      <h3>Weight history</h3>${listRecords(record.weight_records, "weights")}
    </section>`;
  petDetailsModal.showModal();
}

function listTransfers(items) {
  if (!items.length) return "<p class='muted'>No transfers yet.</p>";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item.old_owner_name)} to ${escapeHtml(item.new_owner_name)} on ${formatDate(item.transfer_date)}${item.notes ? `: ${escapeHtml(item.notes)}` : ""}</li>`).join("")}</ul>`;
}

async function uploadPrescriptionIfNeeded() {
  const file = $("medicalPrescriptionFile").files[0];
  if (!file) return $("medicalPrescriptionPath").value || null;
  const form = new FormData();
  form.append("prescription", file);
  const data = await apiFetch("/uploads/prescription", { method: "POST", body: form });
  return data.path;
}

function selectedPetId() {
  const value = Number($("recordPetId").value);
  if (!value) throw new Error("Select a pet first.");
  return value;
}

function activeRecordEndpoint(type) {
  return { medical: "medical", vaccinations: "vaccinations", deworming: "deworming", care: "care", weights: "weights" }[type];
}

async function saveRecord(type, id, payload) {
  const endpoint = activeRecordEndpoint(type);
  const path = id ? `/${endpoint}/${id}` : `/${endpoint}`;
  await apiFetch(path, { method: id ? "PUT" : "POST", body: JSON.stringify(id ? payload : { pet_id: selectedPetId(), ...payload }) });
  await loadDashboard();
  showToast("Record saved.");
}

function clearRecordForms() {
  document.querySelectorAll(".record-form").forEach((form) => form.reset());
  ["medicalId", "vaccinationId", "dewormingId", "careId", "weightId", "medicalPrescriptionPath"].forEach((id) => { $(id).value = ""; });
}

function editRecord(type, id) {
  const record = recordForPet(state.selectedPetId);
  const collections = { medical: record.medical_records, vaccinations: record.vaccination_records, deworming: record.deworming_records, care: record.care_records, weights: record.weight_records };
  const item = collections[type].find((entry) => String(recordId(entry, type)) === String(id));
  if (!item) return;
  document.querySelector(`[data-record-form="${type === "vaccinations" ? "vaccinationForm" : type === "deworming" ? "dewormingForm" : type === "weights" ? "weightForm" : `${type}Form` }"]`)?.click();
  switchSection("recordsSection");
  $("recordPetId").value = state.selectedPetId;
  if (type === "medical") {
    $("medicalId").value = item.record_id; $("medicalVisitDate").value = toDateInput(item.visit_date); $("medicalDiagnosis").value = item.diagnosis || ""; $("medicalMeds").value = item.meds_used || ""; $("medicalCure").value = item.cure || ""; $("medicalAllergy").value = item.allergy_trigger || ""; $("medicalHistory").value = item.medical_history || ""; $("medicalPrescriptionText").value = item.prescription_text || ""; $("medicalPrescriptionPath").value = item.prescription_image_path || "";
  } else if (type === "vaccinations") {
    $("vaccinationId").value = item.vaccination_id; $("vaccineName").value = item.vaccine_name || ""; $("vaccinationDate").value = toDateInput(item.vaccination_date); $("vaccinationNextDue").value = toDateInput(item.next_due_date);
  } else if (type === "deworming") {
    $("dewormingId").value = item.deworming_id; $("dewormingMedicine").value = item.medicine_name || ""; $("dewormingDate").value = toDateInput(item.deworming_date); $("dewormingNextDue").value = toDateInput(item.next_due_date);
  } else if (type === "care") {
    $("careId").value = item.care_id; $("careType").value = item.care_type || ""; $("careDate").value = toDateInput(item.care_date); $("careNotes").value = item.notes || "";
  } else {
    $("weightId").value = item.weight_id; $("weightKg").value = item.weight_kg || ""; $("weightDate").value = toDateInput(item.record_date);
  }
  petDetailsModal.close();
}

async function deleteRecord(type, id) {
  if (!confirm("Delete this record?")) return;
  await apiFetch(`/${activeRecordEndpoint(type)}/${id}`, { method: "DELETE" });
  await loadDashboard();
  petDetailsModal.close();
  showToast("Record deleted.");
}

document.querySelectorAll("[data-auth-tab]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".auth-form").forEach((form) => form.classList.toggle("active", form.id === tab.dataset.authTab));
  });
});

document.querySelectorAll(".nav-item").forEach((item) => item.addEventListener("click", () => switchSection(item.dataset.section)));
document.querySelectorAll(".record-tab[data-record-form]").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".record-tab[data-record-form]").forEach((item) => item.classList.toggle("active", item === tab));
    document.querySelectorAll(".record-form").forEach((form) => form.classList.toggle("active", form.id === tab.dataset.recordForm));
  });
});

$("togglePasswordBtn").addEventListener("click", () => {
  const show = $("loginPassword").type === "password";
  $("loginPassword").type = show ? "text" : "password";
  $("togglePasswordBtn").textContent = show ? "Hide" : "Show";
});

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginMessage").textContent = "";
  if (!$("loginEmail").value.trim() || !$("loginPassword").value) {
    $("loginMessage").textContent = "Email and password are required.";
    return;
  }
  setLoginLoading(true);
  try {
    const data = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email: $("loginEmail").value.trim(), password: $("loginPassword").value }) });
    setToken(data.token, $("rememberMe").checked);
    await loadDashboard();
    showToast(`Welcome back, ${data.owner.owner_name}.`);
  } catch (error) {
    $("loginMessage").textContent = error.message;
  } finally {
    setLoginLoading(false);
  }
});

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("registerMessage").textContent = "";
  try {
    const data = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ owner_name: $("registerName").value.trim(), email: $("registerEmail").value.trim(), password: $("registerPassword").value, phone: $("registerPhone").value.trim(), address: $("registerAddress").value.trim() })
    });
    setToken(data.token, true);
    await loadDashboard();
  } catch (error) {
    $("registerMessage").textContent = error.message;
  }
});

$("seedFromLoginBtn").addEventListener("click", async () => {
  try {
    const data = await apiFetch("/seed", { method: "POST" });
    showToast(data.message);
  } catch (error) {
    $("loginMessage").textContent = error.message;
  }
});

$("logoutBtn").addEventListener("click", () => { clearToken(); showAuth("You have been logged out."); });
$("refreshBtn").addEventListener("click", () => loadDashboard().then(() => showToast("Dashboard refreshed.")).catch((e) => showToast(e.message)));
$("newPetBtn").addEventListener("click", () => { clearPetForm(); switchSection("petFormSection"); });
$("emptyAddPetBtn").addEventListener("click", () => { clearPetForm(); switchSection("petFormSection"); });
$("resetPetFormBtn").addEventListener("click", clearPetForm);
$("petSearch").addEventListener("input", renderPets);
$("closeDetailsBtn").addEventListener("click", () => petDetailsModal.close());

petGrid.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const card = event.target.closest(".pet-card");
  const id = button?.dataset.id || card?.dataset.petId;
  if (!id) return;
  const pet = state.pets.find((item) => String(item.pet_id) === String(id));
  try {
    if (button?.dataset.action === "edit-pet") return fillPetForm(pet);
    if (button?.dataset.action === "delete-pet") {
      if (!confirm(`Delete ${pet.pet_name}?`)) return;
      await apiFetch(`/pets/${id}`, { method: "DELETE" });
      await loadDashboard();
      return showToast("Pet deleted.");
    }
    await openDetails(id);
  } catch (error) {
    showToast(error.message);
  }
});

petDetailsContent.addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-record]");
  const del = event.target.closest("[data-delete-record]");
  try {
    if (edit) editRecord(edit.dataset.editRecord, edit.dataset.recordId);
    if (del) await deleteRecord(del.dataset.deleteRecord, del.dataset.recordId);
  } catch (error) {
    showToast(error.message);
  }
});

$("petForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = petPayload();
  if (!payload.pet_name || !payload.gender) return showToast("Pet name and gender are required.");
  try {
    const id = $("petId").value;
    await apiFetch(id ? `/pets/${id}` : "/pets", { method: id ? "PUT" : "POST", body: JSON.stringify(payload) });
    clearPetForm();
    await loadDashboard();
    switchSection("dashboardSection");
    showToast("Pet saved.");
  } catch (error) {
    showToast(error.message);
  }
});

$("medicalForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await saveRecord("medical", $("medicalId").value, { visit_date: $("medicalVisitDate").value, diagnosis: $("medicalDiagnosis").value.trim(), meds_used: $("medicalMeds").value.trim(), cure: $("medicalCure").value.trim(), allergy_trigger: $("medicalAllergy").value.trim(), medical_history: $("medicalHistory").value.trim(), prescription_text: $("medicalPrescriptionText").value.trim(), prescription_image_path: await uploadPrescriptionIfNeeded() });
    clearRecordForms();
  } catch (error) { showToast(error.message); }
});
$("vaccinationForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await saveRecord("vaccinations", $("vaccinationId").value, { vaccine_name: $("vaccineName").value.trim(), vaccination_date: $("vaccinationDate").value, next_due_date: $("vaccinationNextDue").value || null }); clearRecordForms(); }
  catch (error) { showToast(error.message); }
});
$("dewormingForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await saveRecord("deworming", $("dewormingId").value, { medicine_name: $("dewormingMedicine").value.trim(), deworming_date: $("dewormingDate").value, next_due_date: $("dewormingNextDue").value || null }); clearRecordForms(); }
  catch (error) { showToast(error.message); }
});
$("careForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await saveRecord("care", $("careId").value, { care_type: $("careType").value.trim(), care_date: $("careDate").value, notes: $("careNotes").value.trim() }); clearRecordForms(); }
  catch (error) { showToast(error.message); }
});
$("weightForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await saveRecord("weights", $("weightId").value, { weight_kg: Number($("weightKg").value), record_date: $("weightDate").value }); clearRecordForms(); }
  catch (error) { showToast(error.message); }
});

$("transferForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await apiFetch("/transfers", { method: "POST", body: JSON.stringify({ pet_id: Number($("transferPetId").value), new_owner_id: Number($("transferOwnerId").value), transfer_date: $("transferDate").value || null, notes: $("transferNotes").value.trim() }) });
    $("transferForm").reset();
    state.selectedPetId = "";
    await loadDashboard();
    switchSection("dashboardSection");
    showToast("Pet transferred. The database trigger updated ownership.");
  } catch (error) { showToast(error.message); }
});

$("profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await apiFetch("/profile", { method: "PUT", body: JSON.stringify({ owner_name: $("profileName").value.trim(), email: $("profileEmail").value.trim(), phone: $("profilePhone").value.trim(), address: $("profileAddress").value.trim() }) });
    state.owner = data.owner;
    setToken(data.token, state.remember);
    renderOwner();
    showToast("Profile updated.");
  } catch (error) { showToast(error.message); }
});
$("passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await apiFetch("/profile/password", { method: "PUT", body: JSON.stringify({ current_password: $("currentPassword").value, new_password: $("newPassword").value }) });
    $("passwordForm").reset();
    showToast(data.message);
  } catch (error) { showToast(error.message); }
});

async function boot() {
  if (!state.token) return showAuth();
  try {
    await apiFetch("/auth/me");
    await loadDashboard();
  } catch (_error) {
    clearToken();
    showAuth("Please log in to continue.");
  }
}

boot();
