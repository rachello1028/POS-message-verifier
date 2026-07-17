#!/usr/bin/env python3
"""
POS Host Simulator — 模擬銀行後台
接收 POS 端末機 ISO 8583 電文，依規格自動生成回應。

使用方式:
    pip install websockets
    python host_simulator.py                    # 預設 TCP 8000 / WS 8001
    python host_simulator.py --port 8000        # 自訂 TCP port
    python host_simulator.py --ws-port 8001     # 自訂 WebSocket port
    python host_simulator.py --response-code 05 # 預設回應碼改為拒絕
"""

import asyncio
import json
import os
import re
import socket
import struct
import random
import string
import argparse
import traceback
from datetime import datetime
from pathlib import Path

try:
    import websockets
except ImportError:
    websockets = None


# ═══════════════════════════════════════════════════════════════════════════════
#  ISO 8583 欄位定義表
# ═══════════════════════════════════════════════════════════════════════════════
#  格式: field_number: (data_type, length_type, max_length, name)
#    data_type:   'n' = numeric(BCD), 'an' = alphanumeric(ASCII),
#                 'ans' = alpha+special(ASCII), 'b' = binary, 'z' = track
#    length_type: 'FIXED' / 'LLVAR' / 'LLLVAR'
#    max_length:  最大長度（FIXED = 實際長度）

FIELD_DEFS = {
    2:  ('n',   'LLVAR',  19, 'Primary Account Number'),
    3:  ('n',   'FIXED',   6, 'Processing Code'),
    4:  ('n',   'FIXED',  12, 'Amount, Transaction'),
    5:  ('n',   'FIXED',  12, 'Amount, Settlement'),
    6:  ('n',   'FIXED',  12, 'Amount, Cardholder Billing'),
    7:  ('n',   'FIXED',  10, 'Transmission Date & Time'),
    8:  ('n',   'FIXED',   8, 'Amount, Cardholder Billing Fee'),
    9:  ('n',   'FIXED',   8, 'Conversion Rate, Settlement'),
    10: ('n',   'FIXED',   8, 'Conversion Rate, Cardholder Billing'),
    11: ('n',   'FIXED',   6, 'System Trace Audit Number'),
    12: ('n',   'FIXED',   6, 'Time, Local Transaction'),
    13: ('n',   'FIXED',   4, 'Date, Local Transaction'),
    14: ('n',   'FIXED',   4, 'Date, Expiration'),
    15: ('n',   'FIXED',   4, 'Date, Settlement'),
    16: ('n',   'FIXED',   4, 'Date, Conversion'),
    22: ('n',   'FIXED',   4, 'Point of Service Entry Mode'),
    23: ('n',   'FIXED',   3, 'Card Sequence Number'),
    24: ('n',   'FIXED',   3, 'Network International Identifier'),
    25: ('n',   'FIXED',   2, 'Point of Service Condition Code'),
    26: ('n',   'FIXED',   2, 'Point of Service Capture Code'),
    27: ('n',   'FIXED',   2, 'Authorization ID Response Length'),
    28: ('an',  'FIXED',   9, 'Amount, Transaction Fee'),
    32: ('n',   'LLVAR',  11, 'Acquiring Institution ID'),
    35: ('z',   'LLVAR',  37, 'Track II Data'),
    37: ('an',  'FIXED',  12, 'Retrieval Reference Number'),
    38: ('an',  'FIXED',   6, 'Authorization Identification Response'),
    39: ('an',  'FIXED',   2, 'Response Code'),
    41: ('ans', 'FIXED',   8, 'Card Acceptor Terminal ID'),
    42: ('ans', 'FIXED',  15, 'Card Acceptor ID Code'),
    43: ('ans', 'FIXED',  40, 'Card Acceptor Name/Location'),
    44: ('an',  'LLVAR',  25, 'Additional Response Data'),
    45: ('an',  'LLVAR',  76, 'Track I Data'),
    48: ('ans', 'LLLVAR', 999, 'Additional Private Data'),
    49: ('n',   'FIXED',   3, 'Currency Code, Transaction'),
    50: ('n',   'FIXED',   3, 'Currency Code, Settlement'),
    51: ('n',   'FIXED',   3, 'Currency Code, Billing'),
    52: ('b',   'FIXED',   8, 'PIN Block'),  # 8 bytes binary
    54: ('an',  'LLLVAR', 120, 'Additional Amounts'),
    55: ('b',   'LLLVAR', 999, 'ICC/EMV Data'),
    56: ('ans', 'LLLVAR', 999, 'Reserved Private'),
    57: ('ans', 'LLLVAR', 999, 'Reserved National'),
    58: ('ans', 'LLLVAR', 999, 'Reserved National'),
    59: ('ans', 'LLLVAR', 999, 'Reserved Private'),
    60: ('ans', 'LLLVAR', 999, 'Reserved Private'),
    61: ('ans', 'LLLVAR', 999, 'Reserved Private'),
    62: ('ans', 'LLLVAR', 999, 'Reserved Private'),
    63: ('ans', 'LLLVAR', 999, 'Reserved Private'),
    64: ('b',   'FIXED',   8, 'MAC'),
    70: ('n',   'FIXED',   3, 'Network Management Information Code'),
    90: ('n',   'FIXED',  42, 'Original Data Elements'),
    95: ('an',  'FIXED',  42, 'Replacement Amounts'),
    100: ('n',  'LLVAR',  11, 'Receiving Institution ID'),
    128: ('b',  'FIXED',   8, 'MAC 2'),
}


# ═══════════════════════════════════════════════════════════════════════════════
#  BCD / ASCII 編解碼工具
# ═══════════════════════════════════════════════════════════════════════════════

