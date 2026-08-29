import { renderSlide, closeBrowser } from '../lib/renderer/capture';
import { validatePost } from '../lib/schema';

const post = validatePost({
  brand: 'iolar', template: process.argv[2] ?? 'spiral-notes', ratio: '3:4', seed: 7,
  series: 'PYTHON DATA STRUCTURES — DEEP DIVE', date: '29/08/2026',
  slides: [{ page_title: 'DATA STRUCTURES OVERVIEW', blocks: [
    { type: 'heading', text: '1. What is a Data Structure?' },
    { type: 'paragraph', text: 'A data structure is a way of organizing and storing data in computer memory so that we can access, modify and process it efficiently.' },
    { type: 'sidebox', title: 'Why Data Structures?', items: ['To store data in an organized way.', 'To perform operations efficiently.', 'To reduce time & space complexity.'], ink: 'green' },
    { type: 'heading', text: '2. Built-in Data Structures in Python' },
    { type: 'table', headers: ['Data Structure', 'Ordered', 'Mutable', 'Use Case'], rows: [
      ['List [1,2,3]', 'Yes', 'Yes', 'Ordered collection'],
      ['Tuple (1,2,3)', 'Yes', 'No', 'Fixed collection'],
      ['Set {1,2,3}', 'No', 'Yes', 'Unique items'],
      ["Dict {'a':1}", 'Yes', 'Yes', 'Key-value map']] },
    { type: 'code', lang: 'python', lines: ['my_list = [10, 20, 30]', 'my_list.append(40)   # [10, 20, 30, 40]'] },
    { type: 'callout', style: 'tip', title: 'Interview Tip', text: 'Always choose the right data structure. It improves code readability & performance.' },
  ]}],
  caption: { text: '', hashtags: [] },
});

const out = process.argv[3] ?? 'sample-out.png';
const r = await renderSlide(post, 0, out);
console.log('overflow:', r.overflowPx, '->', out);
await closeBrowser();
