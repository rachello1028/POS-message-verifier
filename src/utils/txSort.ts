const TX_TYPE_ORDER = [
  '銷售', '一般銷售',
  '取消銷售', '取消',
  '退貨',
  '取消退貨',
  '退款',
  '預先授權', '預授權',
  '預先授權完成', '預授權完成', '預授權請款',
  '授權',
  '離線銷售', '離線交易',
  '補登',
  '銷售完成',
  '小費', '調帳', '小費調帳',
  '分期',
  '紅利折抵',
  '沖正',
  '批上送',
  '結帳',
  '銷售查詢', '查詢', '餘額查詢',
  '帳號驗證',
  '簽到', '維護',
  '更換', '參數下載',
];

const ENTRY_MODE_ORDER = [
  '刷卡', '晶片', '感應', '手輸', 'FALLBACK',
  '刷卡4DBC', '手輸4DBC', '晶片TC',
];

const TAIL_GROUP_PREFIXES = ['授權通知', 'CHBI', 'FISC', 'MO/TO', 'TW-PAY', 'DCC', 'EDC', 'EC '];

function getGroupOrder(name: string): number {
  if (name.includes('不支援') || name.includes('Not Support')) return 2;
  for (const prefix of TAIL_GROUP_PREFIXES) {
    if (name.startsWith(prefix)) return 1;
  }
  return 0;
}

function getTxTypeOrder(name: string): number {
  for (let i = 0; i < TX_TYPE_ORDER.length; i++) {
    const keyword = TX_TYPE_ORDER[i];
    if (name === keyword || name.startsWith(keyword + '_') || name.startsWith(keyword + ' ')) {
      return i;
    }
  }
  for (let i = 0; i < TX_TYPE_ORDER.length; i++) {
    if (name.includes(TX_TYPE_ORDER[i])) return i;
  }
  return TX_TYPE_ORDER.length;
}

function getEntryModeOrder(name: string): number {
  const afterUnderscore = name.includes('_') ? name.split('_').slice(1).join('_') : '';
  for (let i = 0; i < ENTRY_MODE_ORDER.length; i++) {
    if (afterUnderscore === ENTRY_MODE_ORDER[i]) return i;
  }
  for (let i = 0; i < ENTRY_MODE_ORDER.length; i++) {
    if (name.includes(ENTRY_MODE_ORDER[i])) return i + 0.5;
  }
  return ENTRY_MODE_ORDER.length;
}

export function sortTransactions(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const ga = getGroupOrder(a);
    const gb = getGroupOrder(b);
    if (ga !== gb) return ga - gb;

    const ta = getTxTypeOrder(a);
    const tb = getTxTypeOrder(b);
    if (ta !== tb) return ta - tb;

    const ea = getEntryModeOrder(a);
    const eb = getEntryModeOrder(b);
    if (ea !== eb) return ea - eb;

    return a.localeCompare(b, 'zh-TW');
  });
}
