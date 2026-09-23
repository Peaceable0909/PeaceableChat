/**
 * Safe calculator tool (section 14). Pure recursive-descent parser —
 * never eval()'s user text. Returns null when the input isn't a
 * confident arithmetic expression so it can fall through to the model.
 */
const FUNCS = {
  sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  log: Math.log10, ln: Math.log, abs: Math.abs,
  round: Math.round, floor: Math.floor, ceil: Math.ceil
};
const CONSTS = { pi: Math.PI, e: Math.E };

export function tryCalculate(input) {
  if (!input) return null;
  const expr = input.trim();

  const pctOf = expr.match(/^([\d.]+)\s*%\s*of\s*([\d.]+)$/i);
  if (pctOf) return { ok: true, expr, result: (parseFloat(pctOf[1]) / 100) * parseFloat(pctOf[2]) };

  if (!/^[0-9a-z+\-*/^%().,\s]+$/i.test(expr)) return null;
  if (!/[0-9]/.test(expr)) return null;
  if (!/[+\-*/^%]|^[a-z]+\(/i.test(expr)) return null; // require an actual operator/function

  try {
    const result = evalExpr(expr);
    if (typeof result !== 'number' || !isFinite(result)) return null;
    return { ok: true, expr, result };
  } catch { return null; }
}

function evalExpr(s) {
  let i = 0;
  const peek = () => s[i];
  const skip = () => { while (s[i] === ' ') i++; };

  function atomWord() {
    const start = i;
    while (/[a-z]/i.test(peek() || '')) i++;
    const word = s.slice(start, i).toLowerCase();
    skip();
    if (peek() === '(') {
      i++; const arg = expr_(); skip();
      if (peek() !== ')') throw new Error('bad paren'); i++;
      const fn = FUNCS[word]; if (!fn) throw new Error('unknown fn ' + word);
      return fn(arg);
    }
    if (word in CONSTS) return CONSTS[word];
    throw new Error('unknown ident ' + word);
  }
  function number() {
    const start = i;
    while (/[0-9.]/.test(peek() || '')) i++;
    if (start === i) throw new Error('expected number');
    return parseFloat(s.slice(start, i));
  }
  function atom() {
    skip();
    if (peek() === '(') { i++; const v = expr_(); skip(); if (peek() !== ')') throw new Error('bad paren'); i++; return v; }
    if (peek() === '-') { i++; return -atom(); }
    if (peek() === '+') { i++; return atom(); }
    if (/[a-z]/i.test(peek() || '')) return atomWord();
    return number();
  }
  function pow() {
    const v = atom(); skip();
    if (peek() === '^') { i++; return Math.pow(v, pow()); }
    return v;
  }
  function term() {
    let v = pow();
    for (;;) {
      skip();
      if (peek() === '*') { i++; v *= pow(); }
      else if (peek() === '/') { i++; v /= pow(); }
      else if (peek() === '%') { i++; v %= pow(); }
      else break;
    }
    return v;
  }
  function expr_() {
    let v = term();
    for (;;) {
      skip();
      if (peek() === '+') { i++; v += term(); }
      else if (peek() === '-') { i++; v -= term(); }
      else break;
    }
    return v;
  }

  const result = expr_();
  skip();
  if (i !== s.length) throw new Error('trailing input');
  return result;
}
