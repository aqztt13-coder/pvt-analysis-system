/**
 * Client-side API helper holding the Bearer session token strictly in JS memory
 * (never in localStorage or sessionStorage).
 */
let memoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
  } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'PVT-Admin-Client',
  };
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let message = 'تعذر إتمام الطلب. يرجى التحقق من البيانات والمحاولة مجدداً.';
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore non-JSON errors
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export async function uploadFileToServer(
  file: File,
  moduleName: string
): Promise<{ id: number; originalName: string; sizeBytes: number; mimeType: string }> {
  const form = new FormData();
  form.append('file', file);
  form.append('module', moduleName);

  const headers: Record<string, string> = {
    'X-Requested-With': 'PVT-Admin-Client',
  };
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }

  const res = await fetch('/api/files/upload', {
    method: 'POST',
    headers,
    body: form,
  });

  if (!res.ok) {
    let message = 'فشل رفع الملف.';
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    throw new ApiError(message, res.status);
  }

  return res.json();
}

export async function downloadProtectedFile(urlPath: string, fallbackFilename: string): Promise<void> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'PVT-Admin-Client',
  };
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }

  const res = await fetch(`/api${urlPath}`, { headers });
  if (!res.ok) {
    let msg = 'تعذر تنزيل الملف المطلوب.';
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new ApiError(msg, res.status);
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fallbackFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}

export async function fetchProtectedPreviewUrl(fileId: number): Promise<string> {
  const headers: Record<string, string> = {
    'X-Requested-With': 'PVT-Admin-Client',
  };
  if (memoryToken) {
    headers.Authorization = `Bearer ${memoryToken}`;
  }
  const res = await fetch(`/api/files/${fileId}/download?inline=1`, { headers });
  if (!res.ok) {
    throw new ApiError('تعذر معاينة الملف.', res.status);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