def bcd_encode(digits: str) -> bytes:
    if len(digits) % 2:
        digits = '0' + digits
    out = bytearray()
    for i in range(0, len(digits), 2):
        out.append(int(digits[i:i+2], 16))
    return bytes(out)


def bcd_decode(data: bytes, num_digits: int) -> str:
    s = data.hex().upper()
    if len(s) > num_digits:
        s = s[-num_digits:]
    return s


def ascii_encode(text: str, length: int, pad_char: str = ' ') -> bytes:
    return text.ljust(length, pad_char)[:length].encode('ascii', errors='replace')


# ═══════════════════════════════════════════════════════════════════════════════
#  ISO 8583 解析器
# ═══════════════════════════════════════════════════════════════════════════════

class Iso8583Message:
    """ISO 8583 訊息：解析 + 組包"""

    def __init__(self):
        self.tpdu: bytes = b''
        self.mti: str = ''
        self.fields: dict[int, str] = {}
        self.raw_fields: dict[int, bytes] = {}

    # ── 解析 ────────────────────────────────────────────────────────────────

    @classmethod
    def parse(cls, data: bytes, has_tpdu: bool = True,
              mti_encoding: str = 'bcd') -> 'Iso8583Message':
        msg = cls()
        pos = 0

        # TPDU (5 bytes)
        if has_tpdu:
            msg.tpdu = data[pos:pos+5]
            pos += 5

        # MTI
        if mti_encoding == 'bcd':
            msg.mti = bcd_decode(data[pos:pos+2], 4)
            pos += 2
        else:
            msg.mti = data[pos:pos+4].decode('ascii')
            pos += 4

        # Bitmap
        bitmap_bytes = data[pos:pos+8]
        pos += 8
        bitmap = int.from_bytes(bitmap_bytes, 'big')

        # 若 bit 1 為 1，有 secondary bitmap
        has_secondary = bool(bitmap & (1 << 63))
        if has_secondary:
            secondary_bytes = data[pos:pos+8]
            pos += 8
            secondary = int.from_bytes(secondary_bytes, 'big')
        else:
            secondary = 0

        # 解析各欄位
        for bit in range(2, 129):
            if bit <= 64:
                present = bool(bitmap & (1 << (64 - bit)))
            else:
                present = bool(secondary & (1 << (128 - bit)))

            if not present:
                continue

            fdef = FIELD_DEFS.get(bit)
            if not fdef:
                print(f"  [WARN] 未定義的欄位 {bit}，跳過")
                break

            dtype, ltype, max_len, _ = fdef

            try:
                if ltype == 'FIXED':
                    if dtype == 'b':
                        flen = max_len
                        raw = data[pos:pos+flen]
                        pos += flen
                        msg.raw_fields[bit] = raw
                        msg.fields[bit] = raw.hex().upper()
                    elif dtype == 'n':
                        byte_len = (max_len + 1) // 2
                        raw = data[pos:pos+byte_len]
                        pos += byte_len
                        msg.fields[bit] = bcd_decode(raw, max_len)
                    else:
                        flen = max_len
                        raw = data[pos:pos+flen]
                        pos += flen
                        msg.fields[bit] = raw.decode('ascii', errors='replace').rstrip()
                elif ltype == 'LLVAR':
                    ll = bcd_decode(data[pos:pos+1], 2)
                    flen = int(ll)
                    pos += 1
                    if dtype in ('n', 'z'):
                        byte_len = (flen + 1) // 2
                        raw = data[pos:pos+byte_len]
                        pos += byte_len
                        msg.fields[bit] = bcd_decode(raw, flen)
                    else:
                        raw = data[pos:pos+flen]
                        pos += flen
                        msg.fields[bit] = raw.decode('ascii', errors='replace')
                elif ltype == 'LLLVAR':
                    lll = bcd_decode(data[pos:pos+2], 4)
                    flen = int(lll)
                    pos += 2
                    if dtype == 'b':
                        raw = data[pos:pos+flen]
                        pos += flen
                        msg.raw_fields[bit] = raw
                        msg.fields[bit] = raw.hex().upper()
                    elif dtype == 'n':
                        byte_len = (flen + 1) // 2
                        raw = data[pos:pos+byte_len]
                        pos += byte_len
                        msg.fields[bit] = bcd_decode(raw, flen)
                    else:
                        raw = data[pos:pos+flen]
                        pos += flen
                        msg.fields[bit] = raw.decode('ascii', errors='replace')
            except Exception as e:
                print(f"  [WARN] 解析 Field {bit} 失敗 (pos={pos}): {e}")
                break

        return msg

    # ── 組包 ────────────────────────────────────────────────────────────────

    def build(self, has_tpdu: bool = True,
              mti_encoding: str = 'bcd') -> bytes:
        parts = bytearray()

        # TPDU
        if has_tpdu:
            if self.tpdu:
                # 回應時交換 TPDU 的 source/destination
                tpdu = bytearray(self.tpdu)
                if len(tpdu) == 5:
                    tpdu[1:3], tpdu[3:5] = tpdu[3:5], tpdu[1:3]
                parts.extend(tpdu)
            else:
                parts.extend(b'\x60\x00\x00\x00\x00')

        # MTI
        if mti_encoding == 'bcd':
            parts.extend(bcd_encode(self.mti))
        else:
            parts.extend(self.mti.encode('ascii'))

        # 組欄位資料 + bitmap
        bitmap = 0
        secondary = 0
        field_data = bytearray()

        for bit in sorted(self.fields.keys()):
            if bit < 2 or bit > 128:
                continue

            fdef = FIELD_DEFS.get(bit)
            if not fdef:
                continue

            dtype, ltype, max_len, _ = fdef
            val = self.fields[bit]

            if bit <= 64:
                bitmap |= (1 << (64 - bit))
            else:
                secondary |= (1 << (128 - bit))
                bitmap |= (1 << 63)  # 標記有 secondary bitmap

            if ltype == 'FIXED':
                if dtype == 'b':
                    if bit in self.raw_fields:
                        field_data.extend(self.raw_fields[bit])
                    else:
                        raw = bytes.fromhex(val)
                        field_data.extend(raw.ljust(max_len, b'\x00')[:max_len])
                elif dtype == 'n':
                    padded = val.zfill(max_len)[:max_len]
                    field_data.extend(bcd_encode(padded))
                else:
                    field_data.extend(ascii_encode(val, max_len))
            elif ltype == 'LLVAR':
                if dtype in ('n', 'z'):
                    flen = len(val)
                    field_data.extend(bcd_encode(str(flen).zfill(2)))
                    padded = val if len(val) % 2 == 0 else val + '0'
                    field_data.extend(bcd_encode(padded))
                else:
                    encoded = val.encode('ascii', errors='replace')
                    flen = len(encoded)
                    field_data.extend(bcd_encode(str(flen).zfill(2)))
                    field_data.extend(encoded)
            elif ltype == 'LLLVAR':
                if dtype == 'b':
                    if bit in self.raw_fields:
                        raw = self.raw_fields[bit]
                    else:
                        raw = bytes.fromhex(val)
                    flen = len(raw)
                    field_data.extend(bcd_encode(str(flen).zfill(4)))
                    field_data.extend(raw)
                elif dtype == 'n':
                    flen = len(val)
                    field_data.extend(bcd_encode(str(flen).zfill(4)))
                    padded = val if len(val) % 2 == 0 else val + '0'
                    field_data.extend(bcd_encode(padded))
                else:
                    encoded = val.encode('ascii', errors='replace')
                    flen = len(encoded)
                    field_data.extend(bcd_encode(str(flen).zfill(4)))
                    field_data.extend(encoded)

        # 寫入 bitmap
        parts.extend(bitmap.to_bytes(8, 'big'))
        if bitmap & (1 << 63):
            parts.extend(secondary.to_bytes(8, 'big'))

        parts.extend(field_data)
        return bytes(parts)

    def summary(self) -> str:
        f3 = self.fields.get(3, '?')
        f4 = self.fields.get(4, '?')
        f39 = self.fields.get(39, '?')
        f41 = self.fields.get(41, '?')
        return f"MTI={self.mti} PC={f3} AMT={f4} RC={f39} TID={f41}"


