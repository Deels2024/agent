"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";

export type CatalogSeller = {
  status: string;
  kycStatus: string;
};

export type CatalogItem = {
  id: number;
  externalId: string | null;
  productName: string;
  barcode: string | null;
  price: number;
  stock: number;
  status: string;
};

type BulkRow = {
  row: number;
  productName: string;
  barcode: string;
  externalId: string;
  price: number;
  stock: number;
  error?: string;
};

type Props = {
  seller: CatalogSeller;
  items: CatalogItem[];
  onReload: () => Promise<void>;
  onMessage: (message: string) => void;
};

const emptyItem = { productName: "", barcode: "", externalId: "", price: "", stock: "1" };

function productVisibility(seller: CatalogSeller, item: CatalogItem) {
  if (item.status !== "active") return { code: "paused", label: "Снят с поиска", detail: "Можно вернуть в выдачу одним нажатием." };
  if (item.stock <= 0) return { code: "stock", label: "Нет остатка", detail: "Укажите остаток больше нуля." };
  if (seller.kycStatus !== "verified") return { code: "review", label: "Ждёт проверки", detail: "Товар появится после проверки владельца и компании." };
  if (seller.status !== "active") return { code: "review", label: "Ждёт допуска", detail: "Товар появится после активации магазина." };
  return { code: "searchable", label: "В поиске", detail: "Покупатели уже могут найти это предложение." };
}

function splitDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function normalizedHeader(value: string) {
  return value.toLocaleLowerCase("ru").replace(/[\s_-]+/g, "");
}

function parseNumber(value: string) {
  return Number(value.replace(/\s/g, "").replace(",", "."));
}

function parseCatalog(text: string): BulkRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const headers = splitDelimitedLine(lines[0], delimiter).map(normalizedHeader);
  const find = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const columns = {
    productName: find("название", "товар", "наименованиетовара", "productname", "name"),
    barcode: find("штрихкод", "barcode", "ean", "gtin"),
    externalId: find("артикул", "артикулпродавца", "sku", "externalid"),
    price: find("цена", "price"),
    stock: find("остаток", "количество", "stock", "quantity"),
  };
  if (columns.productName < 0 || columns.price < 0 || columns.stock < 0) return [];

  return lines.slice(1, 101).map((line, index) => {
    const cells = splitDelimitedLine(line, delimiter);
    const productName = cells[columns.productName]?.trim() ?? "";
    const barcode = columns.barcode >= 0 ? (cells[columns.barcode] ?? "").replace(/\D/g, "") : "";
    const externalId = columns.externalId >= 0 ? (cells[columns.externalId] ?? "").trim() : "";
    const price = parseNumber(cells[columns.price] ?? "");
    const stock = Math.floor(parseNumber(cells[columns.stock] ?? ""));
    const errors = [
      productName.length < 3 ? "короткое название" : "",
      !Number.isFinite(price) || price <= 0 ? "неверная цена" : "",
      !Number.isFinite(stock) || stock < 0 ? "неверный остаток" : "",
      barcode && (barcode.length < 8 || barcode.length > 14) ? "штрих-код должен содержать 8–14 цифр" : "",
    ].filter(Boolean);
    return { row: index + 2, productName, barcode, externalId, price, stock, error: errors.join(", ") || undefined };
  });
}

