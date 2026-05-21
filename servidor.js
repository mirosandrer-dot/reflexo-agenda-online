
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || '';
const DATA_FILE = path.join(__dirname, 'agenda.json');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let pool = null;
if (DATABASE_URL) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
}

function lerLocal() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}
function salvarLocal(dados) { fs.writeFileSync(DATA_FILE, JSON.stringify(dados, null, 2), 'utf8'); }
function requireUser(req, res, next) {
  const usuario = req.headers['x-usuario'] || '';
  if (!usuario) return res.status(401).json({ error: 'Usuário não informado.' });
  req.usuarioLogado = usuario;
  next();
}

async function initDb() {
  if (!pool) return;
  await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (
    id BIGSERIAL PRIMARY KEY,
    nome TEXT NOT NULL,
    usuario TEXT UNIQUE NOT NULL,
    senha TEXT NOT NULL,
    nivel TEXT NOT NULL DEFAULT 'Vendas',
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS agendamentos (
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
    usuario_responsavel TEXT DEFAULT '',
    criado_por TEXT DEFAULT '',
    alterado_por TEXT DEFAULT '',
    criado_em TIMESTAMPTZ DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS usuario_responsavel TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS criado_por TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS alterado_por TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE agendamentos ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMPTZ DEFAULT NOW()`);
  await pool.query(`CREATE TABLE IF NOT EXISTS historico_agendamentos (
    id BIGSERIAL PRIMARY KEY,
    agendamento_id BIGINT,
    acao TEXT NOT NULL,
    usuario TEXT DEFAULT '',
    descricao TEXT DEFAULT '',
    dados_anteriores JSONB,
    dados_novos JSONB,
    criado_em TIMESTAMPTZ DEFAULT NOW()
  )`);
  const count = await pool.query('SELECT COUNT(*)::int AS total FROM usuarios');
  if (count.rows[0].total === 0) {
    await pool.query(`INSERT INTO usuarios (nome, usuario, senha, nivel, ativo) VALUES
      ('Miro','miro','123456','Administrador',true),
      ('Zilda','zilda','123456','Vendas',true),
      ('Flávio','flavio','123456','Instalação',true)
      ON CONFLICT (usuario) DO NOTHING`);
  }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/api/config', (req, res) => res.json({ onlineDb: Boolean(pool), loginIndividual: true }));

app.post('/api/login', async (req, res) => {
  const { usuario, senha } = req.body;
  if (pool) {
    const r = await pool.query('SELECT id,nome,usuario,nivel,ativo FROM usuarios WHERE usuario=$1 AND senha=$2 LIMIT 1', [usuario, senha]);
    if (!r.rows.length || !r.rows[0].ativo) return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    return res.json(r.rows[0]);
  }
  const u = [{id:1,nome:'Miro',usuario:'miro',senha:'123456',nivel:'Administrador',ativo:true},{id:2,nome:'Zilda',usuario:'zilda',senha:'123456',nivel:'Vendas',ativo:true},{id:3,nome:'Flávio',usuario:'flavio',senha:'123456',nivel:'Instalação',ativo:true}].find(x=>x.usuario===usuario&&x.senha===senha&&x.ativo);
  if (!u) return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  delete u.senha; res.json(u);
});

app.get('/api/usuarios', requireUser, async (req, res) => {
  if (!pool) return res.json([{id:1,nome:'Miro',usuario:'miro',nivel:'Administrador',ativo:true},{id:2,nome:'Zilda',usuario:'zilda',nivel:'Vendas',ativo:true},{id:3,nome:'Flávio',usuario:'flavio',nivel:'Instalação',ativo:true}]);
  const r = await pool.query('SELECT id,nome,usuario,nivel,ativo FROM usuarios ORDER BY nome');
  res.json(r.rows);
});
app.post('/api/usuarios', requireUser, async (req, res) => {
  if (!pool) return res.status(400).json({ error: 'Precisa PostgreSQL.' });
  const u = req.body;
  const r = await pool.query('INSERT INTO usuarios (nome,usuario,senha,nivel,ativo) VALUES ($1,$2,$3,$4,$5) RETURNING id,nome,usuario,nivel,ativo', [u.nome,u.usuario,u.senha||'123456',u.nivel||'Vendas',u.ativo!==false]);
  res.json(r.rows[0]);
});
app.put('/api/usuarios/:id', requireUser, async (req, res) => {
  if (!pool) return res.status(400).json({ error: 'Precisa PostgreSQL.' });
  const id = Number(req.params.id), u = req.body;
  if (u.senha) await pool.query('UPDATE usuarios SET nome=$1,usuario=$2,senha=$3,nivel=$4,ativo=$5 WHERE id=$6', [u.nome,u.usuario,u.senha,u.nivel,u.ativo,id]);
  else await pool.query('UPDATE usuarios SET nome=$1,usuario=$2,nivel=$3,ativo=$4 WHERE id=$5', [u.nome,u.usuario,u.nivel,u.ativo,id]);
  res.json({ok:true});
});

app.get('/api/agendamentos', requireUser, async (req, res) => {
  if (pool) { const r = await pool.query('SELECT * FROM agendamentos ORDER BY data ASC,hora ASC,id DESC'); return res.json(r.rows); }
  res.json(lerLocal());
});
app.post('/api/agendamentos', requireUser, async (req, res) => {
  const a = req.body, usuario = req.usuarioLogado;
  if (pool) {
    const r = await pool.query(`INSERT INTO agendamentos (cliente,telefone,endereco,servico,data,hora,alerta,status,observacoes,usuario_responsavel,criado_por,alterado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING *`, [a.cliente,a.telefone,a.endereco,a.servico,a.data,a.hora,a.alerta,a.status,a.observacoes||'',a.usuario_responsavel||usuario,usuario]);
    await pool.query('INSERT INTO historico_agendamentos (agendamento_id,acao,usuario,descricao,dados_novos) VALUES ($1,$2,$3,$4,$5)', [r.rows[0].id,'CRIADO',usuario,'Agendamento criado',JSON.stringify(r.rows[0])]);
    return res.json(r.rows[0]);
  }
  const l = lerLocal(), novo = { id: Date.now(), criado_em: new Date().toISOString(), criado_por: usuario, alterado_por: usuario, usuario_responsavel: a.usuario_responsavel||usuario, ...a };
  l.unshift(novo); salvarLocal(l); res.json(novo);
});
app.put('/api/agendamentos/:id', requireUser, async (req, res) => {
  const id = Number(req.params.id), a = req.body, usuario = req.usuarioLogado;
  if (pool) {
    const old = await pool.query('SELECT * FROM agendamentos WHERE id=$1', [id]);
    await pool.query(`UPDATE agendamentos SET cliente=$1,telefone=$2,endereco=$3,servico=$4,data=$5,hora=$6,alerta=$7,status=$8,observacoes=$9,usuario_responsavel=$10,alterado_por=$11,atualizado_em=NOW() WHERE id=$12`, [a.cliente,a.telefone,a.endereco,a.servico,a.data,a.hora,a.alerta,a.status,a.observacoes||'',a.usuario_responsavel||'',usuario,id]);
    const updated = await pool.query('SELECT * FROM agendamentos WHERE id=$1', [id]);
    await pool.query('INSERT INTO historico_agendamentos (agendamento_id,acao,usuario,descricao,dados_anteriores,dados_novos) VALUES ($1,$2,$3,$4,$5,$6)', [id,'EDITADO',usuario,'Agendamento editado/reagendado',JSON.stringify(old.rows[0]||{}),JSON.stringify(updated.rows[0]||{})]);
    return res.json({ok:true});
  }
  salvarLocal(lerLocal().map(x => x.id === id ? { ...x, ...a, alterado_por: usuario, atualizado_em: new Date().toISOString() } : x)); res.json({ok:true});
});
app.put('/api/agendamentos/:id/status', requireUser, async (req, res) => {
  const id = Number(req.params.id), status = req.body.status, usuario = req.usuarioLogado;
  if (pool) {
    const old = await pool.query('SELECT * FROM agendamentos WHERE id=$1', [id]);
    await pool.query('UPDATE agendamentos SET status=$1,alterado_por=$2,atualizado_em=NOW() WHERE id=$3', [status,usuario,id]);
    const updated = await pool.query('SELECT * FROM agendamentos WHERE id=$1', [id]);
    await pool.query('INSERT INTO historico_agendamentos (agendamento_id,acao,usuario,descricao,dados_anteriores,dados_novos) VALUES ($1,$2,$3,$4,$5,$6)', [id,'STATUS',usuario,'Status alterado para '+status,JSON.stringify(old.rows[0]||{}),JSON.stringify(updated.rows[0]||{})]);
    return res.json({ok:true});
  }
  salvarLocal(lerLocal().map(x => x.id === id ? { ...x, status, alterado_por: usuario } : x)); res.json({ok:true});
});
app.get('/api/agendamentos/:id/historico', requireUser, async (req, res) => {
  if (!pool) return res.json([]);
  const r = await pool.query('SELECT * FROM historico_agendamentos WHERE agendamento_id=$1 ORDER BY criado_em DESC', [Number(req.params.id)]);
  res.json(r.rows);
});
app.delete('/api/agendamentos/:id', requireUser, async (req, res) => {
  const id = Number(req.params.id), usuario = req.usuarioLogado;
  if (pool) {
    const old = await pool.query('SELECT * FROM agendamentos WHERE id=$1', [id]);
    await pool.query('INSERT INTO historico_agendamentos (agendamento_id,acao,usuario,descricao,dados_anteriores) VALUES ($1,$2,$3,$4,$5)', [id,'EXCLUÍDO',usuario,'Agendamento excluído',JSON.stringify(old.rows[0]||{})]);
    await pool.query('DELETE FROM agendamentos WHERE id=$1', [id]); return res.json({ok:true});
  }
  salvarLocal(lerLocal().filter(x=>x.id!==id)); res.json({ok:true});
});

initDb().then(() => app.listen(PORT, '0.0.0.0', () => console.log('REFLEXO AGENDA PRO iniciado na porta '+PORT))).catch(err => { console.error('Erro ao iniciar:', err); process.exit(1); });
