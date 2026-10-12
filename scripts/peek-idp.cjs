// 查看 Sakura-Auth-Server 的客户端与用户（只读）
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('../Sakura-Auth-Server/data/idp.sqlite');
const cols = db.prepare('PRAGMA table_info(clients)').all();
console.log('clients 列:', cols.map((c) => c.name).join(', '));
const apps = db.prepare('SELECT * FROM clients LIMIT 5').all();
console.log('--- 应用 ---');
console.log(JSON.stringify(apps, null, 1));
const users = db.prepare('SELECT id, username, disabled, name FROM users LIMIT 5').all();
console.log('--- 用户 ---');
console.log(JSON.stringify(users, null, 1));

