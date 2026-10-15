import { useState } from 'react';

export const organizationLeaves = (node) => node.children?.length ? node.children.flatMap(organizationLeaves) : [node.id];
export function organizationTree(organizations) {
  return organizations.filter((region) => region.enabled).map((region) => ({ ...region,
    children: (region.offices || []).filter((office) => office.enabled !== false).map((office) => ({ ...office, children: office.countryNodes || [] })),
  }));
}

export default function OrganizationTreePicker({ organizations, selectedIds, onChange }) {
  const [search, setSearch] = useState('');
  const tree = organizationTree(organizations);
  const selected = new Set(selectedIds);
  const query = search.trim().toLowerCase();
  const matches = (node) => node.name.toLowerCase().includes(query) || node.children?.some(matches);
  const toggle = (ids) => {
    const next = new Set(selected);
    const remove = ids.every((id) => next.has(id));
    ids.forEach((id) => remove ? next.delete(id) : next.add(id));
    onChange([...next]);
  };
  const renderNode = (node, level, parentMatched = false) => {
    if (!parentMatched && query && !matches(node)) return null;
    const leaves = organizationLeaves(node);
    const count = leaves.filter((id) => selected.has(id)).length;
    const checkbox = <label className="org-tree-choice"><input type="checkbox" checked={count === leaves.length} ref={(input) => { if (input) input.indeterminate = count > 0 && count < leaves.length; }} onClick={(event) => event.stopPropagation()} onChange={() => toggle(leaves)} /><span>{node.name}</span><small>{node.children?.length ? `${count}/${leaves.length} 已选` : '国家/地区'}</small></label>;
    return node.children?.length ? <details className={`org-tree-node org-tree-level-${level}`} key={node.id} open={query ? true : undefined}>
      <summary>{checkbox}</summary><div className="org-tree-children">{node.children.map((child) => renderNode(child, level + 1, parentMatched || node.name.toLowerCase().includes(query)))}</div>
    </details> : <div className="org-tree-leaf" key={node.id}>{checkbox}</div>;
  };
  return <div className="organization-tree-picker">
    <input className="org-tree-search" aria-label="搜索下发区域、代表处或国家" placeholder="搜索区域、代表处、国家" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="org-tree-toolbar"><span>已选择 {selectedIds.length} 个末级组织</span><button type="button" className="text-button" onClick={() => onChange(tree.flatMap(organizationLeaves))}>全部选择</button><button type="button" className="text-button" onClick={() => onChange([])}>清空</button></div>
    <div className="org-tree-scroll">{tree.map((node) => renderNode(node, 0))}{query && !tree.some(matches) && <p>未找到匹配的组织</p>}</div>
  </div>;
}
