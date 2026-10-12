/**
 * Rozmowa z serwerem. Wszystkie metody zwracają dane JSON albo rzucają ApiError.
 * `status` w błędzie: 401 = brak hasła ekipy, 0 = brak połączenia.
 */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export class Api {
  async request(method, path, body) {
    let response;
    try {
      response = await fetch('/api/' + path, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Brak połączenia z serwerem.', 0);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data.error || 'Nie udało się.', response.status);
    return data;
  }

  /** Pełny stan albo `{ unchanged: true }`, gdy wersja `v` jest aktualna. */
  state(v) {
    return this.request('GET', 'state' + (v ? '?v=' + v : ''));
  }

  /** Akcja zmieniająca stan; zwraca nowy pełny stan. */
  action(name, body) {
    return this.request('POST', name, body);
  }

  login(password) { return this.request('POST', 'login', { password }); }
  logout() { return this.request('POST', 'logout', {}); }
  adminLogin(password) { return this.request('POST', 'adminLogin', { password }); }
  adminLogout() { return this.request('POST', 'adminLogout', {}); }
}
