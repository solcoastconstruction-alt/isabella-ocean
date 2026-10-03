/* Sea Words — words that must never show up in a puzzle: swearing, rude body and toilet words, sexual words,
 * slurs, and unkind words. logic.js reads every line of every puzzle, in all 8 directions, against this list
 * (a hit inside a longer string counts, so "ASS" also catches everything that contains it).
 *
 * The words are stored ROT13-encoded (each letter shifted 13 places), so this file carries no slurs in plain text.
 * To read the list:  node test/games/words/verify.js --show-blocklist
 * Rules (checked by test/games/words/verify.js): A–Z only, at least 3 letters, never inside a picture word
 * (forwards or backwards), and never made only of the filler letters, so filler alone can never spell one.
 * "HELL" is deliberately absent: it is inside SHELL. */
(function (root) {
  'use strict';
  const ROT13 = [
    'SHPX', 'SHX', 'SPHX', 'SPX', 'CUHX', 'CUHPX', 'FUVG', 'FUNG', 'PENC', 'CVFF', 'PHAG', 'XHAG', 'GJNG',
    'JNAX', 'PBPX', 'QVPX', 'CEVPX', 'ORYYRAQ', 'GBFFRE', 'OBAX', 'NEFR', 'NFF', 'OHZ', 'OHGG', 'OBYYBPX',
    'OBYYBK', 'OHTTRE', 'OYBBQL', 'OVGPU', 'OVNGPU', 'ONFGNEQ', 'OBBO', 'GVG', 'CHFFL', 'QNZA', 'QNZZVG',
    'FHPX', 'OYBJWBO', 'UNAQWBO', 'WVMM', 'PHZ', 'FCHAX', 'FCREZ', 'FRZRA', 'QVYQB', 'PYVG', 'CRAVF', 'INTVAN',
    'NAHF', 'NANY', 'FPEBGHZ', 'AVCCYR', 'FRK', 'CBEA', 'AHQR', 'ANXRQ', 'ENCR', 'ENCVFG', 'BETL', 'BETNFZ',
    'UBEAL', 'OBARE', 'UHZC', 'FUNT', 'ZVYS', 'CREI', 'CRQB', 'CNRQB', 'VAPRFG', 'FYHG', 'JUBER', 'UBR',
    'FXNAX', 'FYNT', 'UBBXRE', 'CVZC', 'CBB', 'CRR', 'JRR', 'SNEG', 'GHEQ', 'CENG', 'VQVBG', 'FGHCVQ', 'QHZO',
    'ZBEBA', 'YBFRE', 'HTYL', 'SNG', 'UNGR', 'XVYY', 'QVR', 'QRNQ', 'ZHEQRE', 'WREX', 'PERGVA', 'VZORPVYR',
    'QVZJVG', 'CVYYBPX', 'FUHGHC', 'AVT', 'PUVAX', 'TBBX', 'FCVP', 'FCVX', 'XVXR', 'JBC', 'QNTB', 'CNXV',
    'PBBA', 'WNC', 'TLC', 'TLCCB', 'JRGONPX', 'ORNARE', 'UBAXL', 'UBAXVR', 'ENTURNQ', 'GBJRYURNQ', 'FNZOB',
    'QNEXVR', 'ARTEB', 'VAWHA', 'ERQFXVA', 'FDHNJ', 'URRO', 'LVQ', 'WVTNOBB', 'SNT', 'QLXR', 'UBZB', 'YRFOB',
    'DHRRE', 'GENAAL', 'FURZNYR', 'ERGNEQ', 'GNEQ', 'FCNM', 'FCNFGVP', 'ZBAT', 'ZVQTRG', 'ANMV', 'UVGYRE',
    'XXX', 'JGS', 'FGSH', 'TGSB', 'SSF',
  ];
  const rot13 = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65));
  const WORDS = Object.freeze(ROT13.map(rot13));
  if (typeof module !== 'undefined' && module.exports) module.exports = WORDS;
  else root.WordsBlocklist = WORDS;
})(typeof self !== 'undefined' ? self : this);
