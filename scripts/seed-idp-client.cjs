// 给 Sakura-Auth-Server 注册一个 AICut 测试客户端（公开 + PKCE）
const { DatabaseSync } = require('node:sqlite');
const path = '../Sakura-Auth-Server/data/idp.sqlite';
const db = new DatabaseSync(path);

const clientId = 'app-aicut-test1';
const exists = db.prepare('SELECT client_id FROM clients WHERE client_id = ?').get(clientId);
if (exists) {
  console.log('已存在，跳过创建');
} else {
  db.prepare(
    `INSERT INTO clients (client_id, name, secret_hash, redirect_uris, scopes, token_auth, pkce_required, require_consent, allowed_groups, description, logo_url, health_url, created_at)
     VALUES (?, ?, NULL, ?, ?, 'none', 1, 0, '[]', ?, '', '', ?)`,
  ).run(
    clientId,
    'Sakura AI Cut（本地测试）',
    JSON.stringify(['http://localhost:3199/api/auth/callback/sakura']),
    'openid profile email groups',
    'AICut 本地登录集成测试',
    Math.floor(Date.now() / 1000),
  );
  console.log('已创建客户端:', clientId);
}

const row = db.prepare('SELECT client_id, name, redirect_uris, scopes, token_auth, pkce_required FROM clients WHERE client_id = ?').get(clientId);
console.log(JSON.stringify(row, null, 1));
