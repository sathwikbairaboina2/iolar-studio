/**
 * One colour per kind of thing in the graph, shared by the flat view and the deep one so a
 * Topic is the same green whichever way it is being looked at.
 */
export const COLOUR: Record<string, string> = {
  Subject: '#c02a58',
  Chapter: '#3ec5ff',
  Topic: '#3ddc97',
  Source: '#f2a93b',
  Domain: '#b58900',
  Claim: '#9d7cff',
  Reel: '#ff6f94',
  ScriptLine: '#8fb3ff',
  Week: '#2fb7a1',
  Employer: '#e0b34a',
  Function: '#7ab0ff',
  City: '#a0d468',
  WorkMode: '#c9c9c9',
};

export const colourOf = (kind: string) => COLOUR[kind] ?? '#8c8c8c';
