#!/usr/bin/env python3
"""
Generate data/catalog.gz from data/ewerest_bearing_catalog_filled_all.xlsx

XLSX column mapping (0-indexed, starting from row 3 = data rows):
  0  = Артикул (full article, e.g. '6205-2RS-SKF')
  1  = Наименование
  2  = Тип подшипника
  3  = Бренд
  4  = Стандарт
  5  = ГОСТ №
  6  = d, мм
  7  = D, мм
  8  = B/H, мм
  9  = T, мм
  10 = r мин, мм
  11 = r1 мин, мм
  12 = m, кг
  13 = Уплотнение
  14 = Класс точности
  15 = Радиальный зазор
  16 = Сепаратор
  17 = Вариант исполнения
  18 = Cr, кН
  19 = C0r, кН
  20 = n_г, об/мин
  21 = n_м, об/мин
  22 = Аналог ГОСТ
  23 = Аналог ISO
  24 = Аналог SKF
  25 = Аналог FAG
  26 = Аналог NSK
  27 = Аналог NTN
  28 = Аналог ZWZ/LYC/HRB
  29 = Совместимость аналогов
  30 = Цена, руб (without VAT)
  31 = НДС, %
  32 = Цена с НДС, руб
  33 = Ед. изм.
  34 = Мин. партия
  35 = Остаток
  36 = Статус
  37 = Срок поставки, дн
  38 = Фото URL
  39 = Чертёж URL
  40 = Дата обновления
  41 = Примечание

catalog.gz row format (28 elements):
  [0]  type_idx     - index into dicts.types
  [1]  brand_idx    - index into dicts.brands
  [2]  article      - base article without brand suffix (str)
  [3]  std_idx      - index into dicts.standards
  [4]  gost_equiv   - GOST equivalent article (str)
  [5]  iso_equiv    - ISO equivalent article (str)
  [6]  skf_analog   - SKF analog (str)
  [7]  fag_analog   - FAG analog (str)
  [8]  nsk_analog   - NSK analog (str)
  [9]  ntn_analog   - NTN analog (str)
  [10] zwz_analog   - ZWZ/LYC/HRB analog (str)
  [11] d_mm         - inner diameter (float)
  [12] D_mm         - outer diameter (float)
  [13] B_mm         - width (float)
  [14] t_mm         - T dimension or 0 (float)
  [15] mass_kg      - mass in kg (float)
  [16] seal_idx     - index into dicts.seals (-1 if unknown)
  [17] prec_idx     - index into dicts.precisions (-1 if unknown)
  [18] clear_idx    - index into dicts.clearances (-1 if unknown)
  [19] cage_idx     - index into dicts.cages (-1 if unknown)
  [20] exec_idx     - index into dicts.execs (-1 if unknown)
  [21] Cr           - dynamic radial load capacity kN (float)
  [22] C0r          - static radial load capacity kN (float)
  [23] n_g          - grease speed rpm (int)
  [24] n_m          - oil speed rpm (int)
  [25] price_rub    - price without VAT (float, 0 if unknown)
  [26] qty          - quantity in stock (int, 0 if unknown)
  [27] status       - 0=unknown, 1=in_stock, 2=on_order
"""

import math
import os
import sys
import json
import gzip
from datetime import date
from pathlib import Path
import openpyxl

_DATA_DIR = Path(__file__).parent
XLSX_PATH = str(_DATA_DIR / 'ewerest_bearing_catalog_filled_all.xlsx')
OUT_PATH = str(_DATA_DIR / 'catalog.gz')


def get_or_add(lst, value):
    """Return index of value in list, adding it if not present."""
    if value is None or value == '':
        return -1
    try:
        return lst.index(value)
    except ValueError:
        lst.append(value)
        return len(lst) - 1


def strip_brand(article, brand):
    """Strip brand suffix from article string."""
    if not article:
        return ''
    article = str(article).strip()
    if brand:
        brand = str(brand).strip()
        suffix = '-' + brand
        if article.endswith(suffix):
            return article[:-len(suffix)]
    return article


def safe_float(val):
    if val is None:
        return 0.0
    try:
        f = float(val)
        return f if not math.isnan(f) else 0.0
    except (TypeError, ValueError):
        return 0.0


def safe_int(val):
    if val is None:
        return 0
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return 0


def parse_status(status_str):
    """Convert status string to int: 0=unknown, 1=in_stock, 2=on_order."""
    if not status_str:
        return 0
    s = str(status_str).lower().strip()
    if 'наличии' in s or 'в наличии' in s:
        return 1
    if 'заказ' in s or 'под заказ' in s:
        return 2
    return 0


