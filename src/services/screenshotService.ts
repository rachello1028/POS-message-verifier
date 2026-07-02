import html2canvas from 'html2canvas';

let savedDirHandle: FileSystemDirectoryHandle | null = null;

const IDB_NAME = 'pos-screenshot-store';
const IDB_STORE = 'handles';
const IDB_KEY = 'saveDir';

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openIdb();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
    await new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  } catch { /* ignore */ }
}

async function restoreHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openIdb();
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    const handle = await new Promise<FileSystemDirectoryHandle | null>((res, rej) => {
      req.onsuccess = () => res(req.result ?? null);
      req.onerror = () => rej(req.error);
    });
    db.close();
    if (!handle) return null;
    const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
    return perm === 'granted' ? handle : null;
  } catch { return null; }
}

let initDone = false;

export async function initSaveDirectory(): Promise<void> {
  if (initDone) return;
  initDone = true;
  if (savedDirHandle) return;
  savedDirHandle = await restoreHandle();
}

export function hasSaveDirectory(): boolean {
  return savedDirHandle !== null;
}

export function getSaveDirName(): string {
  return savedDirHandle?.name ?? '';
}

export async function pickSaveDirectory(): Promise<boolean> {
  try {
    savedDirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    await persistHandle(savedDirHandle!);
    return true;
  } catch {
    return false;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => {
      if (b) resolve(b);
      else reject(new Error('截圖轉檔失敗'));
    }, 'image/png');
  });
}

export async function captureElement(el: HTMLElement, filename?: string): Promise<void> {
  const canvas = await html2canvas(el, {
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#020617',
    scale: 2,
    logging: false,
    useCORS: true,
  });

  const blob = await canvasToBlob(canvas);
  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 14);
  const name = filename ?? `pos-screenshot-${ts}.png`;

  if (savedDirHandle) {
    try {
      const fileHandle = await savedDirHandle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      console.warn('File System Access 寫入失敗，改用下載:', e);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function autoCaptureTxCard(
  cardEl: HTMLElement,
  bank: string,
  transType: string,
  txId: number
): Promise<string> {
  const now = new Date();
  const ds = now.toISOString().slice(0, 10).replace(/-/g, '');
  const ts = now.toTimeString().slice(0, 8).replace(/:/g, '');
  const name = `${bank}_${transType}_TX${txId}_${ds}_${ts}.png`;

  const root = document.documentElement;
  const wasDark = root.classList.contains('dark');
  if (wasDark) root.classList.remove('dark');
  cardEl.classList.add('capture-compact');

  const detailsEls = cardEl.querySelectorAll<HTMLDetailsElement>('details.raw-log-details');
  detailsEls.forEach(d => d.setAttribute('open', ''));

  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  const bgColor = getComputedStyle(root).getPropertyValue('--canvas').trim() || '#f8fafc';
  const captureOpts = { backgroundColor: bgColor, scale: 2, logging: false, useCORS: true };

  const canvas = await html2canvas(cardEl, captureOpts);

  // 額外截取原始電文 log
  const logEl = cardEl.querySelector<HTMLElement>('details.raw-log-details pre');
  let logCanvas: HTMLCanvasElement | null = null;
  if (logEl) {
    logCanvas = await html2canvas(logEl, captureOpts);
  }

  detailsEls.forEach(d => d.removeAttribute('open'));
  cardEl.classList.remove('capture-compact');
  if (wasDark) root.classList.add('dark');

  const blob = await canvasToBlob(canvas);
  const logBlob = logCanvas ? await canvasToBlob(logCanvas) : null;
  const logName = `${bank}_${transType}_TX${txId}_log_${ds}_${ts}.png`;

  if (savedDirHandle) {
    try {
      const fileHandle = await savedDirHandle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      if (logBlob) {
        const logFileHandle = await savedDirHandle.getFileHandle(logName, { create: true });
        const logWritable = await logFileHandle.createWritable();
        await logWritable.write(logBlob);
        await logWritable.close();
      }
      return name;
    } catch (e) {
      console.warn('自動截圖寫入失敗:', e);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (logBlob) {
    const logUrl = URL.createObjectURL(logBlob);
    const la = document.createElement('a');
    la.href = logUrl;
    la.download = logName;
    document.body.appendChild(la);
    la.click();
    document.body.removeChild(la);
    URL.revokeObjectURL(logUrl);
  }
  return name;
}
