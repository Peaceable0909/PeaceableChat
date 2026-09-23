/**
 * Code execution tool (section 15). Runs Python entirely inside the
 * browser tab via Pyodide (WASM) — genuinely isolated from any server,
 * because there is no server. Free, no API key.
 */
let pyodideReady = null;

function loadPyodide() {
  if (pyodideReady) return pyodideReady;
  pyodideReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js';
    s.onload = async () => {
      try { resolve(await window.loadPyodide()); }
      catch (e) { reject(e); }
    };
    s.onerror = () => reject(new Error('Failed to load the Python sandbox'));
    document.head.appendChild(s);
  });
  return pyodideReady;
}

export function preloadSandbox() { return loadPyodide().catch(() => null); }

export async function runPython(code, { timeoutMs = 15000 } = {}) {
  const py = await loadPyodide();
  let stdout = '', stderr = '';
  py.setStdout({ batched: s => { stdout += s + '\n'; } });
  py.setStderr({ batched: s => { stderr += s + '\n'; } });

  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Execution timed out after 15s')), timeoutMs));
  try {
    const result = await Promise.race([py.runPythonAsync(code), timeout]);
    return { ok: true, stdout, stderr, result: result === undefined ? null : String(result) };
  } catch (err) {
    return { ok: false, stdout, stderr, error: err.message || String(err) };
  }
}
