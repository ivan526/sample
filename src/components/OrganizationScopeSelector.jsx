import { useEffect, useRef, useState } from "react";
import { IconSearch, IconX } from "@tabler/icons-react";

const statusLabels = { submitted: "已提交", editing: "填报中", idle: "未开始" };

export default function OrganizationScopeSelector({ label, items, selectedId, statuses = {}, onSelect, className = "" }) {
  const [query, setQuery] = useState("");
  const listRef = useRef(null);
  const selected = items.find((item) => item.id === selectedId);
  const keyword = items.length > 8 ? query.trim().toLocaleLowerCase() : "";
  const visibleItems = items.filter((item) => item.name.toLocaleLowerCase().includes(keyword));

  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector('[aria-pressed="true"]');
    if (!active) return;
    // Scroll only the options, so changing scope never jumps the whole page.
    const listBounds = list.getBoundingClientRect();
    const activeBounds = active.getBoundingClientRect();
    if (activeBounds.top < listBounds.top) list.scrollTop -= listBounds.top - activeBounds.top;
    else if (activeBounds.bottom > listBounds.bottom) list.scrollTop += activeBounds.bottom - listBounds.bottom;
  }, [selectedId, query, items]);

  return <section className={`scope-selector ${className}`} aria-label={`${label}选择`}>
    <div className="scope-selector-heading">
      <div className="scope-selector-context"><strong>{label}<span className="scope-selector-count">{items.length}</span></strong><span className="scope-selector-current">当前：{selected?.name || `暂无${label}`}</span></div>
      {items.length > 8 && <div className="scope-selector-search"><IconSearch size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${label}`} aria-label={`搜索${label}`} />{query && <button type="button" onClick={() => setQuery("")} aria-label={`清除${label}搜索`}><IconX size={15} /></button>}</div>}
    </div>
    <div className="region-tabs" role="group" aria-label={`${label}选项`} ref={listRef}>
      {visibleItems.map((item) => {
        const status = statuses[item.id] || "idle";
        return <button type="button" aria-pressed={selectedId === item.id} title={`${item.name} · ${statusLabels[status] || statusLabels.idle}`} key={item.id} className={selectedId === item.id ? "region-active" : ""} onClick={() => onSelect(item.id)}><span className="scope-option-name">{item.name}</span><span className={`status-dot status-${status}`} aria-label={statusLabels[status] || statusLabels.idle} /></button>;
      })}
      {!visibleItems.length && <span className="scope-selector-empty" role="status">{items.length ? `未找到匹配的${label}，请调整搜索词` : `暂无可选${label}`}</span>}
    </div>
    {items.length > 8 && <div className="scope-selector-hint">{query.trim() ? `匹配 ${visibleItems.length} / ${items.length} 个` : "选项较多，可搜索或在列表内滚动选择"}</div>}
  </section>;
}
