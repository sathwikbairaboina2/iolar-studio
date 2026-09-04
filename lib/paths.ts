import path from 'path';

/** Every path under the handbooks tree lives here so the layout is stated once. */

export function dataRoot() {
  return process.env.IOLAR_DATA_DIR ?? path.join(process.cwd(), 'data');
}

export function handbooksRoot() {
  return path.join(dataRoot(), 'handbooks');
}

export function isSlug(v: string) {
  return /^[a-z0-9-]+$/.test(v);
}

export function slugify(v: string) {
  return v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function partName(n: number) {
  return String(n).padStart(2, '0');
}

export function subjectDir(s: string) { return path.join(handbooksRoot(), s); }
export function subjectFile(s: string) { return path.join(subjectDir(s), 'subject.json'); }
export function chapterDir(s: string, c: string) { return path.join(subjectDir(s), c); }
export function chapterFile(s: string, c: string) { return path.join(chapterDir(s, c), 'chapter.json'); }
export function bookFile(s: string, c: string) { return path.join(chapterDir(s, c), 'book.json'); }
export function referencesFile(s: string, c: string) { return path.join(chapterDir(s, c), 'references.json'); }
export function refsDir(s: string, c: string) { return path.join(chapterDir(s, c), 'refs'); }
export function partsDir(s: string, c: string) { return path.join(chapterDir(s, c), 'parts'); }
export function partDir(s: string, c: string, part: number) { return path.join(partsDir(s, c), partName(part)); }
export function postFile(s: string, c: string, part: number) { return path.join(partDir(s, c, part), 'post.json'); }
export function rendersDir(s: string, c: string, part: number) { return path.join(partDir(s, c, part), 'renders'); }
export function exportDir(s: string, c: string, part: number) { return path.join(partDir(s, c, part), 'export'); }

/** Reels live in a flat per-slug tree; styles are repo assets, not user data. */
export function reelsRoot() { return path.join(dataRoot(), 'reel'); }
export function reelDir(slug: string) { return path.join(reelsRoot(), slug); }
export function reelFile(slug: string) { return path.join(reelDir(slug), 'reel.json'); }
export function reelAssetsDir(slug: string) { return path.join(reelDir(slug), 'assets'); }
export function reelRefsDir(slug: string) { return path.join(reelDir(slug), 'refs'); }
/** Research sits beside the reel it produced, so one slug owns the whole life. */
export function reelResearchDir(slug: string) { return path.join(reelDir(slug), 'research'); }
export function reelBriefFile(slug: string) { return path.join(reelResearchDir(slug), 'brief.json'); }
export function reelCandidatesFile(slug: string) { return path.join(reelResearchDir(slug), 'candidates.json'); }
export function reelHuntFile(slug: string) { return path.join(reelResearchDir(slug), 'hunted.json'); }
export function reelSelectionFile(slug: string) { return path.join(reelResearchDir(slug), 'selection.json'); }
export function reelScriptFile(slug: string) { return path.join(reelResearchDir(slug), 'script.json'); }
export function reelEvidenceDir(slug: string) { return path.join(reelResearchDir(slug), 'evidence'); }
export function reelHistoryDir(slug: string) { return path.join(reelDir(slug), 'history'); }
export function reelHistoryIndex(slug: string) { return path.join(reelHistoryDir(slug), 'index.json'); }
export function reelHistorySnap(slug: string, seq: number) { return path.join(reelHistoryDir(slug), `${seq}.json`); }
/** Where a creator drops their own footage: one folder per beat, filled from the desktop. */
export function reelInboxDir(slug: string) { return path.join(reelDir(slug), 'inbox'); }
export function beatInboxDir(slug: string, beatId: string) { return path.join(reelInboxDir(slug), beatId); }
export function reelVoFile(slug: string) { return path.join(reelDir(slug), 'vo.mp3'); }
export function reelWordsFile(slug: string) { return path.join(reelDir(slug), 'vo.words.json'); }
export function reelRendersDir(slug: string) { return path.join(reelDir(slug), 'renders'); }
export function reelExportDir(slug: string) { return path.join(reelDir(slug), 'export'); }
/** The hook clip a user dropped for a pattern reel; when present it beats the lipsync render. */
export function reelPresenterFile(slug: string) { return path.join(reelDir(slug), 'presenter.mp4'); }
/** Working files of the pattern pipeline: the hook's audio cut, the service's timeline. */
export function reelPatternDir(slug: string) { return path.join(reelDir(slug), 'pattern'); }
export function reelPatternHookAudio(slug: string) { return path.join(reelPatternDir(slug), 'hook.wav'); }
export function reelPatternTimelineFile(slug: string) { return path.join(reelPatternDir(slug), 'timeline.json'); }
export function stylesRoot() { return path.join(process.cwd(), 'styles'); }
export function styleDir(name: string) { return path.join(stylesRoot(), name); }

/** One job card, one folder: the document, the mark it found, and the card it rendered. */
export function jobcardsRoot() { return path.join(dataRoot(), 'jobcard'); }
export function jobcardDir(id: string) { return path.join(jobcardsRoot(), id); }
export function jobcardFile(id: string) { return path.join(jobcardDir(id), 'card.json'); }
export function jobcardImage(id: string) { return path.join(jobcardDir(id), 'card.png'); }
export function jobcardLogo(id: string, ext: string) { return path.join(jobcardDir(id), `logo.${ext}`); }
