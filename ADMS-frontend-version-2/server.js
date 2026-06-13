const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const express = require("express");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const pool = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 8080);
const JWT_SECRET = process.env.JWT_SECRET || "tails-trail-local-dev-secret-change-me";
const TOKEN_EXPIRES_IN = "12h";
const uploadDir = path.join(__dirname, "uploads", "prescriptions");
const DB_STARTUP_RETRIES = Number(process.env.DB_STARTUP_RETRIES || 30);
const DB_STARTUP_DELAY_MS = Number(process.env.DB_STARTUP_DELAY_MS || 1000);

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image prescriptions can be uploaded."));
    }
    cb(null, true);
  }
});

app.use(cors({ origin: true, credentials: true, allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(__dirname));

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeOwner(owner) {
  return {
    owner_id: owner.owner_id,
    owner_name: owner.owner_name,
    email: owner.email,
    phone: owner.phone,
    address: owner.address
  };
}

function createToken(owner) {
  return jwt.sign({ owner_id: owner.owner_id, email: owner.email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

function isBcryptHash(value = "") {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

async function verifyPassword(owner, password) {
  if (isBcryptHash(owner.password)) {
    return bcrypt.compare(password, owner.password);
  }

  const matchesLegacyPassword = owner.password === password;
  if (matchesLegacyPassword) {
    await query("UPDATE owners SET password = ? WHERE owner_id = ?", [await bcrypt.hash(password, 12), owner.owner_id]);
  }
  return matchesLegacyPassword;
}

function getBearerToken(req) {
  const [scheme, token] = (req.get("authorization") || "").split(" ");
  return scheme?.toLowerCase() === "bearer" ? token : null;
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const owners = await query(`
      SELECT owner_id, owner_name, email, phone, address
      FROM owners
      WHERE owner_id = ?
      LIMIT 1
    `, [payload.owner_id]);

    if (!owners.length) {
      return res.status(401).json({ message: "Session owner no longer exists." });
    }

    req.owner = owners[0];
    next();
  } catch (_error) {
    res.status(401).json({ message: "Your session expired. Please log in again." });
  }
}

async function ownsPet(ownerId, petId) {
  const pets = await query("SELECT pet_id FROM pets WHERE pet_id = ? AND owner_id = ? LIMIT 1", [petId, ownerId]);
  return pets.length > 0;
}

async function requireOwnedPet(req, res, next) {
  const petId = req.params.petId || req.params.id || req.body.pet_id;
  if (!petId) {
    return res.status(400).json({ message: "Pet is required." });
  }
  if (!(await ownsPet(req.owner.owner_id, petId))) {
    return res.status(403).json({ message: "You can only access pets owned by this account." });
  }
  next();
}

const recordConfig = {
  medical: {
    table: "medical_records",
    id: "record_id",
    fields: ["pet_id", "visit_date", "diagnosis", "meds_used", "cure", "allergy_trigger", "medical_history", "prescription_text", "prescription_image_path"],
    order: "visit_date DESC, record_id DESC"
  },
  vaccinations: {
    table: "vaccination_records",
    id: "vaccination_id",
    fields: ["pet_id", "vaccine_name", "vaccination_date", "next_due_date"],
    order: "vaccination_date DESC, vaccination_id DESC"
  },
  deworming: {
    table: "deworming_records",
    id: "deworming_id",
    fields: ["pet_id", "medicine_name", "deworming_date", "next_due_date"],
    order: "deworming_date DESC, deworming_id DESC"
  },
  care: {
    table: "care_records",
    id: "care_id",
    fields: ["pet_id", "care_type", "care_date", "notes"],
    order: "care_date DESC, care_id DESC"
  },
  weights: {
    table: "weight_records",
    id: "weight_id",
    fields: ["pet_id", "weight_kg", "record_date"],
    order: "record_date DESC, weight_id DESC"
  }
};

async function getRecordById(config, id, ownerId) {
  const rows = await query(`
    SELECT r.*
    FROM ${config.table} r
    JOIN pets p ON p.pet_id = r.pet_id
    WHERE r.${config.id} = ? AND p.owner_id = ?
    LIMIT 1
  `, [id, ownerId]);
  return rows[0];
}

function sanitizePayload(fields, body) {
  const payload = {};
  fields.forEach((field) => {
    if (field in body) {
      payload[field] = body[field] === "" ? null : body[field];
    }
  });
  return payload;
}

function daysUntil(value) {
  if (!value) {
    return null;
  }
  const due = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due - today) / 86400000);
}

function summarizeHealth(record) {
  const latestMedical = record.medical_records[0];
  const nextVaccine = record.vaccination_records.find((item) => item.next_due_date);
  const nextDeworming = record.deworming_records.find((item) => item.next_due_date);
  const alerts = [];

  [nextVaccine, nextDeworming].forEach((item) => {
    const left = daysUntil(item?.next_due_date);
    if (left !== null && left < 0) {
      alerts.push("Overdue");
    } else if (left !== null && left <= 30) {
      alerts.push("Due soon");
    }
  });

  return alerts[0] || latestMedical?.diagnosis || "No active issues";
}

async function getPetFullRecord(petId, ownerId = null) {
  const params = ownerId ? [petId, ownerId] : [petId];
  const pets = await query(`
    SELECT p.*, o.owner_name
    FROM pets p
    JOIN owners o ON o.owner_id = p.owner_id
    WHERE p.pet_id = ? ${ownerId ? "AND p.owner_id = ?" : ""}
  `, params);

  if (!pets.length) {
    return null;
  }

  const [medical_records, vaccination_records, deworming_records, care_records, weight_records, transfer_records] = await Promise.all([
    query("SELECT * FROM medical_records WHERE pet_id = ? ORDER BY visit_date DESC, record_id DESC", [petId]),
    query("SELECT * FROM vaccination_records WHERE pet_id = ? ORDER BY vaccination_date DESC, vaccination_id DESC", [petId]),
    query("SELECT * FROM deworming_records WHERE pet_id = ? ORDER BY deworming_date DESC, deworming_id DESC", [petId]),
    query("SELECT * FROM care_records WHERE pet_id = ? ORDER BY care_date DESC, care_id DESC", [petId]),
    query("SELECT * FROM weight_records WHERE pet_id = ? ORDER BY record_date DESC, weight_id DESC", [petId]),
    query(`
      SELECT ptr.*, old_owner.owner_name AS old_owner_name, new_owner.owner_name AS new_owner_name
      FROM pet_transfer_records ptr
      JOIN owners old_owner ON old_owner.owner_id = ptr.old_owner_id
      JOIN owners new_owner ON new_owner.owner_id = ptr.new_owner_id
      WHERE ptr.pet_id = ?
      ORDER BY ptr.transfer_date DESC, ptr.transfer_id DESC
    `, [petId])
  ]);

  const record = { pet: pets[0], medical_records, vaccination_records, deworming_records, care_records, weight_records, transfer_records };
  record.summary = {
    health_status: summarizeHealth(record),
    last_vaccination: vaccination_records[0] || null,
    latest_weight: weight_records[0] || null,
    next_vaccine_due_in: daysUntil(vaccination_records.find((item) => item.next_due_date)?.next_due_date),
    next_deworming_due_in: daysUntil(deworming_records.find((item) => item.next_due_date)?.next_due_date)
  };
  return record;
}

async function getOwnerPets(ownerId) {
  const pets = await query(`
    SELECT p.*, o.owner_name
    FROM pets p
    JOIN owners o ON o.owner_id = p.owner_id
    WHERE p.owner_id = ?
    ORDER BY p.pet_id DESC
  `, [ownerId]);
  const records = await Promise.all(pets.map((pet) => getPetFullRecord(pet.pet_id, ownerId)));
  return { pets, records };
}

async function insertOwner({ owner_name, email, password, phone, address }) {
  const result = await query(`
    INSERT INTO owners (owner_name, email, password, phone, address)
    VALUES (?, ?, ?, ?, ?)
  `, [owner_name, email, await bcrypt.hash(password, 12), phone || null, address || null]);
  const owners = await query("SELECT owner_id, owner_name, email, phone, address FROM owners WHERE owner_id = ?", [result.insertId]);
  return owners[0];
}

async function ensureSampleData() {
  let inserted = false;
  let owner = (await query("SELECT owner_id, owner_name, email, phone, address FROM owners WHERE email = ? LIMIT 1", ["misfa@gmail.com"]))[0];
  if (!owner) {
    owner = await insertOwner({
      owner_name: "Misfatul Jannat",
      email: "misfa@gmail.com",
      password: "12345",
      phone: "01800000000",
      address: "Chittagong"
    });
    inserted = true;
  }

  let secondOwner = (await query("SELECT owner_id, owner_name, email, phone, address FROM owners WHERE email = ? LIMIT 1", ["ariana@gmail.com"]))[0];
  if (!secondOwner) {
    secondOwner = await insertOwner({
      owner_name: "Ariana Rahman",
      email: "ariana@gmail.com",
      password: "12345",
      phone: "01900000000",
      address: "Dhaka"
    });
    inserted = true;
  }

  const petCount = await query("SELECT COUNT(*) AS total FROM pets WHERE owner_id = ?", [owner.owner_id]);
  if (petCount[0].total > 0) {
    return inserted;
  }

  const buddy = await query(`
    INSERT INTO pets (owner_id, pet_name, birth_date, gender, is_spayed_neutered, special_description)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [owner.owner_id, "Buddy", "2022-06-15", "Male", true, "Friendly, playful, and allergic to dust."]);
  const luna = await query(`
    INSERT INTO pets (owner_id, pet_name, birth_date, gender, is_spayed_neutered, special_description)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [owner.owner_id, "Luna", "2023-03-20", "Female", false, "Calm indoor cat who loves quiet corners."]);

  await query(`
    INSERT INTO medical_records (pet_id, visit_date, diagnosis, meds_used, cure, allergy_trigger, medical_history, prescription_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [buddy.insertId, "2026-01-10", "Skin irritation", "Antihistamine", "7-day ointment treatment", "Dust", "No previous major illness", "Apply ointment twice daily"]);
  await query("INSERT INTO vaccination_records (pet_id, vaccine_name, vaccination_date, next_due_date) VALUES (?, ?, ?, ?)", [buddy.insertId, "Rabies", "2026-02-01", "2027-02-01"]);
  await query("INSERT INTO deworming_records (pet_id, medicine_name, deworming_date, next_due_date) VALUES (?, ?, ?, ?)", [buddy.insertId, "Drontal", "2026-03-01", "2026-09-01"]);
  await query("INSERT INTO weight_records (pet_id, weight_kg, record_date) VALUES (?, ?, ?)", [buddy.insertId, 24.5, "2026-03-01"]);
  await query("INSERT INTO care_records (pet_id, care_type, care_date, notes) VALUES (?, ?, ?, ?)", [buddy.insertId, "Bath", "2026-03-05", "Used medicated shampoo"]);
  await query("INSERT INTO vaccination_records (pet_id, vaccine_name, vaccination_date, next_due_date) VALUES (?, ?, ?, ?)", [luna.insertId, "FVRCP", "2026-04-15", "2027-04-15"]);
  return true;
}

async function waitForDatabase() {
  let lastError = null;
  for (let attempt = 1; attempt <= DB_STARTUP_RETRIES; attempt += 1) {
    try {
      await query("SELECT 1 AS ok");
      if (attempt > 1) {
        console.log(`Database became ready on attempt ${attempt}.`);
      }
      return;
    } catch (error) {
      lastError = error;
      console.log(`Waiting for database (${attempt}/${DB_STARTUP_RETRIES})...`);
      await sleep(DB_STARTUP_DELAY_MS);
    }
  }
  throw lastError;
}

app.get("/api/health", asyncHandler(async (_req, res) => {
  await query("SELECT 1 AS ok");
  res.json({ ok: true, database: "connected" });
}));

app.post("/api/auth/register", asyncHandler(async (req, res) => {
  const { owner_name, email, password, phone, address } = req.body;
  if (!owner_name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ message: "Name, email, and password are required." });
  }
  if (password.length < 5) {
    return res.status(400).json({ message: "Password must be at least 5 characters." });
  }

  const owner = await insertOwner({
    owner_name: owner_name.trim(),
    email: email.trim().toLowerCase(),
    password,
    phone: phone?.trim(),
    address: address?.trim()
  });
  res.status(201).json({ token: createToken(owner), owner: normalizeOwner(owner) });
}));

app.post(["/api/auth/login", "/api/login"], asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const login = (email || "").trim().toLowerCase();
  if (!login || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  const owners = await query("SELECT * FROM owners WHERE LOWER(email) = ? LIMIT 1", [login]);
  if (!owners.length || !(await verifyPassword(owners[0], password))) {
    return res.status(401).json({ message: "Invalid email or password." });
  }

  const owner = normalizeOwner(owners[0]);
  res.json({ token: createToken(owner), owner });
}));

app.get("/api/auth/me", requireAuth, asyncHandler(async (req, res) => {
  res.json({ owner: normalizeOwner(req.owner) });
}));

app.put("/api/profile", requireAuth, asyncHandler(async (req, res) => {
  const { owner_name, email, phone, address } = req.body;
  if (!owner_name?.trim() || !email?.trim()) {
    return res.status(400).json({ message: "Name and email are required." });
  }

  await query(`
    UPDATE owners
    SET owner_name = ?, email = ?, phone = ?, address = ?
    WHERE owner_id = ?
  `, [owner_name.trim(), email.trim().toLowerCase(), phone?.trim() || null, address?.trim() || null, req.owner.owner_id]);
  const owners = await query("SELECT owner_id, owner_name, email, phone, address FROM owners WHERE owner_id = ?", [req.owner.owner_id]);
  res.json({ owner: normalizeOwner(owners[0]), token: createToken(owners[0]) });
}));

app.put("/api/profile/password", requireAuth, asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password || new_password.length < 5) {
    return res.status(400).json({ message: "Current password and a 5+ character new password are required." });
  }
  const owners = await query("SELECT * FROM owners WHERE owner_id = ?", [req.owner.owner_id]);
  if (!(await verifyPassword(owners[0], current_password))) {
    return res.status(401).json({ message: "Current password is incorrect." });
  }
  await query("UPDATE owners SET password = ? WHERE owner_id = ?", [await bcrypt.hash(new_password, 12), req.owner.owner_id]);
  res.json({ message: "Password updated successfully." });
}));

app.get("/api/dashboard", requireAuth, asyncHandler(async (req, res) => {
  const { pets, records } = await getOwnerPets(req.owner.owner_id);
  const allOwners = await query("SELECT owner_id, owner_name, email FROM owners WHERE owner_id <> ? ORDER BY owner_name", [req.owner.owner_id]);
  res.json({ owner: normalizeOwner(req.owner), pets, records, allOwners });
}));

app.get("/api/owners", requireAuth, asyncHandler(async (req, res) => {
  const owners = await query("SELECT owner_id, owner_name, email, phone, address FROM owners WHERE owner_id <> ? ORDER BY owner_name", [req.owner.owner_id]);
  res.json(owners);
}));

app.get("/api/pets", requireAuth, asyncHandler(async (req, res) => {
  const { pets } = await getOwnerPets(req.owner.owner_id);
  res.json(pets);
}));

app.post("/api/pets", requireAuth, asyncHandler(async (req, res) => {
  const { pet_name, birth_date, gender, is_spayed_neutered, special_description } = req.body;
  if (!pet_name?.trim() || !gender) {
    return res.status(400).json({ message: "Pet name and gender are required." });
  }
  const result = await query(`
    INSERT INTO pets (owner_id, pet_name, birth_date, gender, is_spayed_neutered, special_description)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [req.owner.owner_id, pet_name.trim(), birth_date || null, gender, Boolean(is_spayed_neutered), special_description?.trim() || null]);
  res.status(201).json(await getPetFullRecord(result.insertId, req.owner.owner_id));
}));

app.put("/api/pets/:id", requireAuth, requireOwnedPet, asyncHandler(async (req, res) => {
  const { pet_name, birth_date, gender, is_spayed_neutered, special_description } = req.body;
  if (!pet_name?.trim() || !gender) {
    return res.status(400).json({ message: "Pet name and gender are required." });
  }
  await query(`
    UPDATE pets
    SET pet_name = ?, birth_date = ?, gender = ?, is_spayed_neutered = ?, special_description = ?
    WHERE pet_id = ? AND owner_id = ?
  `, [pet_name.trim(), birth_date || null, gender, Boolean(is_spayed_neutered), special_description?.trim() || null, req.params.id, req.owner.owner_id]);
  res.json(await getPetFullRecord(req.params.id, req.owner.owner_id));
}));

app.delete("/api/pets/:id", requireAuth, requireOwnedPet, asyncHandler(async (req, res) => {
  await query("DELETE FROM pet_transfer_records WHERE pet_id = ?", [req.params.id]);
  await query("DELETE FROM medical_records WHERE pet_id = ?", [req.params.id]);
  await query("DELETE FROM vaccination_records WHERE pet_id = ?", [req.params.id]);
  await query("DELETE FROM deworming_records WHERE pet_id = ?", [req.params.id]);
  await query("DELETE FROM care_records WHERE pet_id = ?", [req.params.id]);
  await query("DELETE FROM weight_records WHERE pet_id = ?", [req.params.id]);
  await query("DELETE FROM pets WHERE pet_id = ? AND owner_id = ?", [req.params.id, req.owner.owner_id]);
  res.json({ message: "Pet deleted successfully." });
}));

app.get("/api/pets/:id/full-record", requireAuth, requireOwnedPet, asyncHandler(async (req, res) => {
  const record = await getPetFullRecord(req.params.id, req.owner.owner_id);
  if (!record) {
    return res.status(404).json({ message: "Pet not found." });
  }
  res.json(record);
}));

Object.entries(recordConfig).forEach(([name, config]) => {
  app.get(`/api/pets/:petId/${name}`, requireAuth, requireOwnedPet, asyncHandler(async (req, res) => {
    res.json(await query(`SELECT * FROM ${config.table} WHERE pet_id = ? ORDER BY ${config.order}`, [req.params.petId]));
  }));

  app.post(`/api/${name}`, requireAuth, requireOwnedPet, asyncHandler(async (req, res) => {
    const payload = sanitizePayload(config.fields, req.body);
    const fields = config.fields.filter((field) => field in payload);
    const result = await query(
      `INSERT INTO ${config.table} (${fields.join(", ")}) VALUES (${fields.map(() => "?").join(", ")})`,
      fields.map((field) => payload[field])
    );
    res.status(201).json((await query(`SELECT * FROM ${config.table} WHERE ${config.id} = ?`, [result.insertId]))[0]);
  }));

  app.put(`/api/${name}/:id`, requireAuth, asyncHandler(async (req, res) => {
    const existing = await getRecordById(config, req.params.id, req.owner.owner_id);
    if (!existing) {
      return res.status(404).json({ message: "Record not found." });
    }
    const payload = sanitizePayload(config.fields.filter((field) => field !== "pet_id"), req.body);
    const fields = Object.keys(payload);
    if (!fields.length) {
      return res.status(400).json({ message: "No fields to update." });
    }
    await query(
      `UPDATE ${config.table} SET ${fields.map((field) => `${field} = ?`).join(", ")} WHERE ${config.id} = ?`,
      [...fields.map((field) => payload[field]), req.params.id]
    );
    res.json((await query(`SELECT * FROM ${config.table} WHERE ${config.id} = ?`, [req.params.id]))[0]);
  }));

  app.delete(`/api/${name}/:id`, requireAuth, asyncHandler(async (req, res) => {
    const existing = await getRecordById(config, req.params.id, req.owner.owner_id);
    if (!existing) {
      return res.status(404).json({ message: "Record not found." });
    }
    await query(`DELETE FROM ${config.table} WHERE ${config.id} = ?`, [req.params.id]);
    res.json({ message: "Record deleted successfully." });
  }));
});

app.post("/api/uploads/prescription", requireAuth, upload.single("prescription"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: "Prescription image is required." });
  }
  res.status(201).json({ path: `/uploads/prescriptions/${req.file.filename}` });
});

