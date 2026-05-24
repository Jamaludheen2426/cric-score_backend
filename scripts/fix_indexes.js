/**
 * Emergency cleanup: drop duplicate indexes accumulated by Sequelize's
 * `sync({ alter: true })` so the backend can boot again.
 *
 * Strategy: for every table, keep PRIMARY + the first index per
 * (Column_name OR Key_name) pattern, drop the rest.
 *
 * Then we also fix the root cause in server.ts so this never happens again.
 *
 * Run:   node scripts/fix_indexes.js [--dry]
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const DRY = process.argv.includes('--dry');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    multipleStatements: true,
  });

  const [tablesRows] = await conn.query('SHOW TABLES');
  const tcol = Object.keys(tablesRows[0])[0];
  const tables = tablesRows.map(r => r[tcol]);

  let dropped = 0;
  for (const t of tables) {
    const [idx] = await conn.query('SHOW INDEX FROM `' + t + '`');
    // Group indexes by Key_name
    const byKey = new Map();
    for (const i of idx) {
      const arr = byKey.get(i.Key_name) || [];
      arr.push(i);
      byKey.set(i.Key_name, arr);
    }

    if (byKey.size <= 5) continue;
    console.log(`\n${t}: ${byKey.size} indexes`);

    // Group keys by the column set they cover so we can keep only ONE
    // index per column pattern. Sequelize's alter loop creates many
    // duplicates with auto-generated names like name_2, name_3, …
    const columnsToKeyNames = new Map();
    for (const [keyName, parts] of byKey.entries()) {
      if (keyName === 'PRIMARY') continue;
      const cols = parts.sort((a, b) => a.Seq_in_index - b.Seq_in_index).map(p => p.Column_name).join(',');
      const arr = columnsToKeyNames.get(cols) || [];
      arr.push(keyName);
      columnsToKeyNames.set(cols, arr);
    }

    for (const [cols, names] of columnsToKeyNames.entries()) {
      if (names.length <= 1) continue;
      // Keep one (prefer the shortest non-numeric-suffixed name)
      names.sort((a, b) => {
        const aNum = /_\d+$/.test(a) ? 1 : 0;
        const bNum = /_\d+$/.test(b) ? 1 : 0;
        if (aNum !== bNum) return aNum - bNum;          // prefer non-numbered
        return a.length - b.length;                     // then shortest
      });
      const [keep, ...drop] = names;
      console.log(`  cols(${cols}): keep '${keep}', drop ${drop.length} duplicate(s)`);
      for (const d of drop) {
        const sql = 'ALTER TABLE `' + t + '` DROP INDEX `' + d + '`';
        if (DRY) {
          console.log('    [dry] ' + sql);
        } else {
          await conn.query(sql);
          dropped++;
        }
      }
    }
  }

  console.log(`\n${DRY ? '[dry] would drop' : 'dropped'}: ${dropped} duplicate indexes`);
  await conn.end();
}

main().catch(e => { console.error(e); process.exit(1); });
