import { describe, expect, it } from 'vitest';
import { categoryOf } from '@/lib/handbookCategories';
import { editionRules, sectionPrompt } from '@/lib/digital/prompt';

describe('notes pages without filler', () => {
  const rules = editionRules(categoryOf('handbook'), 'outline');

  it('asks for 2 to 4 mini-sections and forbids filler, demo code and interview questions', () => {
    expect(rules).toContain('2 to 4 mini-sections');
    expect(rules).not.toContain('3 to 6 mini-sections');
    expect(rules).toContain('Write only what is worth revising.');
    expect(rules).toContain('no restating the heading');
    expect(rules).toContain('never a demo that only prints constants or arithmetic');
    expect(rules).toContain('No interview questions or qa blocks on a notes page; the quiz page has those.');
    expect(rules).toContain('A page that is half full is fine; never pad it to fill the space.');
  });

  it('keeps the Q&A and drills shapes unchanged', () => {
    const qa = editionRules(categoryOf('interview-qa'), 'outline');
    expect(qa).toContain('Every point is one interview question.');
    expect(qa).not.toContain('Write only what is worth revising.');
    const drills = editionRules(categoryOf('drills'), 'outline');
    expect(drills).toContain('Every point is one drill.');
    expect(drills).not.toContain('Write only what is worth revising.');
  });
});

describe('quiz page word budget', () => {
  const book = { title: 't', summary: '', chapters: [{ title: 'A', points: ['p'] }] } as never;
  const quiz = (id: string) => sectionPrompt({ book, chapterTitle: 'T', role: 'quiz', carousel: '', category: categoryOf(id) });

  it('tells a handbook quiz its word limit and to write 3 questions', () => {
    expect(quiz('handbook')).toContain('The quiz page has the same 170-word limit as every page, questions and answers together: write 3 questions');
  });

  it('adds nothing for a category without a word limit', () => {
    expect(quiz('drills')).not.toContain('-word limit as every page');
  });
});