# ═══════════════════════════════════════════════════════════════════════════════
#  規格匹配 + 回應生成
# ═══════════════════════════════════════════════════════════════════════════════

class ResponseGenerator:
    """根據 rules/ 規格和 request 電文生成回應"""

    def __init__(self, rules: dict, default_response_code: str = '00',
                 response_profiles: dict = None):
        self.rules = rules
        self.default_rc = default_response_code
        self.response_profiles = response_profiles or {}
        self.active_bank: str | None = None  # 指定使用哪家銀行規格回應
        self.auth_counter = random.randint(100000, 999999)
        self.rrn_counter = random.randint(100000000000, 999999999999)
        self.overrides: dict[str, str] = {}
        self.field_overrides: dict[str, str] = {}
        self.timeout_mode: str = 'none'
        self.timeout_count: int = 0
        self.tx_since_timeout: int = 0

    def _next_auth_code(self) -> str:
        self.auth_counter += 1
        if self.auth_counter > 999999:
            self.auth_counter = 100000
        return str(self.auth_counter)

    def _next_rrn(self) -> str:
        self.rrn_counter += 1
        if self.rrn_counter > 999999999999:
            self.rrn_counter = 100000000000
        return str(self.rrn_counter)

    def should_timeout(self) -> bool:
        if self.timeout_mode == 'none':
            return False
        if self.timeout_mode == 'all':
            return True
        if self.timeout_mode == 'next':
            if self.timeout_count > 0:
                self.timeout_count -= 1
                return True
            self.timeout_mode = 'none'
            return False
        if self.timeout_mode == 'random':
            return random.random() < 0.3
        return False

    def _is_concrete_expected(self, exp: str) -> bool:
        """判斷 expected 值是否為具體比對值（非 NOT_NULL 等通配符）"""
        if not exp:
            return False
        if exp in ('NOT_NULL', 'MUST_EXIST', 'MUST_NOT_EXIST'):
            return False
        if exp.startswith('IF_EXIST:'):
            return False
        return True

    def _score_rule(self, rule_fields: list, fields: dict[int, str]) -> int:
        """計算規則與實際欄位的匹配分數（具體值吻合 +1，不吻合 -100）"""
        score = 0
        for f in rule_fields:
            fid_str = str(f.get('id', ''))
            if not fid_str.startswith('REQ_'):
                continue
            try:
                fid = int(fid_str[4:])
            except ValueError:
                continue
            exp = f.get('expected', '')
            if not self._is_concrete_expected(exp):
                continue
            actual = fields.get(fid, '')
            if exp.startswith('REGEX:'):
                pattern = exp[6:]
                if actual and re.match(pattern, actual):
                    score += 1
                else:
                    score -= 100
            elif actual == exp:
                score += 1
            else:
                score -= 100
        return score

    def match_rule(self, mti: str, fields: dict[int, str]) -> tuple:
        """依 MTI + 欄位匹配規格，回傳 (bank, tx_name, rule)
        先篩 MTI + PC，再用 F22 等具體欄位值計算匹配分數，分數最高者勝出。
        """
        pc = fields.get(3, '')

        search_banks = self.rules.items()
        if self.active_bank and self.active_bank in self.rules:
            search_banks = [(self.active_bank, self.rules[self.active_bank])]

        candidates = []

        for bank_name, bank_rules in search_banks:
            for tx_name, tx_config in bank_rules.items():
                steps = tx_config.get('steps', [])
                for step in steps:
                    if step.get('mti', '') != mti:
                        continue

                    rule_fields = step.get('fields', [])

                    rule_pc = None
                    for f in rule_fields:
                        if str(f.get('id', '')) == 'REQ_3':
                            exp = f.get('expected', '')
                            if self._is_concrete_expected(exp):
                                rule_pc = exp
                            break

                    if rule_pc and pc and rule_pc != pc:
                        continue

                    pc_match = 1 if (rule_pc and rule_pc == pc) else 0
                    field_score = self._score_rule(rule_fields, fields)

                    candidates.append((
                        pc_match, field_score,
                        bank_name, tx_name, step
                    ))

        if not candidates:
            return (None, None, None)

        candidates.sort(key=lambda c: (c[0], c[1]), reverse=True)
        best = candidates[0]
        return (best[2], best[3], best[4])

    def generate_response(self, req: Iso8583Message) -> Iso8583Message:
        """依 request 生成 response（使用 response profile 或通用邏輯）"""
        resp = Iso8583Message()
        resp.tpdu = req.tpdu

        # Response MTI
        req_mti = req.mti
        default_mti_map = {
            '0100': '0110', '0200': '0210', '0220': '0230',
            '0300': '0310', '0320': '0330',
            '0400': '0410', '0420': '0430',
            '0500': '0510', '0800': '0810',
        }

        bank, tx_name, rule = self.match_rule(req_mti, req.fields)

        # 決定使用哪個 profile
        profile_bank = self.active_bank or bank
        profile = self.response_profiles.get(profile_bank)

        # 取得 MTI mapping
        if profile and 'mti_map' in profile:
            resp.mti = profile['mti_map'].get(req_mti,
                       default_mti_map.get(req_mti,
                       str(int(req_mti) + 10).zfill(4)))
        else:
            resp.mti = default_mti_map.get(req_mti,
                       str(int(req_mti) + 10).zfill(4))

        # 決定回應碼
        override_key = f"{bank}|{tx_name}" if bank else None
        if override_key and override_key in self.overrides:
            rc = self.overrides[override_key]
        else:
            rc = self.default_rc

        now = datetime.now()

        # === 使用 response profile 生成回應 ===
        if profile and 'response_rules' in profile:
            rules_set = profile['response_rules']
            # 優先找 MTI 專屬規則，否則用 default
            rr = rules_set.get(req_mti, rules_set.get('default', {}))

            # Echo fields
            for fid in rr.get('echo', []):
                if fid in req.fields:
                    resp.fields[fid] = req.fields[fid]
                    if fid in req.raw_fields:
                        resp.raw_fields[fid] = req.raw_fields[fid]

            # Generate fields
            for fid_str, gen_type in rr.get('generate', {}).items():
                fid = int(fid_str)
                if gen_type == 'time':
                    resp.fields[fid] = now.strftime('%H%M%S')
                elif gen_type == 'date':
                    resp.fields[fid] = now.strftime('%m%d')
                elif gen_type == 'year_date':
                    resp.fields[fid] = now.strftime('%m%d')
                elif gen_type == 'rrn':
                    resp.fields[fid] = req.fields.get(37, self._next_rrn())
                elif gen_type == 'auth_code':
                    resp.fields[fid] = self._next_auth_code()
                elif gen_type == 'response_code':
                    resp.fields[fid] = rc

            # Conditional fields
            for fid_str, cond_type in rr.get('conditional', {}).items():
                fid = int(fid_str)
                if cond_type == 'echo_if_present':
                    if fid in req.fields:
                        resp.fields[fid] = req.fields[fid]
                        if fid in req.raw_fields:
                            resp.raw_fields[fid] = req.raw_fields[fid]
                elif cond_type == 'emv_response':
                    if fid in req.fields:
                        # 模擬 EMV 回應：Tag 8A (ARC)
                        resp.fields[fid] = '8A023030'
                        resp.raw_fields[fid] = bytes.fromhex('8A023030')

        else:
            # === Fallback: 通用回應邏輯（無 profile 時）===
            echo_fields = [2, 3, 4, 11, 14, 41, 42, 49]
            for fid in echo_fields:
                if fid in req.fields:
                    resp.fields[fid] = req.fields[fid]
                    if fid in req.raw_fields:
                        resp.raw_fields[fid] = req.raw_fields[fid]

            resp.fields[12] = now.strftime('%H%M%S')
            resp.fields[13] = now.strftime('%m%d')
            resp.fields[37] = req.fields.get(37, self._next_rrn())
            resp.fields[38] = self._next_auth_code()
            resp.fields[39] = rc

            if req_mti == '0800' and 59 not in req.fields:
                resp.fields[59] = '0' * 32

            if 54 in req.fields:
                resp.fields[54] = req.fields[54]
            if 55 in req.fields:
                resp.fields[55] = '8A023030'
                resp.raw_fields[55] = bytes.fromhex('8A023030')

            if 60 in req.fields:
                resp.fields[60] = req.fields[60]
            if 62 in req.fields:
                resp.fields[62] = req.fields[62]

            if req_mti == '0500':
                resp.fields[63] = req.fields.get(63, '000000000000')

        # GP 分期回應：在 F63 追加 Table 31（分期資料）+ Table 32（手續費）
        if profile_bank == 'GP' and 63 in req.fields and 4 in req.fields:
            f63_req = req.fields[63]
            idx = f63_req.find('10')
            if idx >= 0 and idx + 12 <= len(f63_req) and f63_req[idx+2:idx+12].isdigit():
                merch_num = f63_req[idx+2:idx+12]
                pppp = merch_num[6:10]
                period = int(pppp[:2])
                if period > 0:
                    try:
                        amount_yuan = int(req.fields[4]) // 100
                    except ValueError:
                        amount_yuan = 0
                    if amount_yuan > 0:
                        monthly = amount_yuan // period
                        first = amount_yuan - monthly * (period - 1)
                        monthly_str = str(monthly).zfill(9)
                        duration_str = str(period).zfill(3)
                        first_str = str(first).zfill(9)
                        t31 = chr(0x00) + chr(0x33) + '31' + merch_num + monthly_str + duration_str + first_str
                        t32 = chr(0x00) + chr(0x09) + '32' + '0000000'
                        base_f63 = resp.fields.get(63, f63_req)
                        resp.fields[63] = base_f63 + t31 + t32
                        if 63 in resp.raw_fields:
                            del resp.raw_fields[63]

        # 台新TSB 分期回應：F63 填入分期計算資料 (64 bytes)
        if profile_bank == '台新TSB' and req.fields.get(27) == '02' and 4 in req.fields:
            try:
                amount_cents = int(req.fields[4])
            except ValueError:
                amount_cents = 0
            if amount_cents > 0:
                period = 3
                req_f63 = req.fields.get(63, '')
                if len(req_f63) >= 2 and req_f63[:2].isdigit() and int(req_f63[:2]) > 0:
                    period = int(req_f63[:2])
                monthly_cents = amount_cents // period
                first_cents = amount_cents - monthly_cents * (period - 1)
                resp.fields[63] = (
                    str(period).zfill(2) +
                    str(first_cents).zfill(12) +
                    str(monthly_cents).zfill(12) +
                    '0' * 12 +  # 手續費
                    '0' * 12 +  # 首期手續費
                    '0' * 12 +  # 每期手續費
                    '00'        # Filler
                )
                if 63 in resp.raw_fields:
                    del resp.raw_fields[63]

        # 台新TSB 紅利回應：F56 填入點數折抵資料 (51 bytes)
        if profile_bank == '台新TSB' and req.fields.get(27) == '01' and 4 in req.fields:
            try:
                amount_cents = int(req.fields[4])
            except ValueError:
                amount_cents = 0
            if amount_cents > 0:
                amount_yuan = amount_cents // 100
                order_no = resp.fields.get(37, '000000000000')[:12].ljust(12)
                resp.fields[56] = (
                    'Y' +
                    order_no +
                    str(amount_yuan).zfill(7) +   # 折抵點數（模擬 1:1）
                    str(amount_cents).zfill(12) +  # 折抵金額
                    '0' * 12 +                     # 實付金額（全額折抵）
                    '0099999'                      # 剩餘點數
                )
                if 56 in resp.raw_fields:
                    del resp.raw_fields[56]

        # 全域欄位覆蓋（Web UI 設定的）
        for fid_str, val in self.field_overrides.items():
            try:
                fid = int(fid_str)
                resp.fields[fid] = val
            except ValueError:
                pass

        return resp


