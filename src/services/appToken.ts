/**
 * 雲端寫入（儲存／刪除規格、腳本）要帶「團隊存取碼」，伺服器會比對 Vercel 環境變數 APP_WRITE_TOKEN。
 * 存取碼只存在這台瀏覽器；第一次寫入或存取碼錯誤時會跳出輸入框。
 */
const STORAGE_KEY = 'app-write-token';

function readToken(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 隱私模式寫不進去，就每次重新詢問 */
  }
}

/** 跟 fetch 一樣，但會帶 X-App-Token；收到 401 時請使用者輸入存取碼後重試一次 */
export async function fetchWithAppToken(url: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('X-App-Token', token);
    return fetch(url, { ...init, headers });
  };
  let res = await send(readToken());
  if (res.status !== 401) return res;
  const input = window.prompt('請輸入團隊存取碼（儲存或刪除雲端資料需要）');
  if (!input) return res;
  const token = input.trim();
  res = await send(token);
  writeToken(res.status === 401 ? null : token);
  return res;
}
