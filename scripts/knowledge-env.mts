// Writes docker/.env from data/settings.json so compose and the studio never disagree
// about the Neo4j password. Run before the first `docker compose up`.
import { writeFileSync } from 'fs';
import path from 'path';
import { getSettings } from '../lib/settings';

const s = getSettings();
const out = path.join(process.cwd(), 'docker', '.env');
writeFileSync(out, `NEO4J_PASSWORD=${s.neo4jPassword}\n`);
console.log(`wrote ${out}`);
