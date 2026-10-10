const API_MODE_KEY = 'plannerApiMode';
const API_TOKEN_KEY = 'plannerApiToken';
const MOCK_STORE_KEY = 'plannerMockStore';
const API_BASE_URL_KEY = 'plannerApiBaseUrl';

const DEFAULT_MODE = 'auto';

function nowIso() {
  return new Date().toISOString();
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function readMockStore() {
  try {
    const raw = localStorage.getItem(MOCK_STORE_KEY);
    if (!raw) return { state: null, version: 0, updatedAt: null };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { state: null, version: 0, updatedAt: null };
    return {
      state: parsed.state && typeof parsed.state === 'object' ? parsed.state : null,
      version: Number.isInteger(parsed.version) ? parsed.version : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch (error) {
    console.warn('Unable to read mock API data store.', error);
    return { state: null, version: 0, updatedAt: null };
  }
}

function writeMockStore(store) {
  localStorage.setItem(MOCK_STORE_KEY, JSON.stringify(store));
}

export class ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code || 'API_ERROR';
    this.status = options.status ?? null;
    this.data = options.data ?? null;
  }
}

export function createApiClient() {
  const defaultBaseUrl = window.location.protocol === 'file:' ? 'http://localhost:3000' : '';
  const getBaseUrl = () => localStorage.getItem(API_BASE_URL_KEY) || defaultBaseUrl;
  const setBaseUrl = (value) => {
    const trimmed = String(value || '').trim().replace(/\/+$/, '');
    localStorage.setItem(API_BASE_URL_KEY, trimmed);
  };

  const getMode = () => localStorage.getItem(API_MODE_KEY) || DEFAULT_MODE;
  const setMode = (mode) => {
    if (!['auto', 'real', 'mock'].includes(mode)) {
      throw new ApiError(`Unsupported API mode: ${mode}`, { code: 'INVALID_MODE' });
    }
    localStorage.setItem(API_MODE_KEY, mode);
  };

  const getToken = () => localStorage.getItem(API_TOKEN_KEY) || '';
  const setToken = (token) => localStorage.setItem(API_TOKEN_KEY, token);
  const clearToken = () => localStorage.removeItem(API_TOKEN_KEY);

  const parseErrorPayload = async (response) => {
    try {
      return await response.json();
    } catch (error) {
      return {};
    }
  };

  const resolveUrl = (pathname) => {
    const base = getBaseUrl();
    if (!base) return pathname;
    if (/^https?:\/\//i.test(pathname)) return pathname;
    return `${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  };

  const requestJson = async (pathname, options = {}) => {
    const headers = {
      ...(options.headers || {}),
    };
    if (options.auth !== false) {
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (options.body != null) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(resolveUrl(pathname), {
        method: options.method || 'GET',
        headers,
        body: options.body != null ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      throw new ApiError('Could not reach backend API. Check Backend URL and server status.', {
        code: 'NETWORK_UNREACHABLE',
      });
    }

    if (!response.ok) {
      const payload = await parseErrorPayload(response);
      throw new ApiError(payload.error || `Request failed with status ${response.status}`, {
        code: payload.code || (response.status === 401 ? 'UNAUTHORIZED' : 'API_ERROR'),
        status: response.status,
        data: payload,
      });
    }

    return response.json();
  };

  const requestBlob = async (pathname, options = {}) => {
    const headers = {
      ...(options.headers || {}),
    };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(resolveUrl(pathname), {
        method: options.method || 'GET',
        headers,
      });
    } catch (error) {
      throw new ApiError('Could not reach backend API. Check Backend URL and server status.', {
        code: 'NETWORK_UNREACHABLE',
      });
    }

    if (!response.ok) {
      const payload = await parseErrorPayload(response);
      throw new ApiError(payload.error || `Request failed with status ${response.status}`, {
        code: payload.code || (response.status === 401 ? 'UNAUTHORIZED' : 'API_ERROR'),
        status: response.status,
        data: payload,
      });
    }

    return response.blob();
  };

  const mock = {
    async login() {
      const token = `mock-token-${Math.random().toString(36).slice(2)}`;
      setToken(token);
      return { token, expiresInSeconds: 86400, mode: 'mock' };
    },
    async health() {
      return { ok: true, mode: 'mock', service: 'project-planner-mock', timestamp: nowIso() };
    },
    async getPlanner() {
      const store = readMockStore();
      return { state: clone(store.state || {}), version: store.version, updatedAt: store.updatedAt, source: 'mock' };
    },
    async savePlanner(state, expectedVersion, force = false) {
      const store = readMockStore();
      if (!force && store.version !== Number(expectedVersion ?? 0)) {
        throw new ApiError('Version conflict detected while saving mock data.', {
          code: 'VERSION_CONFLICT',
          status: 409,
          data: {
            code: 'VERSION_CONFLICT',
            server: { state: store.state || {}, version: store.version, updatedAt: store.updatedAt },
          },
        });
      }

      const next = {
        state: clone(state || {}),
        version: (Number(store.version) || 0) + 1,
        updatedAt: nowIso(),
      };
      writeMockStore(next);
      return { ok: true, saved: true, version: next.version, updatedAt: next.updatedAt, source: 'mock' };
    },
    async exportExcel() {
      throw new ApiError('Excel export requires real API mode and a running backend.', {
        code: 'EXCEL_REAL_MODE_REQUIRED',
      });
    },
    async exportExcelTemplate() {
      throw new ApiError('Excel template export requires real API mode and a running backend.', {
        code: 'EXCEL_REAL_MODE_REQUIRED',
      });
    },
    async importExcel() {
      throw new ApiError('Excel import requires real API mode and a running backend.', {
        code: 'EXCEL_REAL_MODE_REQUIRED',
      });
    },
  };

  const shouldFallbackToMock = (mode, error) => {
    if (mode !== 'auto') return false;
    return error instanceof ApiError && error.code === 'NETWORK_UNREACHABLE';
  };

  const withMode = async (realCall, mockCall) => {
    const mode = getMode();
    if (mode === 'mock') return mockCall();

    try {
      return await realCall();
    } catch (error) {
      if (shouldFallbackToMock(mode, error)) return mockCall();
      throw error;
    }
  };

  return {
    getMode,
    setMode,
    getBaseUrl,
    setBaseUrl,
    hasToken() {
      return Boolean(getToken());
    },
    logout() {
      clearToken();
    },
    async login(username, password) {
      return withMode(
        async () => {
          const payload = await requestJson('/api/auth/login', {
            method: 'POST',
            auth: false,
            body: { username, password },
          });
          setToken(payload.token);
          return payload;
        },
        async () => mock.login(username, password),
      );
    },
    async health() {
      return withMode(
        async () => requestJson('/api/health', { auth: false }),
        async () => mock.health(),
      );
    },
    async getPlanner() {
      return withMode(
        async () => requestJson('/api/planner'),
        async () => mock.getPlanner(),
      );
    },
    async savePlanner(state, expectedVersion, force = false) {
      return withMode(
        async () => requestJson('/api/planner', {
          method: 'POST',
          body: { state, expectedVersion, force },
        }),
        async () => mock.savePlanner(state, expectedVersion, force),
      );
    },
    async exportExcel() {
      const mode = getMode();
      if (mode === 'mock') return mock.exportExcel();
      return requestBlob('/api/planner/export.xlsx');
    },
    async exportExcelTemplate() {
      const mode = getMode();
      if (mode === 'mock') return mock.exportExcelTemplate();
      return requestBlob('/api/planner/template.xlsx');
    },
    async importExcel(fileBase64, expectedVersion, force = false) {
      const mode = getMode();
      if (mode === 'mock') return mock.importExcel();
      return requestJson('/api/planner/import.xlsx', {
        method: 'POST',
        body: { fileBase64, expectedVersion, force },
      });
    },
  };
}