# ═══════════════════════════════════════════════════════════════════════════════
#  規格檔載入
# ═══════════════════════════════════════════════════════════════════════════════

def load_rules(rules_dir: str) -> dict:
    merged = {}
    if not os.path.isdir(rules_dir):
        print(f"[WARN] 規格目錄不存在: {rules_dir}")
        return merged
    for fname in sorted(os.listdir(rules_dir)):
        if not fname.endswith('.json') or fname.startswith('_'):
            continue
        fpath = os.path.join(rules_dir, fname)
        try:
            with open(fpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
                merged.update(data)
        except Exception as e:
            print(f"[WARN] 讀取 {fname} 失敗: {e}")
    return merged


def load_response_profiles(rules_dir: str) -> dict:
    """載入回應欄位定義檔"""
    profile_path = os.path.join(rules_dir, '_response_profiles.json')
    if not os.path.isfile(profile_path):
        print("[INFO] 未找到 _response_profiles.json，使用通用回應")
        return {}
    try:
        with open(profile_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            # 移除 _comment 等非銀行欄位
            return {k: v for k, v in data.items() if not k.startswith('_')}
    except Exception as e:
        print(f"[WARN] 讀取 _response_profiles.json 失敗: {e}")
        return {}


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


# ═══════════════════════════════════════════════════════════════════════════════
#  TCP Server — 主角
# ═══════════════════════════════════════════════════════════════════════════════

class HostSimulator:
    def __init__(self, generator: ResponseGenerator, *,
                 tcp_port: int = 8000,
                 ws_port: int = 8001,
                 has_tpdu: bool = True,
                 mti_encoding: str = 'bcd',
                 length_header: str = '2-bytes-be',
                 response_delay: float = 0.1):
        self.generator = generator
        self.tcp_port = tcp_port
        self.ws_port = ws_port
        self.has_tpdu = has_tpdu
        self.mti_encoding = mti_encoding
        self.length_header = length_header
        self.response_delay = response_delay
        self.ws_clients: set = set()
        self.tx_counter = 0
        self.running = False
        self.last_tx_name: dict[str, str] = {}  # TID → 上一筆主交易名稱

    async def ws_broadcast(self, data: dict):
        if not self.ws_clients:
            return
        msg = json.dumps(data, ensure_ascii=False)
        dead = set()
        for client in self.ws_clients:
            try:
                await client.send(msg)
            except Exception:
                dead.add(client)
        self.ws_clients -= dead

    async def handle_ws_client(self, ws, path=None):
        self.ws_clients.add(ws)
        print(f"[WS] 監控客戶端連入 ({len(self.ws_clients)} 個)")
        await ws.send(json.dumps({
            'type': 'sim_status',
            'status': 'running',
            'tcp_port': self.tcp_port,
            'has_tpdu': self.has_tpdu,
            'mti_encoding': self.mti_encoding,
            'default_rc': self.generator.default_rc,
            'host_ip': get_local_ip(),
            'delay': self.response_delay,
            'timeout_mode': self.generator.timeout_mode,
            'field_overrides': self.generator.field_overrides,
            'active_bank': self.generator.active_bank,
            'available_banks': list(self.generator.response_profiles.keys()),
        }, ensure_ascii=False))
        try:
            async for raw in ws:
                try:
                    data = json.loads(raw)
                    cmd = data.get('command', '')
                    if cmd == 'set_response_code':
                        self.generator.default_rc = data.get('code', '00')
                        await self.ws_broadcast({
                            'type': 'config_updated',
                            'default_rc': self.generator.default_rc
                        })
                        print(f"[SIM] 預設回應碼改為: {self.generator.default_rc}")
                    elif cmd == 'set_override':
                        key = data.get('key', '')
                        code = data.get('code', '')
                        if code:
                            self.generator.overrides[key] = code
                        elif key in self.generator.overrides:
                            del self.generator.overrides[key]
                        await self.ws_broadcast({
                            'type': 'config_updated',
                            'overrides': self.generator.overrides
                        })
                    elif cmd == 'set_delay':
                        self.response_delay = max(0.0, float(data.get('delay', 0.1)))
                        await self.ws_broadcast({
                            'type': 'config_updated',
                            'delay': self.response_delay
                        })
                        print(f"[SIM] 回應延遲改為: {self.response_delay}s")
                    elif cmd == 'set_timeout':
                        mode = data.get('mode', 'none')
                        self.generator.timeout_mode = mode
                        self.generator.timeout_count = int(data.get('count', 1))
                        self.generator.tx_since_timeout = 0
                        await self.ws_broadcast({
                            'type': 'config_updated',
                            'timeout_mode': mode,
                            'timeout_count': self.generator.timeout_count,
                        })
                        print(f"[SIM] Timeout 模式: {mode}")
                    elif cmd == 'set_field_overrides':
                        self.generator.field_overrides = data.get('fields', {})
                        await self.ws_broadcast({
                            'type': 'config_updated',
                            'field_overrides': self.generator.field_overrides,
                        })
                        fo = self.generator.field_overrides
                        print(f"[SIM] 欄位覆蓋: {fo if fo else '(清除)'}")
                    elif cmd == 'set_active_bank':
                        bank = data.get('bank', None)
                        if bank == '' or bank == 'auto':
                            self.generator.active_bank = None
                            print("[SIM] 切換為自動匹配模式")
                        else:
                            self.generator.active_bank = bank
                            print(f"[SIM] 指定銀行規格: {bank}")
                        await self.ws_broadcast({
                            'type': 'config_updated',
                            'active_bank': self.generator.active_bank,
                        })
                    elif cmd == 'ping':
                        await ws.send(json.dumps({'type': 'pong'}))
                except json.JSONDecodeError:
                    pass
        except Exception:
            pass
        finally:
            self.ws_clients.discard(ws)
            print(f"[WS] 監控客戶端離線 ({len(self.ws_clients)} 個)")

    async def read_message(self, reader: asyncio.StreamReader) -> bytes | None:
        """讀取一筆完整 ISO 8583 訊息（含 length header）"""
        try:
            if self.length_header == '2-bytes-be':
                hdr = await asyncio.wait_for(reader.readexactly(2), timeout=60)
                msg_len = struct.unpack('>H', hdr)[0]
            elif self.length_header == '2-bytes-le':
                hdr = await asyncio.wait_for(reader.readexactly(2), timeout=60)
                msg_len = struct.unpack('<H', hdr)[0]
            elif self.length_header == '4-bytes-ascii':
                hdr = await asyncio.wait_for(reader.readexactly(4), timeout=60)
                msg_len = int(hdr.decode('ascii'))
            else:
                hdr = await asyncio.wait_for(reader.readexactly(2), timeout=60)
                msg_len = struct.unpack('>H', hdr)[0]

            if msg_len <= 0 or msg_len > 9999:
                print(f"  [WARN] 異常長度: {msg_len}")
                return None

            body = await asyncio.wait_for(reader.readexactly(msg_len), timeout=10)
            return body

        except asyncio.TimeoutError:
            return None
        except asyncio.IncompleteReadError:
            return None
        except Exception as e:
            print(f"  [ERROR] 讀取失敗: {e}")
            return None

    def build_length_header(self, body: bytes) -> bytes:
        msg_len = len(body)
        if self.length_header == '2-bytes-be':
            return struct.pack('>H', msg_len)
        elif self.length_header == '2-bytes-le':
            return struct.pack('<H', msg_len)
        elif self.length_header == '4-bytes-ascii':
            return str(msg_len).zfill(4).encode('ascii')
        return struct.pack('>H', msg_len)

    async def handle_connection(self, reader: asyncio.StreamReader,
                                writer: asyncio.StreamWriter):
        addr = writer.get_extra_info('peername')
        print(f"\n[TCP] POS 連入: {addr}")
        await self.ws_broadcast({
            'type': 'connection',
            'action': 'connected',
            'address': str(addr),
        })

        try:
            while True:
                body = await self.read_message(reader)
                if body is None:
                    break

                self.tx_counter += 1
                tx_id = self.tx_counter
                ts = datetime.now().strftime('%H:%M:%S.%f')[:-3]

                # 解析 request
                try:
                    req = Iso8583Message.parse(body, has_tpdu=self.has_tpdu,
                                               mti_encoding=self.mti_encoding)
                except Exception as e:
                    print(f"  [#{tx_id}] 解析失敗: {e}")
                    print(f"  [#{tx_id}] RAW: {body.hex()}")
                    await self.ws_broadcast({
                        'type': 'error',
                        'tx_id': tx_id,
                        'message': f'解析失敗: {e}',
                        'raw_hex': body.hex(),
                    })
                    continue

                bank, tx_name, rule = self.generator.match_rule(
                    req.mti, req.fields)

                tid = req.fields.get(41, '')

                # TC Upload (0220/F3=250000) 沿用上一筆主交易的名稱
                if req.mti == '0220' and req.fields.get(3) == '250000' and tid:
                    last = self.last_tx_name.get(tid)
                    if last and tx_name and '一般銷售' in tx_name:
                        suffix = tx_name.split('_', 1)[1] if '_' in tx_name else ''
                        base = last.split('_', 1)[0]
                        tx_name = f"{base}_{suffix}" if suffix else base

                # 記住主交易名稱供後續 TC Upload 使用
                if req.mti in ('0100', '0200') and tid and tx_name:
                    self.last_tx_name[tid] = tx_name

                # 依 F22 Entry Mode 補充過卡方式（規格未區分時）
                if tx_name and 22 in req.fields:
                    entry = req.fields[22][:2]  # 前兩碼 = PAN entry mode
                    suffixes = {
                        '02': '刷卡', '05': '晶片', '07': '感應',
                        '90': '刷卡', '91': '感應',
                    }
                    suffix = suffixes.get(entry)
                    if suffix:
                        has_suffix = any(s in tx_name for s in
                                         ('刷卡', '晶片', '感應', '手輸',
                                          'FALLBACK', '4DBC'))
                        if not has_suffix:
                            tx_name = f"{tx_name}_{suffix}"

                # 偵測特殊交易類型：依欄位存在性修正交易名稱
                if tx_name:
                    if 54 in req.fields and req.fields[54].strip():
                        tx_name = '小費'
                    elif '分期' not in tx_name and 63 in req.fields:
                        f63 = req.fields[63]
                        idx = f63.find('10')
                        if idx >= 0 and idx + 12 <= len(f63) and f63[idx+2:idx+12].isdigit():
                            tx_name = f"分期{tx_name}"

                print(f"  [#{tx_id}] {ts} ← REQ {req.summary()}")
                if bank:
                    print(f"  [#{tx_id}]   匹配: {bank} / {tx_name}")
                else:
                    print(f"  [#{tx_id}]   未匹配規格，使用通用回應")

                # 通知 Web UI
                await self.ws_broadcast({
                    'type': 'request',
                    'tx_id': tx_id,
                    'timestamp': ts,
                    'mti': req.mti,
                    'bank': bank,
                    'tx_name': tx_name,
                    'fields': {str(k): v for k, v in req.fields.items()},
                    'raw_hex': body.hex(),
                })

                # Timeout 檢查
                if self.generator.should_timeout():
                    print(f"  [#{tx_id}] {ts} !! TIMEOUT (不回應)")
                    await self.ws_broadcast({
                        'type': 'response',
                        'tx_id': tx_id,
                        'timestamp': datetime.now().strftime('%H:%M:%S.%f')[:-3],
                        'mti': '',
                        'fields': {},
                        'response_code': 'TIMEOUT',
                        'raw_hex': '',
                    })
                    continue

                # 模擬 Host 處理延遲
                if self.response_delay > 0:
                    await asyncio.sleep(self.response_delay)

                # 生成回應
                resp = self.generator.generate_response(req)
                resp_body = resp.build(has_tpdu=self.has_tpdu,
                                       mti_encoding=self.mti_encoding)

                # 送出
                response_data = self.build_length_header(resp_body) + resp_body
                writer.write(response_data)
                await writer.drain()

                print(f"  [#{tx_id}] {ts} → RSP {resp.summary()}")

                await self.ws_broadcast({
                    'type': 'response',
                    'tx_id': tx_id,
                    'timestamp': datetime.now().strftime('%H:%M:%S.%f')[:-3],
                    'mti': resp.mti,
                    'fields': {str(k): v for k, v in resp.fields.items()},
                    'response_code': resp.fields.get(39, '??'),
                    'raw_hex': resp_body.hex(),
                })

        except ConnectionResetError:
            print(f"[TCP] 連線被 POS 重置: {addr}")
        except Exception as e:
            print(f"[TCP] 連線異常: {addr} — {e}")
            traceback.print_exc()
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            print(f"[TCP] POS 斷線: {addr}")
            await self.ws_broadcast({
                'type': 'connection',
                'action': 'disconnected',
                'address': str(addr),
            })

    async def start(self):
        self.running = True

        # 啟動 TCP Server
        tcp_server = await asyncio.start_server(
            self.handle_connection, '0.0.0.0', self.tcp_port)

        # 啟動 WebSocket Server（若有安裝 websockets）
        ws_server = None
        if websockets:
            ws_server = await websockets.serve(
                self.handle_ws_client, '127.0.0.1', self.ws_port,
                ping_interval=25, ping_timeout=10)

        print("=" * 58)
        print("  POS Host Simulator — 模擬銀行後台")
        print(f"  TCP  監聽: 0.0.0.0:{self.tcp_port}")
        if ws_server:
            print(f"  WS   監控: ws://127.0.0.1:{self.ws_port}")
        else:
            print("  WS   監控: (未安裝 websockets，略過)")
        print(f"  TPDU     : {'有' if self.has_tpdu else '無'}")
        print(f"  MTI 編碼 : {self.mti_encoding.upper()}")
        print(f"  Length    : {self.length_header}")
        print(f"  預設回應碼: {self.generator.default_rc}")
        print(f"  回應延遲 : {self.response_delay}s")
        print(f"  規格數   : {sum(len(v) for v in self.generator.rules.values())} 種交易")
        print("=" * 58)
        print("等待 POS 連線中…（按 Ctrl+C 停止）\n")

        await asyncio.Future()


# ═══════════════════════════════════════════════════════════════════════════════
#  自我測試
# ═══════════════════════════════════════════════════════════════════════════════

def self_test():
    """建構一筆模擬 0200 交易並測試解析 + 回應流程"""
    print("\n[自我測試] 開始\n")

    # 建構 request
    req = Iso8583Message()
    req.tpdu = bytes.fromhex('6000000000')
    req.mti = '0200'
    req.fields = {
        2:  '4761340000000019',
        3:  '000000',
        4:  '000000001000',
        11: '000001',
        14: '2512',
        22: '0512',
        24: '001',
        25: '00',
        35: '4761340000000019D2512101',
        41: 'TERM0001',
        42: 'MERCHANT0000001',
        62: '000001',
    }

    # 組包
    body = req.build(has_tpdu=True, mti_encoding='bcd')
    print(f"  Request 組包: {len(body)} bytes")
    print(f"  HEX: {body.hex()}")

    # 解析
    parsed = Iso8583Message.parse(body, has_tpdu=True, mti_encoding='bcd')
    print(f"\n  解析結果: MTI={parsed.mti}")
    for fid in sorted(parsed.fields.keys()):
        print(f"    Field {fid:3d}: {parsed.fields[fid]}")

    # 生成回應
    gen = ResponseGenerator({}, '00')
    resp = gen.generate_response(parsed)
    resp_body = resp.build(has_tpdu=True, mti_encoding='bcd')
    print(f"\n  Response 組包: {len(resp_body)} bytes")
    print(f"  HEX: {resp_body.hex()}")

    # 驗証回應
    resp_parsed = Iso8583Message.parse(resp_body, has_tpdu=True, mti_encoding='bcd')
    print(f"\n  回應解析: MTI={resp_parsed.mti}")
    for fid in sorted(resp_parsed.fields.keys()):
        print(f"    Field {fid:3d}: {resp_parsed.fields[fid]}")

    # 檢查
    assert parsed.mti == '0200', f"MTI 解析錯誤: {parsed.mti}"
    assert parsed.fields[3] == '000000', f"F3 解析錯誤: {parsed.fields[3]}"
    assert resp_parsed.mti == '0210', f"RSP MTI 錯誤: {resp_parsed.mti}"
    assert resp_parsed.fields[39] == '00', f"RSP F39 錯誤: {resp_parsed.fields[39]}"

    print("\n[自我測試] PASS - 全部通過！\n")


# ═══════════════════════════════════════════════════════════════════════════════
#  主程式
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    ap = argparse.ArgumentParser(description='POS Host Simulator')
    ap.add_argument('--port', type=int, default=8000,
                    help='TCP 監聽埠號 (預設 8000)')
    ap.add_argument('--ws-port', type=int, default=8001,
                    help='WebSocket 監控埠號 (預設 8001)')
    ap.add_argument('--response-code', default='00',
                    help='預設回應碼 (預設 00=核准)')
    ap.add_argument('--no-tpdu', action='store_true',
                    help='電文不含 TPDU header')
    ap.add_argument('--mti-ascii', action='store_true',
                    help='MTI 用 ASCII 編碼（預設 BCD）')
    ap.add_argument('--length-header', default='2-bytes-be',
                    choices=['2-bytes-be', '2-bytes-le', '4-bytes-ascii'],
                    help='長度 header 格式 (預設 2-bytes-be)')
    ap.add_argument('--delay', type=float, default=0.1,
                    help='回應延遲秒數 (預設 0.1)')
    ap.add_argument('--bank', default=None,
                    help='指定使用哪家銀行規格回應 (預設自動匹配)')
    ap.add_argument('--self-test', action='store_true',
                    help='執行自我測試')
    args = ap.parse_args()

    if args.self_test:
        self_test()
        return

    # 載入規格
    rules_dir = os.path.join(os.path.dirname(__file__), 'rules')
    rules = load_rules(rules_dir)
    response_profiles = load_response_profiles(rules_dir)

    if rules:
        banks = list(rules.keys())
        total = sum(len(v) for v in rules.values())
        print(f"[INFO] 已載入 {len(banks)} 家銀行、{total} 種交易規格")
        for b in banks:
            print(f"  → {b}: {len(rules[b])} 種")
    else:
        print("[WARN] 未載入任何規格，將使用通用回應")

    if response_profiles:
        print(f"[INFO] 已載入 {len(response_profiles)} 份回應 profile: "
              f"{', '.join(response_profiles.keys())}")
    else:
        print("[INFO] 未載入回應 profile，使用通用回應邏輯")

    gen = ResponseGenerator(rules, args.response_code, response_profiles)
    if args.bank:
        gen.active_bank = args.bank
        print(f"[INFO] 指定銀行: {args.bank}")

    sim = HostSimulator(
        gen,
        tcp_port=args.port,
        ws_port=args.ws_port,
        has_tpdu=not args.no_tpdu,
        mti_encoding='ascii' if args.mti_ascii else 'bcd',
        length_header=args.length_header,
        response_delay=args.delay,
    )

    try:
        asyncio.run(sim.start())
    except KeyboardInterrupt:
        print("\n[INFO] Simulator 已停止")


if __name__ == '__main__':
    main()
