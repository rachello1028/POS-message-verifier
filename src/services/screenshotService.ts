import html2canvas from 'html2canvas';

let savedDirHandle: FileSystemDirectoryHandle | null = null;

export function hasSaveDirectory(): boolean {
  return savedDirHandle !== null;
}

export function getSaveDirName(): string {
  return savedDirHandle?.name ?? '';
}

export async function pickSaveDirectory(): Promise<boolean> {
  try {
    savedDirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
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

  const canvas = await html2canvas(cardEl, {
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#020617',
    scale: 2,
    logging: false,
    useCORS: true,
  });

  const blob = await canvasToBlob(canvas);

  if (savedDirHandle) {
    try {
      const fileHandle = await savedDirHandle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
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
  return name;
}