export default function ProductCatalog({ seller, items, onReload, onMessage }: Props) {
  const [mode, setMode] = useState<"manual" | "bulk">("manual");
  const [form, setForm] = useState(emptyItem);
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkFileName, setBulkFileName] = useState("");
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ price: "", stock: "" });
  const [busy, setBusy] = useState(false);

  const visibleCount = items.filter((item) => productVisibility(seller, item).code === "searchable").length;
  const attentionCount = items.filter((item) => productVisibility(seller, item).code !== "searchable").length;
  const filteredItems = useMemo(() => {
    const normalized = filter.trim().toLocaleLowerCase("ru");
    if (!normalized) return items;
    return items.filter((item) => [item.productName, item.barcode, item.externalId].some((value) => value?.toLocaleLowerCase("ru").includes(normalized)));
  }, [filter, items]);
  const manualProgress = Math.min(100, (form.productName.trim().length >= 3 ? 40 : 0) + (Number(form.price) > 0 ? 35 : 0) + (Number(form.stock) >= 0 && form.stock !== "" ? 25 : 0));
  const validBulkRows = bulkRows.filter((row) => !row.error);

  const addItem = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    onMessage("Добавляем товар в каталог…");
    const response = await fetch("/api/sellers/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, price: Number(form.price), stock: Number(form.stock) }),
    });
    const result = await response.json() as { error?: string };
    onMessage(response.ok ? "Товар добавлен. Статус видимости показан в каталоге." : result.error ?? "Не удалось добавить товар");
    if (response.ok) {
      setForm(emptyItem);
      await onReload();
    }
    setBusy(false);
  };

  const readBulkFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = parseCatalog(await file.text());
    setBulkFileName(file.name);
    setBulkRows(rows);
    onMessage(rows.length ? "Файл прочитан. Проверьте строки перед загрузкой." : "Не найдены обязательные столбцы: Название, Цена, Остаток.");
  };

  const addBulk = async () => {
    if (!validBulkRows.length) return;
    setBusy(true);
    onMessage("Загружаем товары в каталог…");
    const response = await fetch("/api/sellers/inventory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: validBulkRows.map((row) => ({ productName: row.productName, barcode: row.barcode, externalId: row.externalId, price: row.price, stock: row.stock })) }),
    });
    const result = await response.json() as { error?: string; createdCount?: number };
    onMessage(response.ok ? "Добавлено товаров: " + (result.createdCount ?? validBulkRows.length) : result.error ?? "Не удалось загрузить товары");
    if (response.ok) {
      setBulkRows([]);
      setBulkFileName("");
      await onReload();
    }
    setBusy(false);
  };

  const downloadTemplate = () => {
    const content = "\uFEFFНазвание;Штрих-код;Артикул;Цена;Остаток\nApple iPhone 15 Pro 256 GB;194253941234;IPH15P256;99990;3\n";
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "shablon-kataloga.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const startEdit = (item: CatalogItem) => {
    setEditingId(item.id);
    setEditForm({ price: String(item.price), stock: String(item.stock) });
  };

  const updateItem = async (item: CatalogItem, status = item.status) => {
    setBusy(true);
    onMessage("Сохраняем изменения…");
    const payload = editingId === item.id
      ? { id: item.id, price: Number(editForm.price), stock: Number(editForm.stock), status }
      : { id: item.id, status };
    const response = await fetch("/api/sellers/inventory", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string };
    onMessage(response.ok ? "Карточка товара обновлена" : result.error ?? "Не удалось обновить товар");
    if (response.ok) {
      setEditingId(null);
      await onReload();
    }
    setBusy(false);
  };

  return <article className="portal-panel portal-wide seller-catalog">
    <div className="seller-catalog-head">
      <div>
        <span className="customer-kicker">Каталог магазина</span>
        <h2>Товары, которые ищет агент</h2>
        <p>Добавьте точное название модели, цену и остаток. Штрих-код помогает агенту не перепутать модификацию.</p>
      </div>
      <div className="seller-catalog-metrics">
        <span><b>{items.length}</b> всего</span>
        <span className="ready"><b>{visibleCount}</b> в поиске</span>
        <span className={attentionCount ? "attention" : ""}><b>{attentionCount}</b> требуют внимания</span>
      </div>
    </div>

    <div className="seller-catalog-layout">
      <section className="seller-product-entry">
        <div className="seller-entry-tabs" role="tablist" aria-label="Способ добавления">
          <button type="button" className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>Один товар</button>
          <button type="button" className={mode === "bulk" ? "active" : ""} onClick={() => setMode("bulk")}>Из файла</button>
        </div>
        {mode === "manual" ? <form className="portal-form seller-product-form" onSubmit={addItem}>
          <div className="seller-form-progress"><span style={{ width: manualProgress + "%" }} /><b>{manualProgress}% заполнено</b></div>
          <label>Точное название и модель
            <input value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} placeholder="Например, Samsung UE55CU7100UXRU 55″" minLength={3} required />
            <small>Укажите бренд, модель, объём памяти или диагональ.</small>
          </label>
          <div className="portal-form-row">
            <label>Штрих-код
              <input value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value.replace(/\D/g, "").slice(0, 14) })} placeholder="8–14 цифр" inputMode="numeric" pattern="[0-9]{8,14}" />
            </label>
            <label>Артикул магазина
              <input value={form.externalId} onChange={(event) => setForm({ ...form, externalId: event.target.value })} placeholder="Необязательно" maxLength={100} />
            </label>
          </div>
          <div className="portal-form-row">
            <label>Цена, ₽
              <input type="number" min="1" max="10000000" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="99990" required />
            </label>
            <label>Остаток, шт.
              <input type="number" min="0" max="1000000" step="1" value={form.stock} onChange={(event) => setForm({ ...form, stock: event.target.value })} required />
            </label>
          </div>
          <div className="seller-search-rule"><span>✦</span><p><b>После добавления</b>{seller.kycStatus === "verified" && seller.status === "active" ? "Товар с остатком сразу появится в поиске покупателей." : "Карточка сохранится, а в поиск попадёт после проверки магазина."}</p></div>
          <button disabled={busy || manualProgress < 100}>{busy ? "Сохраняем…" : "Добавить товар"}</button>
        </form> : <div className="seller-bulk-import">
          <div className="seller-upload-zone">
            <span>⇧</span>
            <h3>{bulkFileName || "Загрузите каталог CSV"}</h3>
            <p>До 100 товаров за раз. Обязательные столбцы: Название, Цена, Остаток.</p>
            <label><input type="file" accept=".csv,text/csv" onChange={readBulkFile} />Выбрать CSV</label>
            <button type="button" onClick={downloadTemplate}>Скачать шаблон</button>
          </div>
          {bulkRows.length > 0 && <div className="seller-bulk-preview">
            <header><b>Проверка файла</b><span>{validBulkRows.length} готово · {bulkRows.length - validBulkRows.length} с ошибками</span></header>
            <div>{bulkRows.slice(0, 8).map((row) => <p key={row.row} className={row.error ? "error" : ""}><span>Строка {row.row}</span><b>{row.productName || "Без названия"}</b><small>{row.error ?? row.price.toLocaleString("ru-RU") + " ₽ · " + row.stock + " шт."}</small></p>)}</div>
            {bulkRows.length > 8 && <small>И ещё {bulkRows.length - 8} строк</small>}
            <button type="button" disabled={busy || !validBulkRows.length} onClick={addBulk}>{busy ? "Загружаем…" : "Добавить " + validBulkRows.length + " товаров"}</button>
          </div>}
        </div>}
      </section>

      <aside className="seller-catalog-guide">
        <span>Как попасть в поиск</span>
        <ol>
          <li className="done"><b>Заполнить карточку</b><small>Название, цена и остаток</small></li>
          <li className={seller.kycStatus === "verified" ? "done" : ""}><b>Пройти проверку</b><small>KYC владельца и компании</small></li>
          <li className={seller.status === "active" ? "done" : ""}><b>Получить допуск</b><small>Статус магазина «active»</small></li>
        </ol>
        <p>Агент сравнивает точную модель, штрих-код и итоговую цену. Товары без остатка не показываются покупателям.</p>
      </aside>
    </div>

    <div className="seller-inventory-toolbar">
      <div><h3>Ассортимент</h3><p>Цена и остаток должны быть актуальными.</p></div>
      <label><span>⌕</span><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Найти товар или штрих-код" /></label>
    </div>
    <div className="seller-inventory-list">
      {filteredItems.map((item) => {
        const visibility = productVisibility(seller, item);
        const editing = editingId === item.id;
        return <article key={item.id}>
          <div className="seller-inventory-product"><span>▦</span><div><b>{item.productName}</b><small>{(item.externalId ? "Арт. " + item.externalId : "Без артикула") + " · " + (item.barcode || "Без штрих-кода")}</small></div></div>
          {editing ? <div className="seller-inventory-edit">
            <label>Цена<input type="number" min="1" step="0.01" value={editForm.price} onChange={(event) => setEditForm({ ...editForm, price: event.target.value })} /></label>
            <label>Остаток<input type="number" min="0" step="1" value={editForm.stock} onChange={(event) => setEditForm({ ...editForm, stock: event.target.value })} /></label>
          </div> : <div className="seller-inventory-numbers"><span><small>Цена</small><b>{item.price.toLocaleString("ru-RU")} ₽</b></span><span><small>Остаток</small><b>{item.stock} шт.</b></span></div>}
          <div className={"seller-visibility " + visibility.code} title={visibility.detail}><i /> <span><b>{visibility.label}</b><small>{visibility.detail}</small></span></div>
          <div className="seller-inventory-actions">
            {editing ? <><button type="button" disabled={busy} onClick={() => void updateItem(item)}>Сохранить</button><button type="button" className="muted" onClick={() => setEditingId(null)}>Отмена</button></> : <>
              {visibility.code === "searchable" && <a href={"/live-search?q=" + encodeURIComponent(item.productName)}>Проверить поиск</a>}
              <button type="button" onClick={() => startEdit(item)}>Цена и остаток</button>
              <button type="button" className="muted" disabled={busy} onClick={() => void updateItem(item, item.status === "active" ? "paused" : "active")}>{item.status === "active" ? "Снять" : "Вернуть"}</button>
            </>}
          </div>
        </article>;
      })}
      {items.length === 0 && <div className="seller-inventory-empty"><span>＋</span><h3>Добавьте первый товар</h3><p>После этого агент сможет сопоставлять его с поиском и запросами покупателей.</p></div>}
      {items.length > 0 && filteredItems.length === 0 && <div className="seller-inventory-empty"><span>⌕</span><h3>Ничего не найдено</h3><p>Попробуйте изменить название, артикул или штрих-код.</p></div>}
    </div>
  </article>;
}