def main():
    print(f'Loading {XLSX_PATH}...')
    wb = openpyxl.load_workbook(XLSX_PATH, read_only=True, data_only=True)
    ws = wb['Каталог']

    # Dictionary lists (will grow as we encounter new values)
    types = []
    brands = []
    standards = []
    seals = []
    precisions = []
    clearances = []
    cages = []
    execs = []

    rows = []
    count = 0
    skip = 0

    for xlsx_row in ws.iter_rows(min_row=3, values_only=True):
        article_full = xlsx_row[0]
        if not article_full:
            skip += 1
            continue

        brand = str(xlsx_row[3]).strip() if xlsx_row[3] else ''
        article = strip_brand(str(article_full).strip(), brand)

        type_str = str(xlsx_row[2]).strip() if xlsx_row[2] else ''
        std_str = str(xlsx_row[4]).strip() if xlsx_row[4] else ''
        seal_str = str(xlsx_row[13]).strip() if xlsx_row[13] else ''
        prec_str = str(xlsx_row[14]).strip() if xlsx_row[14] else ''
        clear_str = str(xlsx_row[15]).strip() if xlsx_row[15] else ''
        cage_str = str(xlsx_row[16]).strip() if xlsx_row[16] else ''
        exec_str = str(xlsx_row[17]).strip() if xlsx_row[17] else ''

        gost_eq = str(xlsx_row[22]).strip() if xlsx_row[22] else ''
        iso_eq = str(xlsx_row[23]).strip() if xlsx_row[23] else ''
        skf = str(xlsx_row[24]).strip() if xlsx_row[24] else ''
        fag = str(xlsx_row[25]).strip() if xlsx_row[25] else ''
        nsk = str(xlsx_row[26]).strip() if xlsx_row[26] else ''
        ntn = str(xlsx_row[27]).strip() if xlsx_row[27] else ''
        zwz = str(xlsx_row[28]).strip() if xlsx_row[28] else ''

        price = safe_float(xlsx_row[30])  # Цена без НДС
        qty = safe_int(xlsx_row[35])       # Остаток
        status = parse_status(xlsx_row[36])

        row = [
            get_or_add(types, type_str) if type_str else -1,
            get_or_add(brands, brand) if brand else -1,
            article,
            get_or_add(standards, std_str) if std_str else -1,
            gost_eq,
            iso_eq,
            skf,
            fag,
            nsk,
            ntn,
            zwz,
            safe_float(xlsx_row[6]),   # d_mm
            safe_float(xlsx_row[7]),   # D_mm
            safe_float(xlsx_row[8]),   # B_mm
            safe_float(xlsx_row[9]),   # T_mm
            safe_float(xlsx_row[12]),  # mass_kg
            get_or_add(seals, seal_str) if seal_str else -1,
            get_or_add(precisions, prec_str) if prec_str else -1,
            get_or_add(clearances, clear_str) if clear_str else -1,
            get_or_add(cages, cage_str) if cage_str else -1,
            get_or_add(execs, exec_str) if exec_str else -1,
            safe_float(xlsx_row[18]),  # Cr
            safe_float(xlsx_row[19]),  # C0r
            safe_int(xlsx_row[20]),    # n_г
            safe_int(xlsx_row[21]),    # n_м
            price,
            qty,
            status,
        ]
        rows.append(row)
        count += 1

    wb.close()

    print(f'Processed {count} rows, skipped {skip} empty rows')
    print(f'Dicts: types={len(types)}, brands={len(brands)}, standards={len(standards)}, '
          f'seals={len(seals)}, precisions={len(precisions)}, clearances={len(clearances)}, '
          f'cages={len(cages)}, execs={len(execs)}')

    priced = sum(1 for r in rows if r[25] > 0)
    print(f'Rows with price > 0: {priced}')

    catalog = {
        'rows': rows,
        'dicts': {
            'types': types,
            'brands': brands,
            'standards': standards,
            'seals': seals,
            'precisions': precisions,
            'clearances': clearances,
            'cages': cages,
            'execs': execs,
        },
        'meta': {
            'total': count,
            'source': 'ewerest_bearing_catalog_filled_all.xlsx',
            'generated': date.today().isoformat(),
        }
    }

    json_bytes = json.dumps(catalog, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    print(f'JSON size: {len(json_bytes):,} bytes')

    with gzip.open(OUT_PATH, 'wb', compresslevel=9) as f:
        f.write(json_bytes)

    gz_size = os.path.getsize(OUT_PATH)
    print(f'Written to {OUT_PATH}: {gz_size:,} bytes (compressed)')
    print('Done!')


if __name__ == '__main__':
    main()
