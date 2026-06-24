import html2canvas from 'html2canvas';

export async function captureElement(el: HTMLElement, filename?: string): Promise<void> {
  const canvas = await html2canvas(el, {
    backgroundColor: '#020617',
    scale: 2,
    logging: false,
    useCORS: true,
  });

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => {
      if (b) resolve(b);
      else reject(new Error('截圖失敗'));
    }, 'image/png');
  });

  const ts = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 14);
  const name = filename ?? `pos-screenshot-${ts}.png`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
