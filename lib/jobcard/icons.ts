/**
 * The card icon set: nine marks drawn once, used by every family through <use>.
 * They are inline so a card renders with no network and no icon font.
 */

const SYMBOLS = [
  '<symbol id="i-build" viewBox="0 0 24 24"><path d="M3 21V7l7-4v4l6-3v6h5v11H3zm2-2h4v-3H5v3zm0-5h4v-3H5v3zm0-5h4V6H5v3zm6 10h3v-3h-3v3zm0-5h3v-3h-3v3zm0-5h3V6h-3v3zm5 10h3v-3h-3v3zm0-5h3v-3h-3v3z"/></symbol>',
  '<symbol id="i-case" viewBox="0 0 24 24"><path d="M10 4h4a2 2 0 0 1 2 2v1h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3V6a2 2 0 0 1 2-2zm0 3h4V6h-4v1z"/></symbol>',
  '<symbol id="i-user" viewBox="0 0 24 24"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4 0-8 2-8 4.5V21h16v-2.5c0-2.5-4-4.5-8-4.5z"/></symbol>',
  '<symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></symbol>',
  '<symbol id="i-rupee" viewBox="0 0 24 24"><path d="M6 4h12v2.4h-3.6c.5.6.9 1.3 1.1 2.1H18v2.4h-2.5c-.4 2.6-2.5 4.4-5.4 4.6L16 20.6V22h-2.3L6.6 15v-2.2h2.9c2 0 3.3-.8 3.7-2.3H6V8.5h7.1c-.5-1.3-1.8-2.1-3.7-2.1H6V4z"/></symbol>',
  '<symbol id="i-cap" viewBox="0 0 24 24"><path d="M12 3 1 8l11 5 9-4.1V15h2V8L12 3zM5 12.8V17c0 1.7 3.1 3 7 3s7-1.3 7-3v-4.2l-7 3.2-7-3.2z"/></symbol>',
  '<symbol id="i-cal" viewBox="0 0 24 24"><path d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zM5 9h14v10H5V9zm2 2v2h2v-2H7zm4 0v2h2v-2h-2zm4 0v2h2v-2h-2z"/></symbol>',
  '<symbol id="i-clock" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.6V6h-2v7.4l5 3 1-1.7-4-2.1z"/></symbol>',
  '<symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3 6v2h2V9H7zm4 0v2h2V9h-2zm4 0v2h2V9h-2z"/></symbol>',
  '<symbol id="i-link" viewBox="0 0 24 24"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l1.4-1.4a1 1 0 1 1 1.4 1.4l-1.4 1.4a1 1 0 0 1-1.4 0zM7.8 18.9a4.5 4.5 0 0 1 0-6.4l2.5-2.5 1.4 1.4-2.5 2.5a2.5 2.5 0 0 0 3.6 3.6l2.5-2.5 1.4 1.4-2.5 2.5a4.5 4.5 0 0 1-6.4 0zm8.4-13.8a4.5 4.5 0 0 1 0 6.4l-2.5 2.5-1.4-1.4 2.5-2.5a2.5 2.5 0 0 0-3.6-3.6L8.7 9l-1.4-1.4 2.5-2.5a4.5 4.5 0 0 1 6.4 0z"/></symbol>',
  '<symbol id="i-flash" viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z"/></symbol>',
];

/** Hidden in the page, referenced by every `<use>`. */
export const SPRITE = `<svg id="sprite">${SYMBOLS.join('')}</svg>`;