app.post("/api/transfers", requireAuth, requireOwnedPet, asyncHandler(async (req, res) => {
  const { pet_id, new_owner_id, transfer_date, notes } = req.body;
  if (!pet_id || !new_owner_id) {
    return res.status(400).json({ message: "Pet and new owner are required." });
  }
  const result = await query(`
    INSERT INTO pet_transfer_records (pet_id, old_owner_id, new_owner_id, transfer_date, notes)
    VALUES (?, ?, ?, ?, ?)
  `, [pet_id, req.owner.owner_id, new_owner_id, transfer_date || null, notes?.trim() || null]);
  const rows = await query(`
    SELECT ptr.*, old_owner.owner_name AS old_owner_name, new_owner.owner_name AS new_owner_name
    FROM pet_transfer_records ptr
    JOIN owners old_owner ON old_owner.owner_id = ptr.old_owner_id
    JOIN owners new_owner ON new_owner.owner_id = ptr.new_owner_id
    WHERE ptr.transfer_id = ?
  `, [result.insertId]);
  res.status(201).json(rows[0]);
}));

app.get("/api/pets/:petId/transfers", requireAuth, asyncHandler(async (req, res) => {
  const rows = await query(`
    SELECT ptr.*, old_owner.owner_name AS old_owner_name, new_owner.owner_name AS new_owner_name
    FROM pet_transfer_records ptr
    JOIN owners old_owner ON old_owner.owner_id = ptr.old_owner_id
    JOIN owners new_owner ON new_owner.owner_id = ptr.new_owner_id
    WHERE ptr.pet_id = ? AND (ptr.old_owner_id = ? OR ptr.new_owner_id = ?)
    ORDER BY ptr.transfer_date DESC, ptr.transfer_id DESC
  `, [req.params.petId, req.owner.owner_id, req.owner.owner_id]);
  res.json(rows);
}));

app.post("/api/seed", asyncHandler(async (_req, res) => {
  const inserted = await ensureSampleData();
  res.status(inserted ? 201 : 200).json({ message: inserted ? "Sample data inserted successfully." : "Sample data already exists." });
}));

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "API route not found." });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.code === "ER_DUP_ENTRY" ? 409 : error.sqlState === "45000" ? 400 : 500;
  res.status(status).json({ message: error.sqlMessage || error.message || "Internal server error." });
});

async function start() {
  await waitForDatabase();
  await ensureSampleData();
  app.listen(PORT, () => {
    console.log(`Tails Trail server running on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start Tails Trail:", error);
  process.exit(1);
});
