import { put, list, del } from '@vercel/blob';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const PREFIX = 'pos-specs/';

function bankToPath(bank: string) {
  return `${PREFIX}${bank}.json`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    // GET without bank → return list of available banks
    if (req.method === 'GET' && !req.query.bank) {
      const { blobs } = await list({ prefix: PREFIX });
      const banks = blobs
        .map((b) => b.pathname.replace(PREFIX, '').replace('.json', ''))
        .filter(Boolean)
        .sort();
      return res.status(200).json({ banks });
    }

    // GET with bank → return specs for that bank
    if (req.method === 'GET' && req.query.bank) {
      const bank = String(req.query.bank).trim();
      const { blobs } = await list({ prefix: bankToPath(bank) });
      if (!blobs[0]) return res.status(404).json({ error: `找不到 ${bank} 的規格` });
      const r = await fetch(blobs[0].url);
      const specs = await r.json();
      return res.status(200).json(specs);
    }

    // PUT with bank → save specs for that bank
    if (req.method === 'PUT' && req.query.bank) {
      const bank = String(req.query.bank).trim();
      if (!bank) return res.status(400).json({ error: '缺少 bank 參數' });
      const specs = req.body;
      if (!specs || typeof specs !== 'object') {
        return res.status(400).json({ error: '無效的規格資料' });
      }
      await put(bankToPath(bank), JSON.stringify(specs), {
        access: 'public',
        contentType: 'application/json',
        addRandomSuffix: false,
        allowOverwrite: true,  // 允許覆蓋現有檔案
      });
      return res.status(200).json({ ok: true, bank });
    }

    // DELETE with bank → remove specs for that bank
    if (req.method === 'DELETE' && req.query.bank) {
      const bank = String(req.query.bank).trim();
      const { blobs } = await list({ prefix: bankToPath(bank) });
      if (blobs[0]) await del(blobs[0].url);
      return res.status(200).json({ ok: true, bank });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return res.status(500).json({ error: `Cloud specs error: ${message}` });
  }
}
