"""Water-network graph helpers (PLAN.md §7.2).

Pure functions over bulk-loaded dictionaries: no per-row queries, no SQLite
writes, no network. `load_graph` is the ONLY place that touches the DB and it
does it in three bulk queries (§2 rule 1: no N+1).
"""

from backend.forecast import REFERENCE_YEAR  # §6.3: pipe age is measured against 2026

PLANT_TYPES = ("treatment_plant",)
ROOT_TYPES = ("source", "treatment_plant")


def load_graph(conn):
    """Return (parent, children, nodes, pipes_by_to).

    parent      node_id -> parent node_id (water tree; absent for roots/air/land)
    children    node_id -> [child node_id, ...] (sorted for determinism)
    nodes       node_id -> sqlite3.Row
    pipes_by_to node_id -> the pipe that delivers INTO that node (parent -> node)
    """
    nodes = {r["id"]: r for r in conn.execute("SELECT * FROM nodes")}
    parent = {}
    children = {}
    for r in conn.execute(
        "SELECT id, parent_id FROM nodes WHERE parent_id IS NOT NULL"
    ).fetchall():
        parent[r["id"]] = r["parent_id"]
        children.setdefault(r["parent_id"], []).append(r["id"])
    for kids in children.values():
        kids.sort()

    # A cross-connected node can have several inbound pipes; the one whose
    # from_node == the tree parent is the active feed.
    pipes = conn.execute(
        "SELECT * FROM pipes ORDER BY id"
    ).fetchall()
    pipes_by_to = {}
    fallback_by_to = {}
    for p in pipes:
        fallback_by_to.setdefault(p["to_node"], p)
        if parent.get(p["to_node"]) == p["from_node"]:
            pipes_by_to[p["to_node"]] = p
        elif p["to_node"] not in pipes_by_to:
            pipes_by_to.setdefault(p["to_node"], p)
    for nid in nodes:
        if nid not in pipes_by_to and nid in fallback_by_to:
            pipes_by_to[nid] = fallback_by_to[nid]
    set_node_types(nodes)
    return parent, children, nodes, pipes_by_to


def chain(node_id, parent):
    """node -> root, inclusive, ordered away from the plant."""
    out = [node_id]
    seen = {node_id}
    cur = node_id
    while cur in parent and parent[cur] not in seen:
        cur = parent[cur]
        out.append(cur)
        seen.add(cur)
    return out


def depth(node_id, parent):
    return len(chain(node_id, parent))


def lca(ids, parent):
    """Lowest (deepest) shared upstream ancestor of `ids`, or None.

    A node counts as its own ancestor, so lca(['B21','B22']) with B22 a child of
    B21 returns B21 (their shared upstream point). A single id returns itself.
    """
    ids = [i for i in ids if i]
    if not ids:
        return None
    if len(ids) == 1:
        return ids[0]
    chains = [set(chain(i, parent)) for i in ids]
    common = set.intersection(*chains)
    if not common:
        return None
    # deepest shared ancestor == the one furthest from the root, i.e. the
    # longest node->root chain. Tie-break on id for determinism.
    best = max(sorted(common), key=lambda c: len(chain(c, parent)))
    return best


def trace(node_id, parent):
    """node -> treatment plant, inclusive (§7.2). Air/land nodes return [node]."""
    path = chain(node_id, parent)
    out = []
    for nid in path:
        out.append(nid)
        if _node_type_is(out[-1], ("treatment_plant",)):
            break
    return out


# trace() needs node types; load them once per graph via a module-level cache
# keyed by id->type map supplied by set_node_types().
_NODE_TYPES = {}


def set_node_types(nodes):
    """nodes: dict id -> Row (or id -> type string). Used by trace()."""
    global _NODE_TYPES
    _NODE_TYPES = {
        nid: (r["type"] if hasattr(r, "keys") else r) for nid, r in nodes.items()
    }


def _node_type_is(nid, types):
    return _NODE_TYPES.get(nid) in types


def trace_with_pipes(node_id, parent, nodes, pipes_by_to):
    """Richer trace for the API/UI: list of steps from the node up to the plant.

    Each step: {node_id, node_name, node_type, pipe: {id, length_m, diameter_mm,
    material, install_year, from_node, to_node} or None}
    """
    set_node_types(nodes)
    steps = []
    for nid in trace(node_id, parent):
        row = nodes.get(nid)
        pipe = pipes_by_to.get(nid)
        steps.append({
            "node_id": nid,
            "node_name": row["name"] if row is not None else nid,
            "node_type": row["type"] if row is not None else None,
            "lat": row["lat"] if row is not None else None,
            "lon": row["lon"] if row is not None else None,
            "pipe": None if pipe is None else {
                "id": pipe["id"],
                "from_node": pipe["from_node"],
                "to_node": pipe["to_node"],
                "length_m": pipe["length_m"],
                "diameter_mm": pipe["diameter_mm"],
                "material": pipe["material"],
                "install_year": pipe["install_year"],
                "age_years": REFERENCE_YEAR - pipe["install_year"] if pipe["install_year"] else None,
            },
        })
    return steps


def descendants(node_id, children):
    """All nodes downstream of node_id (inclusive), deterministic order."""
    out, stack = [], [node_id]
    while stack:
        cur = stack.pop(0)
        out.append(cur)
        stack.extend(children.get(cur, []))
    return out
