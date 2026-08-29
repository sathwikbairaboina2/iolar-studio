import { migratePaperbook } from '../lib/migrate';

const res = await migratePaperbook();
for (const m of res.moved) console.log('moved', m.from, '->', m.to);
if (res.skipped.length) console.log('skipped (target exists):', res.skipped.join(', '));
console.log(res.moved.length ? 'migration complete' : 'nothing to migrate');
