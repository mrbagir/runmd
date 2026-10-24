// Thin wrapper around the RunMD JSON API. Every call throws an Error with the
// server's message on a non-2xx response.

async function request(url, { method = 'GET', body } = {}) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = (await res.text()).trim();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

const q = encodeURIComponent;

export const api = {
  listNotes: () => request('/api/notes'),
  getNote: (name) => request(`/api/notes/content?name=${q(name)}`),
  saveNote: (name, content) => request('/api/notes', { method: 'POST', body: { name, content } }),
  deleteNote: (name) => request(`/api/notes?name=${q(name)}`, { method: 'DELETE' }),
  renameNote: (oldName, newName) =>
    request('/api/notes/rename', { method: 'POST', body: { old_name: oldName, new_name: newName } }),

  listConnections: () => request('/api/connections'),
  saveConnection: (conn) => request('/api/connections', { method: 'POST', body: conn }),
  deleteConnection: (alias) => request(`/api/connections?alias=${q(alias)}`, { method: 'DELETE' }),

  run: (payload) => request('/api/run', { method: 'POST', body: payload }),
  graph: () => request('/api/graph'),
};
