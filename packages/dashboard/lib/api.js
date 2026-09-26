/** The dashboard's API client: same-origin JSON with the session's CSRF token on mutations. */
export class ApiError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
let csrf = '';
export const setCsrf = (token) => {
  csrf = token;
};
export async function api(path, init = {}) {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.method && init.method !== 'GET' ? { 'x-csrf-token': csrf } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) throw new ApiError(res.status, `${res.status}`);
  return await res.json();
}
//# sourceMappingURL=api.js.map
