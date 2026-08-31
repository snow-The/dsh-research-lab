import * as rel from 'file:///C:/Users/snow/.dsh-starter/plugins/dsh-research-lab/test-all.mjs';
import * as fs from 'node:fs';
const PROJ = 'C:/Users/snow/AppData/Local/Temp/rlab-fuzz';
fs.rmSync(PROJ, { recursive: true, force: true });
for (const [t, b] of [['A', 'alpha beta gamma'], ['B', '中文测试 蒸馏 塌缩'], ['C', 'we propose method X for task Y']]) rel.addDoc(PROJ, t, b, 'fuzz');
const CTL0 = String.fromCharCode(0), CTL1 = String.fromCharCode(1), CTL127 = String.fromCharCode(127), CTL8203 = String.fromCharCode(8203), CTL8232 = String.fromCharCode(8232), CTL65535 = String.fromCharCode(65535);
const CHARS = ['a','Z','0','9','-','_','.',',',' ','\t','\n','中','文','字','塌','缩','😀','🚀','🧪',CTL0,CTL1,CTL127,CTL8203,CTL8232,CTL65535,'"',"'",'\\','(',')','[',']','{','}','|','&','!','#','$','%','^','*','+','=','~','`',':',';','<','>','?','/','é','ß','日','本','語','한','글'];
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const randStr = (maxLen) => { const len = Math.floor(rnd() * maxLen); let s = ''; for (let i = 0; i < len; i++) s += CHARS[Math.floor(rnd() * CHARS.length)]; return s; };
const weird = ['', ' ', CTL0, '" OR 1=1 --', '4b', 'wemm-4b', 'a'.repeat(5000), '中'.repeat(3000), '😀'.repeat(500), CTL0+CTL1+CTL127+CTL8203, 'NULL', 'undefined', 'NaN', '[]', '{}', '"quoted"', '日本語テキスト', '한국어 텍스트', 'русский текст', 'العربية', '1234567890', 'αβγδε'];
let crashes = 0;
const guard = (name, fn) => { try { fn(); return true; } catch (e) { crashes++; console.log('  BOOM ' + name + ': ' + e.message); return false; } };
for (let i = 0; i < 3000; i++) {
  const s = randStr(300);
  guard('tokenize', () => rel.tokenize(s));
  guard('ftsText', () => rel.ftsText(s));
  guard('rewrite', () => rel.rewriteText(s));
  guard('extract', () => rel.extractClaims(s));
  guard('hybridSearch', () => rel.hybridSearch(PROJ, s, 3));
  guard('expand', () => rel.expandSearch(PROJ, s, 2, 3));
}
for (const s of weird) {
  guard('tokenize-weird', () => rel.tokenize(s));
  guard('rewrite-weird', () => rel.rewriteText(s));
  guard('extract-weird', () => rel.extractClaims(s));
  guard('search-weird', () => rel.hybridSearch(PROJ, s, 3));
  guard('expand-weird', () => rel.expandSearch(PROJ, s, 2, 3));
}
console.log('FUZZ DONE: ' + (crashes === 0 ? 'OK 0 crashes over ' + (3000 * 6 + weird.length * 5) + ' calls' : 'FAIL ' + crashes + ' crashes'));
process.exit(crashes ? 1 : 0);