
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const APP_CODE = process.env.APP_CODE || "";
const DATABASE_URL = process.env.DATABASE_URL || "";
const DATA_FILE = path.join(__dirname, "agenda.json");

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: false }
  });
}

function requireCode(req, res, next) {
  if (!APP_CODE) return next();
  if (req.headers["x-app-code"] !== APP_CODE) {
    return res.status(401).json({ error: "Código inválido" });
  }
  next();
}

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agendamentos (
      id BIGSERIAL PRIMARY KEY,
      cliente TEXT NOT NULL,
      telefone TEXT NOT NULL,
      endereco TEXT NOT NULL,
      servico TEXT NOT NULL,
      data TEXT NOT NULL,
      hora TEXT NOT NULL,
      alerta TEXT NOT NULL,
      status TEXT NOT NULL,
      observacoes TEXT DEFAULT '',
      criado_em TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

function lerLocal() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function salvarLocal(dados) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(dados, null, 2), "utf8");
}

app.get("/api/config", (req, res) => {
  res.json({ requireCode: Boolean(APP_CODE), onlineDb: Boolean(pool) });
});

app.get("/api/agendamentos", requireCode, async (req, res) => {
  if (pool) {
    const r = await pool.query("SELECT * FROM agendamentos ORDER BY data ASC, hora ASC, id DESC");
    return res.json(r.rows);
  }
  res.json(lerLocal());
});

app.post("/api/agendamentos", requireCode, async (req, res) => {
  const a = req.body;
  if (pool) {
    const r = await pool.query(
      `INSERT INTO agendamentos (cliente, telefone, endereco, servico, data, hora, alerta, status, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [a.cliente, a.telefone, a.endereco, a.servico, a.data, a.hora, a.alerta, a.status, a.observacoes || ""]
    );
    return res.json(r.rows[0]);
  }
  const lista = lerLocal();
  const novo = { id: Date.now(), criado_em: new Date().toISOString(), ...a };
  lista.unshift(novo);
  salvarLocal(lista);
  res.json(novo);
});

app.put("/api/agendamentos/:id/status", requireCode, async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (pool) {
    await pool.query("UPDATE agendamentos SET status=$1 WHERE id=$2", [status, id]);
    return res.json({ ok: true });
  }
  salvarLocal(lerLocal().map(x => x.id === id ? { ...x, status } : x));
  res.json({ ok: true });
});

app.delete("/api/agendamentos/:id", requireCode, async (req, res) => {
  const id = Number(req.params.id);
  if (pool) {
    await pool.query("DELETE FROM agendamentos WHERE id=$1", [id]);
    return res.json({ ok: true });
  }
  salvarLocal(lerLocal().filter(x => x.id !== id));
  res.json({ ok: true });
});

initDb().then(() => {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("REFLEXO AGENDA ONLINE iniciado na porta " + PORT);
  });
});
